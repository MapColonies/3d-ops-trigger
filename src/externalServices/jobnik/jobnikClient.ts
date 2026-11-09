import { extname } from 'node:path';
import { inject, singleton } from 'tsyringe';
import { StatusCodes } from 'http-status-codes';
import type { Logger } from '@map-colonies/js-logger';
import type { Registry } from 'prom-client';
import { JobnikSDK } from '@map-colonies/jobnik-sdk';
import { AppError, type LogContext, type Record3D } from '@map-colonies/3d-shared';
import { IN_FLIGHT_JOB_STATUSES, SERVICES, STAGE_TYPES } from '@common/constants';
import type { ConfigType, JobManagerConfig } from '@common/config';
import { ARCHIVE_EXTENSION } from '../../extractor/constants';
import type { JobResponse } from '../../record/models/recordManager';
import type { IngestionJobInput } from './interfaces';

interface StageDescriptor {
  type: string;
  data: Record<string, unknown>;
  task?: Record<string, unknown>;
  only3tz?: boolean;
}

export const ERROR_JOBNIK_IN_FLIGHT_QUERY = 'failed querying Jobnik for in-flight jobs';

@singleton()
export class JobnikClient {
  private readonly logContext: LogContext;
  private readonly producer: ReturnType<JobnikSDK['getProducer']>;
  private readonly apiClient: ReturnType<JobnikSDK['getApiClient']>;
  private readonly jobManager: JobManagerConfig;

  public constructor(
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.METRICS) metricsRegistry: Registry
  ) {
    this.jobManager = config.get('jobManager');
    const sdk = new JobnikSDK({ baseUrl: this.jobManager.url, metricsRegistry });
    this.producer = sdk.getProducer();
    this.apiClient = sdk.getApiClient();
    this.logContext = {
      fileName: __filename,
      class: JobnikClient.name,
    };
  }

  public async hasInFlightIngestionJob(productName: string): Promise<boolean> {
    const logContext = { ...this.logContext, function: this.hasInFlightIngestionJob.name };
    const pageSize = 100;

    for (let page = 1; ; page++) {
      const { data, error } = await this.apiClient.GET('/v1/jobs', {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- Jobnik query params are snake_case
        params: { query: { job_name: this.jobManager.ingestion.jobType, page, page_size: pageSize } },
      });
      if (error !== undefined) {
        this.logger.error({ msg: ERROR_JOBNIK_IN_FLIGHT_QUERY, logContext, productName, err: error });
        throw new AppError('jobnik', StatusCodes.INTERNAL_SERVER_ERROR, ERROR_JOBNIK_IN_FLIGHT_QUERY, false);
      }

      const jobs = data.items;
      const match = jobs.some((job) => {
        const metadata = (job.data as { metadata?: { productName?: string } }).metadata;
        return IN_FLIGHT_JOB_STATUSES.includes(job.status) && metadata?.productName === productName;
      });
      if (match) {
        this.logger.debug({ msg: 'in-flight ingestion job found', logContext, productName });
        return true;
      }
      if (jobs.length < pageSize) {
        return false;
      }
    }
  }

  public async createIngestionJob(input: IngestionJobInput): Promise<JobResponse> {
    const logContext = { ...this.logContext, function: this.createIngestionJob.name };
    const { modelPath, metadata } = input;
    const isArchive = extname(modelPath).toLowerCase() === ARCHIVE_EXTENSION;

    const job = await this.producer.createJob({
      name: this.jobManager.ingestion.jobType,
      data: { modelPath, metadata },
    });

    const stages: StageDescriptor[] = [
      { type: STAGE_TYPES.DATA_EXTRACTION, data: { modelPath }, task: { modelPath }, only3tz: true },
      { type: STAGE_TYPES.VALIDATION, data: {}, task: { modelPath, metadata } },
      { type: STAGE_TYPES.CREATE_UPLOAD_MODEL_TASKS, data: {}, task: { modelPath } },
      { type: STAGE_TYPES.UPLOAD_MODEL_DATA, data: {} },
      { type: STAGE_TYPES.CLEAR_DATA, data: { modelPath }, task: { modelPath }, only3tz: true },
      { type: STAGE_TYPES.UPLOAD_MODEL_PARTS, data: {}, task: { metadata } },
      { type: STAGE_TYPES.INGESTION_FINALIZER, data: { metadata }, task: { metadata } },
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
