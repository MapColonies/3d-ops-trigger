import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { new3DLayerMetadataSchema, geometrySchema, calculatePolygonFromTileset, type TileSetJson } from '@map-colonies/3d-shared';
import { area, feature, featureCollection, intersect, union } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { components } from '@openapi';
import { SERVICES } from '@common/constants';
import type { LogContext, ValidationResponse } from '@common/interfaces';
import { AppError } from '@common/appError';
import { buildModelFilePath } from '@common/util';
import type { ConfigType } from '@common/config';
import { LookupTablesCall } from '../externalServices/lookupTables/lookupTablesCall';
import { CatalogCall } from '../externalServices/catalog/catalogCall';
import { JobnikClient } from '../externalServices/jobnik/jobnikClient';
import { ExtractableCall } from '../externalServices/extractableManagement/extractableCall';
import { TilesetReader } from '../tileset/tilesetReader';
import type { Record3D } from '../externalServices/catalog/interfaces';
import type { Provider } from '../providers/interfaces';
import type { IngestionPayload } from '../records/models/recordManager';

type UpdatePayload = components['schemas']['updatePayload'];

const FULL_COVERAGE_PERCENT = 100;

const BLOCKED_DELETE_PRODUCT_TYPE = 'QuantizedMeshDTMBest';
const RECORD_STATUS_UNPUBLISHED = 'UNPUBLISHED';
const RECORD_STATUS_BEING_DELETED = 'BEING_DELETED';

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
export const ERROR_FOOTPRINT_FAR_FROM_MODEL = "Wrong footprint! footprint's coordinates is not even close to the model!";
export const ERROR_INTERSECTION_FAILED = 'An error caused during the validation of the intersection';
export const ERROR_RECORD_NOT_FOUND = "record with the given identifier doesn't exist";
export const ERROR_RECORD_BEING_DELETED = 'cannot change a record that is being deleted';
export const ERROR_EXTRACTABLE_CONFLICT = 'the record exists in the extractable-management service and cannot be changed here';
export const ERROR_MODEL_PATH_INVALID = 'Unknown model path! The model is not under the agreed base path';
export const ERROR_PRODUCT_ID_EXISTS = 'a record with this productId already exists in the catalog';

