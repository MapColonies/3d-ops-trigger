import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { new3DLayerMetadataSchema, AppError, type LogContext } from '@map-colonies/3d-shared';
import type { ZodError } from 'zod';
import { SERVICES } from '@common/constants';
import { LookupTablesClient } from '../externalServices/lookupTables/lookupTablesClient';
import { CatalogClient } from '../externalServices/catalog/catalogClient';

export const ERROR_METADATA_PRODUCT_NAME_UNIQUE = 'product name is not unique!';
export const ERROR_METADATA_PRODUCT_ID_UNIQUE = 'product id is not unique!';

@injectable()
export class ValidationManager {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(LookupTablesClient) private readonly lookupTablesClient: LookupTablesClient,
    @inject(CatalogClient) private readonly catalogClient: CatalogClient
  ) {
    this.logContext = {
      fileName: __filename,
      class: ValidationManager.name,
    };
  }

  public async validateIngestion(metadata: Record<string, unknown>): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateIngestion.name };
    this.logger.info({ msg: 'ingestion validation start', logContext });

    const parsed = new3DLayerMetadataSchema.safeParse(metadata);
    if (!parsed.success) {
      const message = this.formatIssues(parsed.error);
      this.logger.error({ msg: 'metadata schema validation failed', logContext, issues: message });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
    }

    await this.validateClassification(parsed.data.classification);
    await this.validateRegion(parsed.data.region);
    await this.validateProductIdUnique(parsed.data.productId);
    await this.validateProductNameUnique(parsed.data.productName);
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
