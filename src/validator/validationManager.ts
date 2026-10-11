import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { AppError, type LogContext } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import { LookupTablesClient } from '../externalServices/lookupTables/lookupTablesClient';
import type { IngestionPayload } from '../record/models/recordManager';

@injectable()
export class ValidationManager {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(LookupTablesClient) private readonly lookupTablesClient: LookupTablesClient
  ) {
    this.logContext = {
      fileName: __filename,
      class: ValidationManager.name,
    };
  }

  public async validateIngestion(payload: Pick<IngestionPayload, 'classification' | 'region'>): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateIngestion.name };
    this.logger.info({ msg: 'ingestion validation start', logContext });

    await this.validateClassification(payload.classification);
    await this.validateRegion(payload.region);
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
