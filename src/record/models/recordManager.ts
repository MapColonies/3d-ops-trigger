import type { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import type { LogContext } from '@map-colonies/3d-shared';
import type { components } from '@openapi';
import { SERVICES } from '@common/constants';
import { ValidationManager } from '../../validator/validationManager';
import { FilesValidator } from '../../validator/filesValidator';
import { MetadataExtractor } from '../../extractor/metadataExtractor';

export type IngestionPayload = components['schemas']['ingestionPayload'];
export type UpdatePayload = components['schemas']['updatePayload'];
export type StatusPayload = components['schemas']['statusPayload'];
export type JobResponse = components['schemas']['jobResponse'];
export type AckResponse = components['schemas']['ackResponse'];

@injectable()
export class RecordManager {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(ValidationManager) private readonly validator: ValidationManager,
    @inject(FilesValidator) private readonly filesValidator: FilesValidator,
    @inject(MetadataExtractor) private readonly extractor: MetadataExtractor
  ) {
    this.logContext = {
      fileName: __filename,
      class: RecordManager.name,
    };
  }

  public async createIngestion(payload: IngestionPayload): Promise<JobResponse> {
    const logContext = { ...this.logContext, function: this.createIngestion.name };
    this.logger.info({ msg: 'creating ingestion job', logContext, modelPath: payload.modelPath });
    const { modelPath, productShapefilePath, metadataShapefilePath, ...formFields } = payload;

    const files = await this.filesValidator.validateIngestionFiles({ modelPath, productShapefilePath, metadataShapefilePath });
    const { core, aggregation } = await this.extractor.extract(files);
    this.validator.validateAggregation({ ...aggregation });
    await this.validator.validateIngestion({ ...formFields, ...core, ...aggregation });
    return { jobId: 'stub-ingestion-job-id', status: 'PENDING' };
  }

  public deleteRecord(id: string): JobResponse {
    const logContext = { ...this.logContext, function: this.deleteRecord.name };
    this.logger.info({ msg: 'creating delete job', logContext, recordId: id });
    return { jobId: 'stub-delete-job-id', status: 'PENDING' };
  }

  public updateMetadata(id: string, update: UpdatePayload): AckResponse {
    const logContext = { ...this.logContext, function: this.updateMetadata.name };
    this.logger.info({ msg: 'updating record metadata', logContext, recordId: id, fields: Object.keys(update) });
    return { message: `metadata update accepted for record ${id}` };
  }

  public updateStatus(id: string, payload: StatusPayload): AckResponse {
    const logContext = { ...this.logContext, function: this.updateStatus.name };
    this.logger.info({ msg: 'updating record status', logContext, recordId: id, status: payload.status });
    return { message: `status ${payload.status} accepted for record ${id}` };
  }
}
