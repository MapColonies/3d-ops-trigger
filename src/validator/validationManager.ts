import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { ingestion3DPayloadSchema, AppError, type LogContext, type Record3D } from '@map-colonies/3d-shared';
import type { ZodError } from 'zod';
import { ProductType, RecordStatus } from '@map-colonies/types';
import { area, feature, featureCollection, intersect, union } from '@turf/turf';
import type { MultiPolygon, Polygon } from 'geojson';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import { ERROR_FOOTPRINT_COVERAGE_FAILED, ERROR_FOOTPRINT_FAR_FROM_MODEL } from '../extractor/constants';
import { LookupTablesClient } from '../externalServices/lookupTables/lookupTablesClient';
import { CatalogClient } from '../externalServices/catalog/catalogClient';
import { JobnikClient } from '../externalServices/jobnik/jobnikClient';
import type { ProductIdentity } from './interfaces';

const FULL_COVERAGE_PERCENT = 100;
const COVERAGE_DECIMALS = 2;

export const ERROR_METADATA_PRODUCT_NAME_UNIQUE = 'product name is not unique!';
export const ERROR_METADATA_PRODUCT_ID_UNIQUE = 'product id is not unique!';
export const ERROR_PRODUCT_NAME_IN_FLIGHT = 'product name already has an in-flight ingestion job';
export const ERROR_DELETE_RECORD_NOT_FOUND = "recordId doesn't match exactly one existing record";
export const ERROR_DELETE_PRODUCT_TYPE = `Cannot delete a record whose productType is "${ProductType.QUANTIZED_MESH_DTM_BEST}"`;
export const ERROR_DELETE_STATUS = `Cannot delete a record whose productStatus is not "${RecordStatus.UNPUBLISHED}"`;

@injectable()
export class ValidationManager {
  private readonly logContext: LogContext;
  private readonly intersectionPercentageLimit: number;

  public constructor(
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(LookupTablesClient) private readonly lookupTablesClient: LookupTablesClient,
    @inject(CatalogClient) private readonly catalogClient: CatalogClient,
    @inject(JobnikClient) private readonly jobnikClient: JobnikClient
  ) {
    this.intersectionPercentageLimit = config.get('validation.intersectionPercentageLimit');
    this.logContext = {
      fileName: __filename,
      class: ValidationManager.name,
    };
  }

