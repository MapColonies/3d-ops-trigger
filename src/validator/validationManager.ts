import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { new3DLayerMetadataSchema, geometrySchema } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { LogContext } from '@common/interfaces';
import { AppError } from '@common/appError';
import { LookupTablesCall } from '../externalServices/lookupTables/lookupTablesCall';
import { CatalogCall } from '../externalServices/catalog/catalogCall';

export const ERROR_METADATA_DATE = 'imagingTimeBeginUTC must not be later than imagingTimeEndUTC';
export const ERROR_METADATA_MISSING_DATE = 'imagingTimeBeginUTC and imagingTimeEndUTC are required';
export const ERROR_METADATA_INVALID_DATE = 'imagingTimeBeginUTC and imagingTimeEndUTC must be valid dates';
export const ERROR_METADATA_FOOTPRINT = 'Invalid footprint! Must be a GeoJSON Polygon or MultiPolygon with all-2D or all-3D coordinates';
export const ERROR_METADATA_PRODUCT_NAME_UNIQUE = 'product name is not unique!';

@injectable()
export class ValidationManager {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(LookupTablesCall) private readonly lookupTables: LookupTablesCall,
    @inject(CatalogCall) private readonly catalog: CatalogCall
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
  }

  private async validateProductNameUnique(productName: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validateProductNameUnique.name };
    const records = await this.catalog.findRecords({ productName });
    this.logger.debug({ msg: 'product name uniqueness validation', logContext, productName, matches: records.length });

    if (records.length > 0) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_METADATA_PRODUCT_NAME_UNIQUE, true);
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
