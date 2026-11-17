/* eslint-disable @typescript-eslint/naming-convention */
import { jsLogger } from '@map-colonies/js-logger';
import { Registry } from 'prom-client';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import {
  AppError,
  STAGE_TYPES,
  deleteFilesTaskSchema,
  extract3tzTaskSchema,
  insertPartsTaskSchema,
  insertRecordTaskSchema,
  jobDataSchema,
  planUploadTaskSchema,
  validateShapefilesTaskSchema,
} from '@map-colonies/3d-shared';
import type { z } from 'zod';
import type { ConfigType } from '@src/common/config';
import type { IngestionJobInput } from '@src/externalServices/jobnik/interfaces';
import { ERROR_JOBNIK_CREATE_JOB, ERROR_JOBNIK_IN_FLIGHT_QUERY, JobnikClient } from '@src/externalServices/jobnik/jobnikClient';

const sdkMock = vi.hoisted(() => ({
  createJob: vi.fn(),
  createStage: vi.fn(),
  createTasks: vi.fn(),
  GET: vi.fn(),
  PUT: vi.fn(),
}));

vi.mock('@map-colonies/jobnik-sdk', () => ({
  JobnikSDK: vi.fn().mockImplementation(function () {
    return {
      getProducer: (): unknown => ({ createJob: sdkMock.createJob, createStage: sdkMock.createStage, createTasks: sdkMock.createTasks }),
      getApiClient: (): unknown => ({ GET: sdkMock.GET, PUT: sdkMock.PUT }),
    };
  }),
}));

const TASK_SCHEMAS: Partial<Record<string, z.ZodTypeAny>> = {
  [STAGE_TYPES.validateShapefiles]: validateShapefilesTaskSchema,
  [STAGE_TYPES.extract3tz]: extract3tzTaskSchema,
  [STAGE_TYPES.planUpload]: planUploadTaskSchema,
  [STAGE_TYPES.deleteTempFiles]: deleteFilesTaskSchema,
  [STAGE_TYPES.insertParts]: insertPartsTaskSchema,
  [STAGE_TYPES.insertRecord]: insertRecordTaskSchema,
};

const modelId = '0b2f7f8e-4c8e-4f7c-9a52-6a1f3c2d9e10';

const input = (modelPath: string): IngestionJobInput => ({
  modelId,
  productId: 'p-1',
  productName: 'paris',
  modelPath,
  metadataShapefilePath: 'paris/shape/ShapeMetadata.shp',
  metadata: {
    productId: 'p-1',
    productName: 'paris',
    productType: '3DPhotoRealistic',
    classification: 'abc123',
    srsId: '4326',
    srsName: 'WGS84GEO',
    producerName: 'IDFMU',
    productionSystem: 'sys',
    productionSystemVersion: '1',
    productionDate: '2025-07-10T00:00:00.000Z',
    imagingTimeBeginUTC: new Date('2025-07-06T00:00:00.000Z'),
    imagingTimeEndUTC: new Date('2025-07-08T00:00:00.000Z'),
    minResolutionMeter: 0.5,
    maxResolutionMeter: 1,
    maxAbsoluteAccuracyCEP90: 2.5,
    maxAbsoluteAccuracyLEP90: 3,
    sensors: ['UAV'],
  },
  footprint: {
    type: 'Polygon',
    coordinates: [
      [
        [2.33, 48.85],
        [2.35, 48.85],
        [2.35, 48.87],
        [2.33, 48.85],
      ],
    ],
  },
  region: ['France'],
});

const config = { get: vi.fn().mockReturnValue('http://jobnik') } as unknown as ConfigType;

const createdStageTypes = (): string[] => sdkMock.createStage.mock.calls.map((call) => (call[1] as { type: string }).type);
const taskCalls = (): { stageId: string; type: string; data: unknown }[] =>
  sdkMock.createTasks.mock.calls.map((call) => ({
    stageId: call[0] as string,
    type: call[1] as string,
    data: (call[2] as { data: unknown }[])[0]?.data,
  }));
const taskOf = (type: string): unknown => taskCalls().find((call) => call.type === type)?.data;