@injectable()
export class ValidationManager {
  private readonly logContext: LogContext;
  private readonly percentageLimit: number;
  private readonly basePath: string;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(LookupTablesCall) private readonly lookupTables: LookupTablesCall,
    @inject(CatalogCall) private readonly catalog: CatalogCall,
    @inject(JobnikClient) private readonly jobnik: JobnikClient,
    @inject(TilesetReader) private readonly tilesetReader: TilesetReader,
    @inject(ExtractableCall) private readonly extractable: ExtractableCall,
    @inject(SERVICES.PROVIDER) private readonly provider: Provider
  ) {
    this.percentageLimit = this.config.get('validation.percentageLimit');
    this.basePath = this.config.get('validation.basePath');
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
    this.validateModelPath(payload.modelPath);

    await this.validateClassification(parsed.data.classification);
    await this.validateProductNameUnique(parsed.data.productName);
    await this.validateProductNameNotInFlight(parsed.data.productName);
    await this.validateProductIdUnique(parsed.data.productId);
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

  public async validateUpdate(identifier: string, payload: UpdatePayload): Promise<Record3D> {
    const record = await this.catalog.getRecord(identifier);
    if (record === undefined) {
      throw new AppError('notFound', StatusCodes.NOT_FOUND, ERROR_RECORD_NOT_FOUND, true);
    }
    if (record.productStatus === RECORD_STATUS_BEING_DELETED) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_RECORD_BEING_DELETED, true);
    }

    const parsed = new3DLayerMetadataSchema.partial().safeParse(payload);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
    }

    const footprint = (payload as { footprint?: unknown }).footprint;
    if (footprint !== undefined && !geometrySchema.safeParse(footprint).success) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_FOOTPRINT, true);
    }

    const data = parsed.data;
    if (data.classification !== undefined) {
      await this.validateClassification(data.classification);
    }
    if (data.productName !== undefined) {
      await this.validateProductNameUniqueExcept(data.productName, identifier);
    }

    return record;
  }

  public async validateStatusChange(identifier: string): Promise<Record3D> {
    const record = await this.catalog.getRecord(identifier);
    if (record === undefined) {
      throw new AppError('notFound', StatusCodes.NOT_FOUND, ERROR_RECORD_NOT_FOUND, true);
    }
    if (record.productStatus === RECORD_STATUS_BEING_DELETED) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_RECORD_BEING_DELETED, true);
    }

    return record;
  }

  public async ensureRecordAbsentFromExtractable(record: Record3D): Promise<void> {
    const logContext = { ...this.logContext, function: this.ensureRecordAbsentFromExtractable.name };
    if (record.productName === undefined) {
      return;
    }

    const exists = await this.extractable.isExtractableRecordExists(record.productName);
    this.logger.debug({ msg: 'extractable existence validation', logContext, productName: record.productName, exists });
    if (exists) {
      throw new AppError('conflict', StatusCodes.CONFLICT, ERROR_EXTRACTABLE_CONFLICT, true);
    }
  }

  private async validateProductNameUniqueExcept(productName: string, identifier: string): Promise<void> {
    const records = await this.catalog.findRecords({ productName });
    if (records.some((existing) => existing.id !== identifier)) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_PRODUCT_NAME_UNIQUE, true);
    }
  }

  private validateModelPath(modelPath: string): void {
    if (!modelPath.startsWith(this.basePath)) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, `${ERROR_MODEL_PATH_INVALID} (basePath: ${this.basePath})`, true);
    }
  }

  private async validateProductIdUnique(productId: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateProductIdUnique.name };
    const records = await this.catalog.findRecords({ productId });
    this.logger.debug({ msg: 'product id uniqueness validation', logContext, productId, matches: records.length });

    if (records.length > 0) {
      throw new AppError('conflict', StatusCodes.CONFLICT, ERROR_PRODUCT_ID_EXISTS, true);
    }
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
    const content = await this.tilesetReader.readTilesetJson(payload.modelPath, payload.tilesetFilename);

    const { modelPolygon, response: polygonResponse } = this.getTilesetModelPolygon(content);
    if (!polygonResponse.isValid || modelPolygon === undefined) {
      this.rejectValidation(polygonResponse);
    }

    const intersectionResponse = this.isFootprintAndModelIntersects(footprint, modelPolygon);
    if (!intersectionResponse.isValid) {
      this.rejectValidation(intersectionResponse);
    }
  }

  private getTilesetModelPolygon(content: string): { modelPolygon?: Polygon; response: ValidationResponse } {
    const logContext = { ...this.logContext, function: this.getTilesetModelPolygon.name };
    try {
      const tilesetJson = JSON.parse(content) as TileSetJson;
      const modelPolygon = calculatePolygonFromTileset(tilesetJson);
      this.logger.debug({ msg: 'extracted tileset model polygon', logContext, modelPolygon });

      return { modelPolygon, response: { isValid: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : ERROR_TILESET_INVALID;
      this.logger.error({ msg: 'tileset polygon extraction failed', logContext, err });
      return { response: { isValid: false, message } };
    }
  }

  private isFootprintAndModelIntersects(footprint: Polygon | MultiPolygon, modelPolygon: Polygon): ValidationResponse {
    const logContext = { ...this.logContext, function: this.isFootprintAndModelIntersects.name };
    try {
      const footprintFeature = feature(footprint);
      const modelFeature: Feature<Polygon> = feature(modelPolygon);

      const intersection = intersect(featureCollection([footprintFeature, modelFeature]));
      if (intersection === null) {
        return { isValid: false, message: ERROR_FOOTPRINT_FAR_FROM_MODEL };
      }

      const combined = union(featureCollection([footprintFeature, modelFeature]));
      const combinedArea = combined === null ? 0 : area(combined);
      const coverage = combinedArea === 0 ? 0 : (FULL_COVERAGE_PERCENT * area(footprintFeature)) / combinedArea;
      this.logger.debug({ msg: 'calculated footprint coverage of the model', logContext, coverage, percentageLimit: this.percentageLimit });

      if (coverage < this.percentageLimit) {
        return {
          isValid: false,
          message: `The footprint intersectection with the model doesn't reach minimum required threshhold, the coverage is: ${coverage}% when the minimum coverage is ${this.percentageLimit}%`,
        };
      }
      return { isValid: true };
    } catch (err) {
      this.logger.error({ msg: ERROR_INTERSECTION_FAILED, logContext, err });
      return { isValid: false, message: ERROR_INTERSECTION_FAILED };
    }
  }

  private rejectValidation(response: ValidationResponse): never {
    const logContext = { ...this.logContext, function: this.rejectValidation.name };
    const message = response.message ?? ERROR_TILESET_INVALID;
    this.logger.warn({ msg: 'ingestion validation failed', logContext, isValid: response.isValid, message });

    throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
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
