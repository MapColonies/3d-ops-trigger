import { randomUUID } from 'node:crypto';
import type { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { trace } from '@opentelemetry/api';
import { StatusCodes } from 'http-status-codes';
import type { Polygon } from 'geojson';
import { RecordStatus } from '@map-colonies/types';
import { SERVICES } from '@common/constants';
import type {
  AckResponse,
  IngestionPayload,
  JobResponse,
  LogContext,
  StatusPayload,
  UpdatePayload,
  ValidationResultResponse,
} from '@common/interfaces';
import { AppError } from '@common/appError';
import { convertPolygonTo2DPolygon } from '@common/util';
import { IngestionValidator } from '../../validator/ingestionValidator';
import { MetadataValidator } from '../../validator/metadataValidator';
import { JobnikClient } from '../../externalServices/jobnik/jobnikClient';
import { CatalogCall } from '../../externalServices/catalog/catalogCall';

@injectable()
export class RecordManager {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(IngestionValidator) private readonly ingestionValidator: IngestionValidator,
    @inject(MetadataValidator) private readonly metadataValidator: MetadataValidator,
    @inject(JobnikClient) private readonly jobnik: JobnikClient,
    @inject(CatalogCall) private readonly catalog: CatalogCall
  ) {
    this.logContext = {
      fileName: __filename,
      class: RecordManager.name,
    };
  }

  public async createIngestion(payload: IngestionPayload): Promise<JobResponse> {
    const logContext = { ...this.logContext, function: this.createIngestion.name };
    const modelId = randomUUID();
    this.logger.info({ msg: 'creating ingestion job', logContext, modelId, modelPath: payload.modelPath, tilesetFilename: payload.tilesetFilename });
    trace.getActiveSpan()?.setAttribute('catalogId', modelId);

    try {
      await this.ingestionValidator.validateIngestion(payload);

      const metadata = payload.metadata as Record<string, unknown>;
      if (metadata.footprint !== undefined) {
        metadata.footprint = convertPolygonTo2DPolygon(metadata.footprint as Polygon);
      }

      return await this.jobnik.createIngestionJob(payload, modelId);
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      this.logger.error({ msg: 'unexpected error while creating ingestion job', logContext, modelId, err });
      throw new AppError('error', StatusCodes.INTERNAL_SERVER_ERROR, String(err), true);
    }
  }

  public async validateIngestion(payload: IngestionPayload): Promise<ValidationResultResponse> {
    const logContext = { ...this.logContext, function: this.validateIngestion.name };
    this.logger.info({ msg: 'validating ingestion request', logContext, modelPath: payload.modelPath });
    try {
      await this.ingestionValidator.validateIngestion(payload);
      return { isValid: true };
    } catch (err) {
      if (err instanceof AppError) {
        return { isValid: false, message: err.message };
      }
      throw err;
    }
  }

  public async canDelete(id: string): Promise<ValidationResultResponse> {
    const logContext = { ...this.logContext, function: this.canDelete.name };
    this.logger.info({ msg: 'validating record deletability', logContext, recordId: id });
    try {
      await this.metadataValidator.validateDelete(id);
      return { isValid: true };
    } catch (err) {
      if (err instanceof AppError) {
        return { isValid: false, message: err.message };
      }
      throw err;
    }
  }

  public async deleteRecord(id: string): Promise<JobResponse> {
    const logContext = { ...this.logContext, function: this.deleteRecord.name };
    this.logger.info({ msg: 'creating delete job', logContext, recordId: id });
    const record = await this.metadataValidator.validateDelete(id);
    const job = await this.jobnik.createDeleteJob(record);
    await this.catalog.changeStatus(id, { productStatus: RecordStatus.BEING_DELETED });
    return job;
  }

  public async updateMetadata(id: string, update: UpdatePayload): Promise<AckResponse> {
    const logContext = { ...this.logContext, function: this.updateMetadata.name };
    this.logger.info({ msg: 'updating record metadata', logContext, recordId: id });
    const record = await this.metadataValidator.validateUpdate(id, update);
    await this.metadataValidator.ensureRecordAbsentFromExtractable(record);

    const payload: Record<string, unknown> = { ...update };
    if (payload.footprint !== undefined) {
      payload.footprint = convertPolygonTo2DPolygon(payload.footprint as Polygon);
    }
    await this.catalog.patchMetadata(id, payload);

    return { message: `metadata updated for record ${id}` };
  }

  public async updateStatus(id: string, payload: StatusPayload): Promise<AckResponse> {
    const logContext = { ...this.logContext, function: this.updateStatus.name };
    this.logger.info({ msg: 'updating record status', logContext, recordId: id, status: payload.status });
    const record = await this.metadataValidator.validateStatusChange(id);
    await this.metadataValidator.ensureRecordAbsentFromExtractable(record);

    await this.catalog.changeStatus(id, { productStatus: payload.status });

    return { message: `status ${payload.status} accepted for record ${id}` };
  }
}