describe('JobnikClient', function () {
  const create = async (): Promise<JobnikClient> => new JobnikClient(config, await jsLogger({ enabled: false }), new Registry());

  beforeEach(function () {
    vi.clearAllMocks();
    sdkMock.createJob.mockResolvedValue({ id: 'job-1', status: 'PENDING' });
    sdkMock.createStage.mockImplementation(async (_jobId: string, stage: { type: string }) => Promise.resolve({ id: `stage-${stage.type}` }));
    sdkMock.createTasks.mockResolvedValue([]);
    sdkMock.PUT.mockResolvedValue({ error: undefined });
  });

  describe('createIngestionJob', function () {
    it('should create the five stages of a tileset folder in order', async function () {
      const client = await create();

      const result = await client.createIngestionJob(input('paris/data/tileset.json'));

      expect(result).toEqual({ jobId: 'job-1', status: 'PENDING' });
      expect(createdStageTypes()).toEqual([
        STAGE_TYPES.validateShapefiles,
        STAGE_TYPES.planUpload,
        STAGE_TYPES.uploadFiles,
        STAGE_TYPES.insertParts,
        STAGE_TYPES.insertRecord,
      ]);
    });

    it('should create the job with the model and product identity', async function () {
      const client = await create();

      await client.createIngestionJob(input('paris/data/tileset.json'));

      const job = sdkMock.createJob.mock.calls[0]?.[0] as { name: string; data: unknown };

      expect(job.name).toBe('3D-Ingestion');
      expect(jobDataSchema.parse(job.data)).toEqual({ modelId, productId: 'p-1', productName: 'paris' });
    });

    it('should create every stage before any task, and the tasks from the last stage to the first', async function () {
      const client = await create();

      await client.createIngestionJob(input('paris/data/model.3tz'));

      const lastStageCall = Math.max(...sdkMock.createStage.mock.invocationCallOrder);
      const firstTaskCall = Math.min(...sdkMock.createTasks.mock.invocationCallOrder);

      expect(lastStageCall).toBeLessThan(firstTaskCall);
      expect(taskCalls().map((call) => call.type)).toEqual([
        STAGE_TYPES.insertRecord,
        STAGE_TYPES.insertParts,
        STAGE_TYPES.deleteTempFiles,
        STAGE_TYPES.planUpload,
        STAGE_TYPES.extract3tz,
        STAGE_TYPES.validateShapefiles,
      ]);
      expect(taskCalls().every((call) => call.stageId === `stage-${call.type}`)).toBe(true);
    });

    it('should create the seven stages of a 3tz in order', async function () {
      const client = await create();

      await client.createIngestionJob(input('paris/data/model.3tz'));

      expect(createdStageTypes()).toEqual([
        STAGE_TYPES.validateShapefiles,
        STAGE_TYPES.extract3tz,
        STAGE_TYPES.planUpload,
        STAGE_TYPES.uploadFiles,
        STAGE_TYPES.deleteTempFiles,
        STAGE_TYPES.insertParts,
        STAGE_TYPES.insertRecord,
      ]);
    });

    it('should create task data that matches the shared task schema of every stage', async function () {
      const client = await create();

      await client.createIngestionJob(input('paris/data/model.3tz'));

      const results = taskCalls().map(({ type, data }) => ({ type, valid: TASK_SCHEMAS[type]?.safeParse(data).success }));

      expect(results.filter((result) => result.valid !== true)).toEqual([]);
    });

    it('should upload the folder of a tileset and keep its file name', async function () {
      const client = await create();

      await client.createIngestionJob(input('paris/data/nested/root.json'));

      expect(taskOf(STAGE_TYPES.planUpload)).toEqual({ sourceDir: 'paris/data/nested', s3KeyPrefix: modelId });
      expect(taskOf(STAGE_TYPES.insertRecord)).toMatchObject({ modelId, tilesetFilename: 'root.json' });
    });

    it('should extract a 3tz into a temp folder named by the model id, upload it and delete it', async function () {
      const client = await create();

      await client.createIngestionJob(input('paris/data/model.3tz'));

      expect(taskOf(STAGE_TYPES.extract3tz)).toEqual({ archivePath: 'paris/data/model.3tz', tempDir: modelId });
      expect(taskOf(STAGE_TYPES.planUpload)).toEqual({ sourceDir: modelId, s3KeyPrefix: modelId });
      expect(taskOf(STAGE_TYPES.deleteTempFiles)).toEqual({ storageProvider: 'FS', paths: [modelId] });
      expect(taskOf(STAGE_TYPES.insertRecord)).toMatchObject({ tilesetFilename: 'tileset.json' });
    });

    it('should not create a task for the upload-files stage', async function () {
      const client = await create();

      await client.createIngestionJob(input('paris/data/tileset.json'));

      expect(taskOf(STAGE_TYPES.uploadFiles)).toBeUndefined();
    });

    it('should abort the job and throw 500 when creating a task fails', async function () {
      sdkMock.createTasks.mockRejectedValueOnce(new Error('jobnik down'));
      const client = await create();

      const error = await client.createIngestionJob(input('paris/data/tileset.json')).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: StatusCodes.INTERNAL_SERVER_ERROR, message: ERROR_JOBNIK_CREATE_JOB });
      expect(sdkMock.PUT).toHaveBeenCalledWith('/v1/jobs/{jobId}/status', { params: { path: { jobId: 'job-1' } }, body: { status: 'ABORTED' } });
    });

    it('should still throw the creation error when the abort fails too', async function () {
      sdkMock.createStage.mockRejectedValueOnce(new Error('jobnik down'));
      sdkMock.PUT.mockRejectedValueOnce(new Error('abort failed'));
      const client = await create();

      await expect(client.createIngestionJob(input('paris/data/tileset.json'))).rejects.toThrow(ERROR_JOBNIK_CREATE_JOB);
    });

    it('should not abort when the job itself could not be created', async function () {
      sdkMock.createJob.mockRejectedValueOnce(new Error('jobnik down'));
      const client = await create();

      await expect(client.createIngestionJob(input('paris/data/tileset.json'))).rejects.toThrow(ERROR_JOBNIK_CREATE_JOB);
      expect(sdkMock.createStage).not.toHaveBeenCalled();
      expect(sdkMock.PUT).not.toHaveBeenCalled();
    });
  });

  describe('hasInFlightIngestionJob', function () {
    const product = { productId: 'p-1', productName: 'paris' };
    const job = (status: string, data: Record<string, unknown>): Record<string, unknown> => ({ id: `job-${status}`, status, data });

    it.each(['CREATED', 'PENDING', 'IN_PROGRESS', 'PAUSED'])('should find a %s job of the same product id', async function (status) {
      sdkMock.GET.mockResolvedValue({ data: { items: [job(status, { productId: 'p-1', productName: 'other' })] } });
      const client = await create();

      await expect(client.hasInFlightIngestionJob(product)).resolves.toBe(true);
    });

    it('should find a running job of the same product name', async function () {
      sdkMock.GET.mockResolvedValue({ data: { items: [job('IN_PROGRESS', { productId: 'other', productName: 'paris' })] } });
      const client = await create();

      await expect(client.hasInFlightIngestionJob(product)).resolves.toBe(true);
    });

    it.each(['COMPLETED', 'FAILED', 'ABORTED'])('should ignore a %s job of the same product', async function (status) {
      sdkMock.GET.mockResolvedValue({ data: { items: [job(status, product)] } });
      const client = await create();

      await expect(client.hasInFlightIngestionJob(product)).resolves.toBe(false);
    });

    it('should look through the next pages', async function () {
      const fullPage = Array.from({ length: 100 }, (_, index) => job('IN_PROGRESS', { productId: `p-${index + 2}`, productName: `n-${index}` }));
      sdkMock.GET.mockResolvedValueOnce({ data: { items: fullPage } }).mockResolvedValueOnce({ data: { items: [job('PENDING', product)] } });
      const client = await create();

      await expect(client.hasInFlightIngestionJob(product)).resolves.toBe(true);
      expect(sdkMock.GET).toHaveBeenCalledTimes(2);
      expect(sdkMock.GET).toHaveBeenLastCalledWith('/v1/jobs', { params: { query: { job_name: '3D-Ingestion', page: 2, page_size: 100 } } });
    });

    it('should throw 500 when Jobnik cannot be queried', async function () {
      sdkMock.GET.mockResolvedValue({ error: { message: 'boom' } });
      const client = await create();

      await expect(client.hasInFlightIngestionJob(product)).rejects.toThrow(ERROR_JOBNIK_IN_FLIGHT_QUERY);
    });
  });
});
