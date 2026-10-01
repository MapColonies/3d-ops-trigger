import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { new3DLayerMetadataSchema, geometrySchema } from '@map-colonies/3d-shared';
import { ProductType, RecordStatus } from '@map-colonies/types';
import { SERVICES } from '@common/constants';
import type { LogContext, UpdatePayload } from '@common/interfaces';
import { AppError } from '@common/appError';
import { LookupTablesCall } from '../externalServices/lookupTables/lookupTablesCall';
import { CatalogCall } from '../externalServices/catalog/catalogCall';
import { ExtractableCall } from '../externalServices/extractableManagement/extractableCall';
import type { Record3D } from '../externalServices/catalog/interfaces';
import { validateClassification } from './classification';
import {
  ERROR_DELETE_PRODUCT_TYPE,
  ERROR_DELETE_RECORD_NOT_FOUND,
  ERROR_DELETE_STATUS,
  ERROR_EXTRACTABLE_CONFLICT,
  ERROR_METADATA_FOOTPRINT,
  ERROR_METADATA_PRODUCT_NAME_UNIQUE,
  ERROR_RECORD_BEING_DELETED,
  ERROR_RECORD_NOT_FOUND,
} from './errors';

const BLOCKED_DELETE_PRODUCT_TYPE = ProductType.QUANTIZED_MESH_DTM_BEST;

@injectable()
export class MetadataValidator {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(LookupTablesCall) private readonly lookupTables: LookupTablesCall,
    @inject(CatalogCall) private readonly catalog: CatalogCall,
    @inject(ExtractableCall) private readonly extractable: ExtractableCall
  ) {
    this.logContext = {
      fileName: __filename,
      class: MetadataValidator.name,
    };
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

    if (record.productStatus !== RecordStatus.UNPUBLISHED) {
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_DELETE_STATUS, true);
    }

    return record;
  }

  public async validateUpdate(identifier: string, payload: UpdatePayload): Promise<Record3D> {
    const logContext = { ...this.logContext, function: this.validateUpdate.name };
    const record = await this.catalog.getRecord(identifier);
    if (record === undefined) {
      throw new AppError('notFound', StatusCodes.NOT_FOUND, ERROR_RECORD_NOT_FOUND, true);
    }
    if (record.productStatus === RecordStatus.BEING_DELETED) {
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
      await validateClassification(this.lookupTables, this.logger, logContext, data.classification);
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
    if (record.productStatus === RecordStatus.BEING_DELETED) {
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
}
