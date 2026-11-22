import { basename, extname, posix } from 'node:path';
import { inject, singleton } from 'tsyringe';
import { StatusCodes } from 'http-status-codes';
import type { Logger } from '@map-colonies/js-logger';
import type { Registry } from 'prom-client';
import { JobnikSDK, type Job } from '@map-colonies/jobnik-sdk';
import {
  AppError,
  JOB_TYPES,
  PRODUCT_VERSION,
  STAGE_TYPES,
  STORAGE_PROVIDERS,
  type JobData3D,
  type Jobs3D,
  type LogContext,
  type Stages3D,
} from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import { ARCHIVE_EXTENSION, TILESET_FILENAME } from '../../extractor/constants';
import type { JobResponse } from '../../record/models/recordManager';
import type { IngestionJobInput, ProductKey, StagePlan } from './interfaces';

const IN_FLIGHT_JOB_STATUSES: readonly Job['status'][] = ['CREATED', 'PENDING', 'IN_PROGRESS', 'PAUSED'];
const JOBS_PAGE_SIZE = 100;

export const ERROR_JOBNIK_CREATE_JOB = 'failed creating the ingestion job in Jobnik';
export const ERROR_JOBNIK_IN_FLIGHT_QUERY = 'failed querying Jobnik for in-flight jobs';

@singleton()
export class JobnikClient {
  private readonly logContext: LogContext;
  private readonly sdk: JobnikSDK<Jobs3D, Stages3D>;

  public constructor(
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.METRICS) metricsRegistry: Registry
  ) {
    this.sdk = new JobnikSDK<Jobs3D, Stages3D>({ baseUrl: config.get('jobnik.url'), metricsRegistry });
    this.logContext = {
      fileName: __filename,
      class: JobnikClient.name,
    };
  }

  public async hasInFlightIngestionJob(product: ProductKey): Promise<boolean> {
    const logContext = { ...this.logContext, function: this.hasInFlightIngestionJob.name };
    const apiClient = this.sdk.getApiClient();

    for (let page = 1; ; page++) {
      const { data, error } = await apiClient.GET('/v1/jobs', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        params: { query: { job_name: JOB_TYPES.ingestion, page, page_size: JOBS_PAGE_SIZE } },
      });
      if (error !== undefined) {
        this.logger.error({ msg: ERROR_JOBNIK_IN_FLIGHT_QUERY, logContext, product, err: error });
        throw new AppError('jobnik', StatusCodes.INTERNAL_SERVER_ERROR, ERROR_JOBNIK_IN_FLIGHT_QUERY, false);
      }

      const match = data.items.find((job) => {
        const jobData = job.data as Partial<JobData3D>;
        return (
          IN_FLIGHT_JOB_STATUSES.includes(job.status) && (jobData.productId === product.productId || jobData.productName === product.productName)
        );
      });
      if (match !== undefined) {
        this.logger.info({ msg: 'in-flight ingestion job found', logContext, product, jobId: match.id });
        return true;
      }
      if (data.items.length < JOBS_PAGE_SIZE) {
        return false;
      }
    }
  }

  public async createIngestionJob(input: IngestionJobInput): Promise<JobResponse> {
    const logContext = { ...this.logContext, function: this.createIngestionJob.name };
    const plan = this.planIngestionStages(input);
    const producer = this.sdk.getProducer();

    let job: Job;
    try {
      job = await producer.createJob({
        name: JOB_TYPES.ingestion,
        data: { modelId: input.modelId, productId: input.productId, productName: input.productName },
        userMetadata: {},
      });
    } catch (err) {
      this.logger.error({ msg: ERROR_JOBNIK_CREATE_JOB, logContext, modelId: input.modelId, err });
      throw new AppError('jobnik', StatusCodes.INTERNAL_SERVER_ERROR, ERROR_JOBNIK_CREATE_JOB, false);
    }

    try {
      const created = [];
      for (const stage of plan) {
        created.push({ stage, id: (await producer.createStage(job.id, { type: stage.type, data: {}, userMetadata: {} })).id });
      }

      for (const { stage, id } of created.reverse()) {
        if (stage.task !== undefined) {
          await producer.createTasks(id, stage.type, [{ data: stage.task, userMetadata: {} }]);
        }
      }
    } catch (err) {
      this.logger.error({ msg: ERROR_JOBNIK_CREATE_JOB, logContext, jobId: job.id, modelId: input.modelId, err });
      await this.abortJob(job.id);
      throw new AppError('jobnik', StatusCodes.INTERNAL_SERVER_ERROR, ERROR_JOBNIK_CREATE_JOB, false);
    }

    this.logger.info({ msg: 'ingestion job created', logContext, jobId: job.id, modelId: input.modelId, stages: plan.map((stage) => stage.type) });
    return { jobId: job.id, status: job.status };
  }

  private planIngestionStages(input: IngestionJobInput): StagePlan[] {
    const is3tz = extname(input.modelPath).toLowerCase() === ARCHIVE_EXTENSION;
    const tempDir = input.modelId;
    const sourceDir = is3tz ? tempDir : posix.dirname(input.modelPath);
    const tilesetFilename = is3tz ? TILESET_FILENAME : basename(input.modelPath);

    const plan: (StagePlan | false)[] = [
      { type: STAGE_TYPES.validateShapefiles, task: { modelId: input.modelId, metadataShapefilePath: input.metadataShapefilePath } },
      is3tz && { type: STAGE_TYPES.extract3tz, task: { archivePath: input.modelPath, tempDir } },
      { type: STAGE_TYPES.planUpload, task: { sourceDir, s3KeyPrefix: input.modelId } },
      { type: STAGE_TYPES.uploadFiles },
      is3tz && { type: STAGE_TYPES.deleteTempFiles, task: { storageProvider: STORAGE_PROVIDERS.FS, paths: [tempDir] } },
      {
        type: STAGE_TYPES.insertParts,
        task: { modelId: input.modelId, metadataShapefilePath: input.metadataShapefilePath, productVersion: PRODUCT_VERSION },
      },
      {
        type: STAGE_TYPES.insertRecord,
        task: { modelId: input.modelId, tilesetFilename, metadata: input.metadata, footprint: input.footprint, region: input.region },
      },
    ];
    return plan.filter((stage): stage is StagePlan => stage !== false);
  }

  private async abortJob(jobId: Job['id']): Promise<void> {
    const logContext = { ...this.logContext, function: this.abortJob.name };
    try {
      const { error } = await this.sdk.getApiClient().PUT('/v1/jobs/{jobId}/status', {
        params: { path: { jobId } },
        body: { status: 'ABORTED' },
      });
      if (error !== undefined) {
        this.logger.error({ msg: 'failed aborting the partially created job', logContext, jobId, err: error });
      }
    } catch (err) {
      this.logger.error({ msg: 'failed aborting the partially created job', logContext, jobId, err });
    }
  }
}
