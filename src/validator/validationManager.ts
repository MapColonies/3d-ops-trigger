import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { new3DLayerMetadataSchema, geometrySchema, calculatePolygonFromTileset, type TileSetJson } from '@map-colonies/3d-shared';
import { area, feature, featureCollection, intersect, union } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { SERVICES } from '@common/constants';
import type { LogContext } from '@common/interfaces';
import { AppError } from '@common/appError';
import { buildModelFilePath } from '@common/util';
import type { ConfigType } from '@common/config';
import { LookupTablesCall } from '../externalServices/lookupTables/lookupTablesCall';
import { CatalogCall } from '../externalServices/catalog/catalogCall';
import { JobnikClient } from '../externalServices/jobnik/jobnikClient';
import { TilesetReader } from '../tileset/tilesetReader';
import type { Record3D } from '../externalServices/catalog/interfaces';
import type { Provider } from '../providers/interfaces';
import type { IngestionPayload } from '../record/models/recordManager';

const FULL_COVERAGE_PERCENT = 100;

const BLOCKED_DELETE_PRODUCT_TYPE = 'QuantizedMeshDTMBest';
const RECORD_STATUS_UNPUBLISHED = 'UNPUBLISHED';

export const ERROR_METADATA_DATE = 'imagingTimeBeginUTC must not be later than imagingTimeEndUTC';
export const ERROR_METADATA_MISSING_DATE = 'imagingTimeBeginUTC and imagingTimeEndUTC are required';
export const ERROR_METADATA_INVALID_DATE = 'imagingTimeBeginUTC and imagingTimeEndUTC must be valid dates';
export const ERROR_METADATA_FOOTPRINT = 'Invalid footprint! Must be a GeoJSON Polygon or MultiPolygon with all-2D or all-3D coordinates';
export const ERROR_METADATA_PRODUCT_NAME_UNIQUE = 'product name is not unique!';
export const ERROR_PRODUCT_NAME_IN_FLIGHT = 'product name already has an in-flight ingestion job';
export const ERROR_DELETE_RECORD_NOT_FOUND = "recordId doesn't match exactly one existing record";
export const ERROR_DELETE_PRODUCT_TYPE = 'Cannot delete a record whose productType is "QuantizedMeshDTMBest"';
export const ERROR_DELETE_STATUS = 'Cannot delete a record whose productStatus is not "UNPUBLISHED"';
export const ERROR_FILE_NOT_FOUND = 'The model files do not exist in the agreed storage';
export const ERROR_TILESET_INVALID = 'The tileset file is not a valid 3DTiles tileset';
export const ERROR_FOOTPRINT_FAR_FROM_MODEL = 'Invalid footprint! The footprint does not intersect the tileset model';
export const ERROR_FOOTPRINT_COVERAGE = 'The footprint coverage of the tileset model is below the required threshold';