  public async validateIngestion(payload: Record<string, unknown>, product: ProductIdentity): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateIngestion.name };
    this.logger.info({ msg: 'ingestion validation start', logContext });

    const parsed = ingestion3DPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      const message = this.formatIssues(parsed.error);
      this.logger.error({ msg: 'metadata schema validation failed', logContext, issues: message });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
    }

    const results = await Promise.allSettled([
      this.validateClassification(parsed.data.classification),
      this.validateRegion(parsed.data.region),
      this.validateProductIdUnique(product.productId),
      this.validateProductNameUnique(product.productName),
      this.validateProductNameNotInFlight(product.productName),
    ]);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) {
      throw failure.reason as Error;
    }
  }

  public async validateDelete(recordId: string): Promise<Record3D> {
    const logContext = { ...this.logContext, function: this.validateDelete.name };
    const records = await this.catalogClient.findRecords({ id: recordId });
    this.logger.debug({ msg: 'delete validation', logContext, recordId, matches: records.length });

    const [record] = records;
    if (records.length !== 1 || record === undefined) {
      this.logger.error({ msg: ERROR_DELETE_RECORD_NOT_FOUND, logContext, recordId, matches: records.length });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_DELETE_RECORD_NOT_FOUND, true);
    }
    if (record.productType === ProductType.QUANTIZED_MESH_DTM_BEST) {
      this.logger.error({ msg: ERROR_DELETE_PRODUCT_TYPE, logContext, recordId, productType: record.productType });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_DELETE_PRODUCT_TYPE, true);
    }
    if (record.productStatus !== RecordStatus.UNPUBLISHED) {
      this.logger.error({ msg: ERROR_DELETE_STATUS, logContext, recordId, productStatus: record.productStatus });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_DELETE_STATUS, true);
    }

    return record;
  }

  public validateFootprint(footprint: Polygon | MultiPolygon, modelPolygon: Polygon): void {
    const logContext = { ...this.logContext, function: this.validateFootprint.name };
    const coverage = this.calculateCoverage(footprint, modelPolygon);
    this.logger.debug({
      msg: 'footprint coverage of the model',
      logContext,
      coverage,
      intersectionPercentageLimit: this.intersectionPercentageLimit,
    });

    if (coverage === null) {
      this.logger.error({ msg: ERROR_FOOTPRINT_FAR_FROM_MODEL, logContext, footprint, modelPolygon });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_FOOTPRINT_FAR_FROM_MODEL, true);
    }
    if (coverage < this.intersectionPercentageLimit) {
      const message = `footprint coverage of the model is ${coverage}%, the minimum required coverage is ${this.intersectionPercentageLimit}%`;
      this.logger.error({
        msg: message,
        logContext,
        coverage,
        intersectionPercentageLimit: this.intersectionPercentageLimit,
        footprint,
        modelPolygon,
      });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
    }
  }

  private calculateCoverage(footprint: Polygon | MultiPolygon, modelPolygon: Polygon): number | null {
    const logContext = { ...this.logContext, function: this.calculateCoverage.name };
    try {
      const shapes = featureCollection([feature(footprint), feature(modelPolygon)]);
      if (intersect(shapes) === null) {
        return null;
      }

      const combined = union(shapes);
      const combinedArea = combined === null ? 0 : area(combined);
      const coverage = combinedArea === 0 ? 0 : (FULL_COVERAGE_PERCENT * area(footprint)) / combinedArea;

      return Number(coverage.toFixed(COVERAGE_DECIMALS));
    } catch (err) {
      this.logger.error({ msg: ERROR_FOOTPRINT_COVERAGE_FAILED, logContext, err });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_FOOTPRINT_COVERAGE_FAILED, true);
    }
  }

  private formatIssues(error: ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  }

  private async validateProductIdUnique(productId: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateProductIdUnique.name };
    const records = await this.catalogClient.findRecords({ productId });
    this.logger.debug({ msg: 'product id uniqueness validation', logContext, productId, matches: records.length });

    if (records.length > 0) {
      this.logger.error({
        msg: 'product id already exists in catalog',
        logContext,
        productId,
        existingRecordIds: records.map((record) => record.id),
      });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_PRODUCT_ID_UNIQUE, true);
    }
  }

  private async validateProductNameUnique(productName: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateProductNameUnique.name };
    const records = await this.catalogClient.findRecords({ productName });
    this.logger.debug({ msg: 'product name uniqueness validation', logContext, productName, matches: records.length });

    if (records.length > 0) {
      this.logger.error({
        msg: 'product name already exists in catalog',
        logContext,
        productName,
        existingRecordIds: records.map((record) => record.id),
      });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_PRODUCT_NAME_UNIQUE, true);
    }
  }

  private async validateProductNameNotInFlight(productName: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateProductNameNotInFlight.name };
    const inFlight = await this.jobnikClient.hasInFlightIngestionJob(productName);
    this.logger.debug({ msg: 'in-flight duplicate validation', logContext, productName, inFlight });

    if (inFlight) {
      this.logger.error({ msg: ERROR_PRODUCT_NAME_IN_FLIGHT, logContext, productName });
      throw new AppError('conflict', StatusCodes.CONFLICT, ERROR_PRODUCT_NAME_IN_FLIGHT, true);
    }
  }

  private async validateClassification(classification: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateClassification.name };
    const classifications = await this.lookupTablesClient.getClassifications();
    this.logger.debug({ msg: 'classification validation', logContext, classifications });

    if (!classifications.includes(classification)) {
      this.logger.error({ msg: 'classification is not in lookup table', logContext, classification, classifications });
      throw new AppError(
        'badRequest',
        StatusCodes.BAD_REQUEST,
        `classification is not a valid value. Optional values: ${classifications.join()}`,
        true
      );
    }
  }

  private async validateRegion(region: string[]): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateRegion.name };
    const countries = await this.lookupTablesClient.getCountries();
    const invalidRegions = region.filter((value) => !countries.includes(value));
    this.logger.debug({ msg: 'region validation', logContext, region, invalidRegions });

    if (invalidRegions.length > 0) {
      this.logger.error({ msg: 'region values are not in countries lookup table', logContext, invalidRegions, countries });
      throw new AppError(
        'badRequest',
        StatusCodes.BAD_REQUEST,
        `region contains invalid values: ${invalidRegions.join()}. Optional values: ${countries.join()}`,
        true
      );
    }
  }
}
