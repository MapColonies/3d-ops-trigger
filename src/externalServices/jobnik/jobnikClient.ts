import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import type { Registry } from 'prom-client';
import { JobnikSDK } from '@map-colonies/jobnik-sdk';
import { SERVICES, STAGE_TYPES } from '@common/constants';
import { is3tz } from '@common/util';
import type { ConfigType, JobManagerConfig } from '@common/config';
import type { LogContext } from '@common/interfaces';
import type { IngestionPayload, JobResponse } from '../../record/models/recordManager';
import type { Record3D } from '../catalog/interfaces';

interface StageDescriptor {
  type: string;
  data: Record<string, unknown>;
  task?: Record<string, unknown>;
  only3tz?: boolean;
}

@injectable()
export class JobnikClient {
  private readonly logContext: LogContext;
  private readonly producer: ReturnType<JobnikSDK['getProducer']>;
  private readonly jobManager: JobManagerConfig;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.METRICS) private readonly metricsRegistry: Registry
  ) {
    this.jobManager = this.config.get('jobManager');
    const sdk = new JobnikSDK({ baseUrl: this.jobManager.url, metricsRegistry: this.metricsRegistry });
    this.producer = sdk.getProducer();
    this.logContext = {
      fileName: __filename,
      class: JobnikClient.name,
    };
  }

  public async createIngestionJob(payload: IngestionPayload): Promise<JobResponse> {
    const logContext = { ...this.logContext, function: this.createIngestionJob.name };
    const isArchive = is3tz(payload.modelPath);

    const job = await this.producer.createJob({
      name: this.jobManager.ingestion.jobType,
      data: { modelPath: payload.modelPath, tilesetFilename: payload.tilesetFilename, metadata: payload.metadata },
    });

    const stages: StageDescriptor[] = [
      {
        type: STAGE_TYPES.DATA_EXTRACTION,
        data: { modelPath: payload.modelPath },
        task: { modelPath: payload.modelPath, tilesetFilename: payload.tilesetFilename },
        only3tz: true,
      },
      {
        type: STAGE_TYPES.VALIDATION,
        data: {},
        task: { modelPath: payload.modelPath, tilesetFilename: payload.tilesetFilename, metadata: payload.metadata },
      },
      {
        type: STAGE_TYPES.CREATE_UPLOAD_MODEL_TASKS,
        data: {},
        task: { modelPath: payload.modelPath, tilesetFilename: payload.tilesetFilename },
      },
      { type: STAGE_TYPES.UPLOAD_MODEL_DATA, data: {} },
      { type: STAGE_TYPES.CLEAR_DATA, data: { modelPath: payload.modelPath }, task: { modelPath: payload.modelPath }, only3tz: true },
      { type: STAGE_TYPES.UPLOAD_MODEL_PARTS, data: {}, task: { metadata: payload.metadata } },
      { type: STAGE_TYPES.INGESTION_FINALIZER, data: { metadata: payload.metadata }, task: { metadata: payload.metadata } },
    ];

    for (const descriptor of stages) {
      if (descriptor.only3tz === true && !isArchive) {
        continue;
      }
      const stage = await this.producer.createStage(job.id, { type: descriptor.type, data: descriptor.data });
      if (descriptor.task !== undefined) {
        await this.producer.createTasks(stage.id, descriptor.type, [{ data: descriptor.task }]);
      }
    }

    this.logger.info({ msg: 'ingestion job created', logContext, jobId: job.id, is3tz: isArchive });

    return { jobId: job.id, status: job.status };
  }

  public async createDeleteJob(record: Record3D): Promise<JobResponse> {
    const logContext = { ...this.logContext, function: this.createDeleteJob.name };

    const job = await this.producer.createJob({
      name: this.jobManager.delete.jobType,
      data: {
        modelId: record.id,
        productId: record.productId,
        productVersion: record.productVersion,
        productName: record.productName,
        productType: record.productType,
        producerName: record.producerName,
      },
    });

    this.logger.info({ msg: 'delete job created', logContext, jobId: job.id, recordId: record.id });

    return { jobId: job.id, status: job.status };
  }
}
