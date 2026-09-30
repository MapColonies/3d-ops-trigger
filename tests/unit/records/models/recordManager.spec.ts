import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordManager, type IngestionPayload } from '@src/records/models/recordManager';
import type { ValidationManager } from '@src/validator/validationManager';
import type { JobnikClient } from '@src/externalServices/jobnik/jobnikClient';
import type { CatalogCall } from '@src/externalServices/catalog/catalogCall';

const noopValidator = {
  validateIngestion: vi.fn().mockResolvedValue(undefined),
  validateDelete: vi.fn().mockResolvedValue({ id: 'rec-1', productName: 'afula' }),
  validateUpdate: vi.fn().mockResolvedValue({ id: 'rec-1', productName: 'afula' }),
  validateStatusChange: vi.fn().mockResolvedValue({ id: 'rec-1', productName: 'afula' }),
  ensureRecordAbsentFromExtractable: vi.fn().mockResolvedValue(undefined),
} as unknown as ValidationManager;
const jobnikStub = {
  createIngestionJob: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'PENDING' }),
  createDeleteJob: vi.fn().mockResolvedValue({ jobId: 'del-1', status: 'PENDING' }),
} as unknown as JobnikClient;
const patchMetadataMock = vi.fn().mockResolvedValue({ id: 'rec-1' });
const changeStatusMock = vi.fn().mockResolvedValue({ id: 'rec-1' });
const catalogStub = {
  patchMetadata: patchMetadataMock,
  changeStatus: changeStatusMock,
} as unknown as CatalogCall;

describe('RecordManager', function () {
  let manager: RecordManager;

  beforeEach(async function () {
    manager = new RecordManager(await jsLogger({ enabled: false }), noopValidator, jobnikStub, catalogStub);
  });

  describe('createIngestion', function () {
    it('should return a job response with a jobId and status', async function () {
      const payload: IngestionPayload = {
        modelPath: '/shared/models/afula',
        tilesetFilename: 'tileset.json',
        metadata: { productName: 'afula' },
      };

      const result = await manager.createIngestion(payload);

      expect(result.jobId).toBeTypeOf('string');
      expect(result.status).toBeTypeOf('string');
    });
  });

  describe('deleteRecord', function () {
    it('should create the delete job and set the catalog status to BEING_DELETED', async function () {
      const result = await manager.deleteRecord('rec-1');

      expect(result.jobId).toBeTypeOf('string');
      expect(result.status).toBeTypeOf('string');
      expect(changeStatusMock).toHaveBeenCalledWith('rec-1', { productStatus: 'BEING_DELETED' });
    });
  });

  describe('updateMetadata', function () {
    it('should validate, guard extractable, patch the catalog and return an ack', async function () {
      const result = await manager.updateMetadata('rec-1', { description: 'x' });

      expect(patchMetadataMock).toHaveBeenCalledWith('rec-1', expect.objectContaining({ description: 'x' }));
      expect(result.message).toContain('rec-1');
    });
  });

  describe('updateStatus', function () {
    it('should validate, guard extractable, change the catalog status and return an ack', async function () {
      const result = await manager.updateStatus('rec-1', { status: 'PUBLISHED' });

      expect(changeStatusMock).toHaveBeenCalledWith('rec-1', { productStatus: 'PUBLISHED' });
      expect(result.message).toContain('PUBLISHED');
    });
  });
});
