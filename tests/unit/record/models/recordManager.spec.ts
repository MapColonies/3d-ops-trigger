import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordManager, type IngestionPayload } from '@src/record/models/recordManager';
import type { ValidationManager } from '@src/validator/validationManager';

const noopValidator = { validateIngestion: vi.fn().mockResolvedValue(undefined) } as unknown as ValidationManager;

describe('RecordManager', function () {
  let manager: RecordManager;

  beforeEach(async function () {
    manager = new RecordManager(await jsLogger({ enabled: false }), noopValidator);
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
    it('should return a job response', function () {
      const result = manager.deleteRecord('rec-1');

      expect(result.jobId).toBeTypeOf('string');
      expect(result.status).toBeTypeOf('string');
    });
  });

  describe('updateMetadata', function () {
    it('should return an ack referencing the record id', function () {
      const result = manager.updateMetadata('rec-1', { description: 'x' });

      expect(result.message).toContain('rec-1');
    });
  });

  describe('updateStatus', function () {
    it('should return an ack referencing the requested status', function () {
      const result = manager.updateStatus('rec-1', { status: 'PUBLISHED' });

      expect(result.message).toContain('PUBLISHED');
    });
  });
});
