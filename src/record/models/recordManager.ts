import type { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import type { components } from '@openapi';
import { SERVICES } from '@common/constants';
import type { LogContext } from '@common/interfaces';
import { ValidationManager } from '../../validator/validationManager';
import { JobnikClient } from '../../externalServices/jobnik/jobnikClient';

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
    @inject(JobnikClient) private readonly jobnik: JobnikClient
  ) {
    this.logContext = {
      fileName: __filename,
      class: RecordManager.name,
    };
  }

  public async createIngestion(payload: IngestionPayload): Promise<JobResponse> {
    const logContext = { ...this.logContext, function: this.createIngestion.name };
    this.logger.info({ msg: 'creating ingestion job', logContext, modelPath: payload.modelPath, tilesetFilename: payload.tilesetFilename });
    await this.validator.validateIngestion(payload);
    return this.jobnik.createIngestionJob(payload);
  }

  public async deleteRecord(id: string): Promise<JobResponse> {
    const logContext = { ...this.logContext, function: this.deleteRecord.name };
    this.logger.info({ msg: 'creating delete job', logContext, recordId: id });
    const record = await this.validator.validateDelete(id);
    return this.jobnik.createDeleteJob(record);
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
