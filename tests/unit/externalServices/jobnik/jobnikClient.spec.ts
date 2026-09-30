import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import { Registry } from 'prom-client';
import { JobnikClient } from '@src/externalServices/jobnik/jobnikClient';
import { STAGE_TYPES } from '@src/common/constants';
import type { ConfigType } from '@src/common/config';
import type { IngestionPayload } from '@src/records/models/recordManager';

const jobManagerConfig = {
  url: 'http://job-manager',
  ingestion: { jobType: 'Ingestion_New_3D', taskType: 'tilesCopying', batches: 100 },
  delete: { jobType: 'Delete_3D', taskType: 'deleteModel' },
};

const producerMock = vi.hoisted(() => ({
  createJob: vi.fn(),
  createStage: vi.fn(),
  createTasks: vi.fn(),
}));

const apiClientMock = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- mirrors the SDK ApiClient.GET method
  GET: vi.fn(),
}));

vi.mock('@map-colonies/jobnik-sdk', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  JobnikSDK: class {
    public getProducer(): typeof producerMock {
      return producerMock;
    }
    public getApiClient(): typeof apiClientMock {
      return apiClientMock;
    }
  },
}));

const configStub = { get: (): unknown => jobManagerConfig } as unknown as ConfigType;

const buildPayload = (modelPath: string): IngestionPayload => ({
  modelPath,
  tilesetFilename: 'tileset.json',
  metadata: { productName: 'afula' },
});

describe('JobnikClient', function () {
  let client: JobnikClient;

  beforeEach(async function () {
    vi.clearAllMocks();
    producerMock.createJob.mockResolvedValue({ id: 'job-1', status: 'PENDING' });
    producerMock.createStage.mockResolvedValue({ id: 'stage-1' });
    producerMock.createTasks.mockResolvedValue([]);
    apiClientMock.GET.mockResolvedValue({ data: { total: 0, items: [] } });
    client = new JobnikClient(configStub, await jsLogger({ enabled: false }), new Registry());
  });

  it('should create the ingestion job and a validation stage for a folder input', async function () {
    const result = await client.createIngestionJob(buildPayload('/shared/models/afula'));

    expect(producerMock.createJob).toHaveBeenCalledWith(expect.objectContaining({ name: jobManagerConfig.ingestion.jobType }));

    const folderStageTypes = (producerMock.createStage.mock.calls as [string, { type: string }][]).map((call) => call[1].type);

    expect(folderStageTypes).toEqual([
      STAGE_TYPES.VALIDATION,
      STAGE_TYPES.CREATE_UPLOAD_MODEL_TASKS,
      STAGE_TYPES.UPLOAD_MODEL_DATA,
      STAGE_TYPES.UPLOAD_MODEL_PARTS,
      STAGE_TYPES.INGESTION_FINALIZER,
    ]);

    const validationTaskCall = (producerMock.createTasks.mock.calls as [string, string, { data: { metadata?: unknown } }[]][]).find(
      (call) => call[1] === STAGE_TYPES.VALIDATION
    );

    expect(validationTaskCall?.[2][0]?.data.metadata).toEqual({ productName: 'afula' });
    expect(result).toEqual({ jobId: 'job-1', status: 'PENDING' });
  });

  it('should also create the data-extraction and clear-data stages for a 3tz input', async function () {
    await client.createIngestionJob(buildPayload('/shared/models/afula.3tz'));

    const stageTypes = (producerMock.createStage.mock.calls as [string, { type: string }][]).map((call) => call[1].type);

    expect(stageTypes).toEqual([
      STAGE_TYPES.DATA_EXTRACTION,
      STAGE_TYPES.VALIDATION,
      STAGE_TYPES.CREATE_UPLOAD_MODEL_TASKS,
      STAGE_TYPES.UPLOAD_MODEL_DATA,
      STAGE_TYPES.CLEAR_DATA,
      STAGE_TYPES.UPLOAD_MODEL_PARTS,
      STAGE_TYPES.INGESTION_FINALIZER,
    ]);
  });

  it('should create a delete job with the record details', async function () {
    const result = await client.createDeleteJob({ id: 'rec-1', productId: 'p-1', productName: 'afula', productType: '3DPhotoRealistic' });

    expect(producerMock.createJob).toHaveBeenCalledWith(expect.objectContaining({ name: jobManagerConfig.delete.jobType }));
    expect(result).toEqual({ jobId: 'job-1', status: 'PENDING' });
  });

  describe('hasInFlightIngestionJob', function () {
    it('should query jobs by the ingestion job name', async function () {
      await client.hasInFlightIngestionJob('afula');

      expect(apiClientMock.GET).toHaveBeenCalledWith('/v1/jobs', {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- Jobnik query params are snake_case
        params: { query: { job_name: jobManagerConfig.ingestion.jobType, page: 1, page_size: 100 } },
      });
    });

    it('should return true when a non-terminal job matches the product name', async function () {
      apiClientMock.GET.mockResolvedValueOnce({
        data: { total: 1, items: [{ status: 'IN_PROGRESS', data: { metadata: { productName: 'afula' } } }] },
      });

      await expect(client.hasInFlightIngestionJob('afula')).resolves.toBe(true);
    });

    it('should return false when the only matching job is in a terminal status', async function () {
      apiClientMock.GET.mockResolvedValueOnce({
        data: { total: 1, items: [{ status: 'COMPLETED', data: { metadata: { productName: 'afula' } } }] },
      });

      await expect(client.hasInFlightIngestionJob('afula')).resolves.toBe(false);
    });

    it('should return false when no in-flight job matches the product name', async function () {
      apiClientMock.GET.mockResolvedValueOnce({
        data: { total: 1, items: [{ status: 'PENDING', data: { metadata: { productName: 'haifa' } } }] },
      });

      await expect(client.hasInFlightIngestionJob('afula')).resolves.toBe(false);
    });

    it('should page through results and match a job on a later page', async function () {
      const fullPage = Array.from({ length: 100 }, () => ({ status: 'IN_PROGRESS', data: { metadata: { productName: 'haifa' } } }));
      apiClientMock.GET.mockResolvedValueOnce({ data: { total: 101, items: fullPage } });
      apiClientMock.GET.mockResolvedValueOnce({
        data: { total: 101, items: [{ status: 'PENDING', data: { metadata: { productName: 'afula' } } }] },
      });

      await expect(client.hasInFlightIngestionJob('afula')).resolves.toBe(true);
      expect(apiClientMock.GET).toHaveBeenNthCalledWith(2, '/v1/jobs', {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- Jobnik query params are snake_case
        params: { query: { job_name: jobManagerConfig.ingestion.jobType, page: 2, page_size: 100 } },
      });
    });

    it('should stop paging once a page is shorter than the page size', async function () {
      apiClientMock.GET.mockResolvedValueOnce({ data: { total: 1, items: [{ status: 'PENDING', data: { metadata: { productName: 'haifa' } } }] } });

      await expect(client.hasInFlightIngestionJob('afula')).resolves.toBe(false);
      expect(apiClientMock.GET).toHaveBeenCalledTimes(1);
    });

    it('should throw an AppError when the jobs query returns an error', async function () {
      apiClientMock.GET.mockResolvedValueOnce({ error: { message: 'boom' } });

      await expect(client.hasInFlightIngestionJob('afula')).rejects.toThrow(/failed querying Jobnik/);
    });
  });
});
