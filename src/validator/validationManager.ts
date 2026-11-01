import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { ingestion3DPayloadSchema, AppError, type LogContext } from '@map-colonies/3d-shared';
import type { ZodError } from 'zod';
import { area, feature, featureCollection, intersect, union } from '@turf/turf';
import type { Polygon } from 'geojson';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import type { ProductFootprint } from '../extractor/interfaces';
import { ERROR_FOOTPRINT_COVERAGE_FAILED, ERROR_FOOTPRINT_FAR_FROM_MODEL } from '../extractor/constants';
import { LookupTablesClient } from '../externalServices/lookupTables/lookupTablesClient';
import { CatalogClient } from '../externalServices/catalog/catalogClient';
import type { ProductIdentity } from './interfaces';

const FULL_COVERAGE_PERCENT = 100;
const COVERAGE_DECIMALS = 2;

export const ERROR_METADATA_PRODUCT_NAME_UNIQUE = 'product name is not unique!';
export const ERROR_METADATA_PRODUCT_ID_UNIQUE = 'product id is not unique!';

@injectable()
export class ValidationManager {
  private readonly logContext: LogContext;
  private readonly percentageLimit: number;

  public constructor(
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(LookupTablesClient) private readonly lookupTablesClient: LookupTablesClient,
    @inject(CatalogClient) private readonly catalogClient: CatalogClient
  ) {
    this.percentageLimit = config.get('validation.percentageLimit');
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
    ]);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) {
      throw failure.reason as Error;
    }
  }

  public validateFootprint(footprint: ProductFootprint, modelPolygon: Polygon): void {
    const logContext = { ...this.logContext, function: this.validateFootprint.name };
    const coverage = this.calculateCoverage(footprint, modelPolygon);
    this.logger.debug({ msg: 'footprint coverage of the model', logContext, coverage, percentageLimit: this.percentageLimit });

    if (coverage === null) {
      this.logger.error({ msg: ERROR_FOOTPRINT_FAR_FROM_MODEL, logContext, footprint, modelPolygon });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_FOOTPRINT_FAR_FROM_MODEL, true);
    }
    if (coverage < this.percentageLimit) {
      const message = `footprint coverage of the model is ${coverage}%, the minimum required coverage is ${this.percentageLimit}%`;
      this.logger.error({ msg: message, logContext, coverage, percentageLimit: this.percentageLimit });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
    }
  }

  private calculateCoverage(footprint: ProductFootprint, modelPolygon: Polygon): number | null {
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