@injectable()
export class ValidationManager {
  private readonly logContext: LogContext;
  private readonly percentageLimit: number;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(LookupTablesCall) private readonly lookupTables: LookupTablesCall,
    @inject(CatalogCall) private readonly catalog: CatalogCall,
    @inject(JobnikClient) private readonly jobnik: JobnikClient,
    @inject(TilesetReader) private readonly tilesetReader: TilesetReader,
    @inject(SERVICES.PROVIDER) private readonly provider: Provider
  ) {
    this.percentageLimit = this.config.get('validation.percentageLimit');
    this.logContext = {
      fileName: __filename,
      class: ValidationManager.name,
    };
  }

  public async validateIngestion(payload: IngestionPayload): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateIngestion.name };
    this.logger.info({ msg: 'ingestion validation start', logContext });

    const metadata = payload.metadata;
    const parsed = new3DLayerMetadataSchema.safeParse(metadata);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
    }

    const footprintResult = geometrySchema.safeParse(metadata.footprint);
    if (!footprintResult.success) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_FOOTPRINT, true);
    }

    this.validateDates(metadata.imagingTimeBeginUTC, metadata.imagingTimeEndUTC);

    await this.validateClassification(parsed.data.classification);
    await this.validateProductNameUnique(parsed.data.productName);
    await this.validateProductNameNotInFlight(parsed.data.productName);
    await this.validateFileExists(payload.modelPath, payload.tilesetFilename);
    await this.validateTileset(payload, footprintResult.data);
  }

  public async validateDelete(recordId: string): Promise<Record3D> {
    const logContext = { ...this.logContext, function: this.validateDelete.name };
    const records = await this.catalog.findRecords({ id: recordId });
    this.logger.debug({ msg: 'delete validation', logContext, recordId, matches: records.length });

    const [record] = records;
    if (records.length !== 1 || record === undefined) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_DELETE_RECORD_NOT_FOUND, true);
    }

    if (record.productType === BLOCKED_DELETE_PRODUCT_TYPE) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_DELETE_PRODUCT_TYPE, true);
    }
    if (record.productStatus !== RECORD_STATUS_UNPUBLISHED) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_DELETE_STATUS, true);
    }

    return record;
  }

  private async validateFileExists(modelPath: string, tilesetFilename: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateFileExists.name };
    const path = buildModelFilePath(modelPath, tilesetFilename);
    const exists = await this.provider.fileExists(path);
    this.logger.debug({ msg: 'file existence validation', logContext, path, exists });
    if (!exists) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_FILE_NOT_FOUND, true);
    }
  }

  private async validateProductNameUnique(productName: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateProductNameUnique.name };
    const records = await this.catalog.findRecords({ productName });
    this.logger.debug({ msg: 'product name uniqueness validation', logContext, productName, matches: records.length });

    if (records.length > 0) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_PRODUCT_NAME_UNIQUE, true);
    }
  }

  private async validateProductNameNotInFlight(productName: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateProductNameNotInFlight.name };
    const inFlight = await this.jobnik.hasInFlightIngestionJob(productName);
    this.logger.debug({ msg: 'in-flight duplicate validation', logContext, productName, inFlight });

    if (inFlight) {
      throw new AppError('conflict', StatusCodes.CONFLICT, ERROR_PRODUCT_NAME_IN_FLIGHT, true);
    }
  }

  private async validateTileset(payload: IngestionPayload, footprint: Polygon | MultiPolygon): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateTileset.name };
    const content = await this.tilesetReader.readTilesetJson(payload.modelPath, payload.tilesetFilename);

    let modelPolygon: Polygon;
    try {
      const tilesetJson = JSON.parse(content) as TileSetJson;
      modelPolygon = calculatePolygonFromTileset(tilesetJson);
    } catch (err) {
      const message = err instanceof Error ? err.message : ERROR_TILESET_INVALID;
      this.logger.error({ msg: 'tileset polygon extraction failed', logContext, modelPath: payload.modelPath, err });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
    }

    this.validateFootprintCoverage(footprint, modelPolygon);
  }

  private validateFootprintCoverage(footprint: Polygon | MultiPolygon, modelPolygon: Polygon): void {
    const logContext = { ...this.logContext, function: this.validateFootprintCoverage.name };
    const footprintFeature = feature(footprint);
    const modelFeature: Feature<Polygon> = feature(modelPolygon);

    const intersection = intersect(featureCollection([footprintFeature, modelFeature]));
    if (intersection === null) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_FOOTPRINT_FAR_FROM_MODEL, true);
    }

    const combined = union(featureCollection([footprintFeature, modelFeature]));
    const combinedArea = combined === null ? 0 : area(combined);
    const coverage = combinedArea === 0 ? 0 : (FULL_COVERAGE_PERCENT * area(footprintFeature)) / combinedArea;
    this.logger.debug({ msg: 'footprint coverage validation', logContext, coverage, percentageLimit: this.percentageLimit });

    if (coverage < this.percentageLimit) {
      throw new AppError(
        'badRequest',
        StatusCodes.BAD_REQUEST,
        `${ERROR_FOOTPRINT_COVERAGE}. coverage: ${coverage}%, minimum: ${this.percentageLimit}%`,
        true
      );
    }
  }

  private validateDates(start: unknown, end: unknown): void {
    if (start === undefined || end === undefined) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_MISSING_DATE, true);
    }

    const startTime = new Date(start as string).getTime();
    const endTime = new Date(end as string).getTime();
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_INVALID_DATE, true);
    }

    if (startTime > endTime) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_DATE, true);
    }
  }

  private async validateClassification(classification: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateClassification.name };
    const classifications = await this.lookupTables.getClassifications();
    this.logger.debug({ msg: 'classification validation', logContext, classifications });

    if (!classifications.includes(classification)) {
      throw new AppError(
        'badRequest',
        StatusCodes.BAD_REQUEST,
        `classification is not a valid value. Optional values: ${classifications.join()}`,
        true
      );
    }
  }
}
