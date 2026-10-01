import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { new3DLayerMetadataSchema, geometrySchema } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { IngestionPayload, LogContext } from '@common/interfaces';
import { AppError } from '@common/appError';
import { buildModelFilePath } from '@common/util';
import type { ConfigType } from '@common/config';
import { LookupTablesCall } from '../externalServices/lookupTables/lookupTablesCall';
import { CatalogCall } from '../externalServices/catalog/catalogCall';
import { JobnikClient } from '../externalServices/jobnik/jobnikClient';
import type { Provider } from '../providers/interfaces';
import { TilesetValidator } from './tilesetValidator';
import { validateClassification } from './classification';
import {
  ERROR_FILE_NOT_FOUND,
  ERROR_METADATA_DATE,
  ERROR_METADATA_FOOTPRINT,
  ERROR_METADATA_INVALID_DATE,
  ERROR_METADATA_MISSING_DATE,
  ERROR_METADATA_PRODUCT_NAME_UNIQUE,
  ERROR_MODEL_PATH_INVALID,
  ERROR_PRODUCT_ID_EXISTS,
  ERROR_PRODUCT_NAME_IN_FLIGHT,
} from './errors';

@injectable()
export class IngestionValidator {
  private readonly logContext: LogContext;
  private readonly basePath: string;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(LookupTablesCall) private readonly lookupTables: LookupTablesCall,
    @inject(CatalogCall) private readonly catalog: CatalogCall,
    @inject(JobnikClient) private readonly jobnik: JobnikClient,
    @inject(SERVICES.PROVIDER) private readonly provider: Provider,
    @inject(TilesetValidator) private readonly tileset: TilesetValidator
  ) {
    this.basePath = this.config.get('validation.basePath');
    this.logContext = {
      fileName: __filename,
      class: IngestionValidator.name,
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

    await validateClassification(this.lookupTables, this.logger, logContext, parsed.data.classification);
    await this.validateProductNameUnique(parsed.data.productName);
    await this.validateProductNameNotInFlight(parsed.data.productName);
    await this.validateProductIdUnique(parsed.data.productId);
    await this.validateFileExists(payload.modelPath, payload.tilesetFilename);
    await this.tileset.validateTileset(payload, footprintResult.data);
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
}
