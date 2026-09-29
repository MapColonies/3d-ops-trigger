import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import { Registry } from 'prom-client';
import { JobnikClient } from '@src/externalServices/jobnik/jobnikClient';
import { STAGE_TYPES } from '@src/common/constants';
import type { ConfigType } from '@src/common/config';
import type { IngestionPayload } from '@src/record/models/recordManager';

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

vi.mock('@map-colonies/jobnik-sdk', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  JobnikSDK: class {
    public getProducer(): typeof producerMock {
      return producerMock;
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
});
