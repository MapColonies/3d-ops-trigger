import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordManager, type IngestionPayload } from '@src/record/models/recordManager';
import type { ValidationManager } from '@src/validator/validationManager';
import type { FilesValidator } from '@src/validator/filesValidator';
import type { MetadataExtractor } from '@src/extractor/metadataExtractor';

describe('RecordManager', function () {
  let manager: RecordManager;
  let validator: { validateIngestion: ReturnType<typeof vi.fn>; validateAggregation: ReturnType<typeof vi.fn> };
  let filesValidator: { validateIngestionFiles: ReturnType<typeof vi.fn> };
  let extractor: { extract: ReturnType<typeof vi.fn> };

  const files = { modelPath: '/models/afula/data/tileset.json', product: {}, metadata: {} };
  const extracted = { core: { srsId: '4326' }, aggregation: { sensors: ['UAV'] } };

  beforeEach(async function () {
    validator = { validateIngestion: vi.fn().mockResolvedValue(undefined), validateAggregation: vi.fn() };
    filesValidator = { validateIngestionFiles: vi.fn().mockResolvedValue(files) };
    extractor = { extract: vi.fn().mockResolvedValue(extracted) };
    manager = new RecordManager(
      await jsLogger({ enabled: false }),
      validator as unknown as ValidationManager,
      filesValidator as unknown as FilesValidator,
      extractor as unknown as MetadataExtractor
    );
  });

  describe('createIngestion', function () {
    it('should return a job response with a jobId and status', async function () {
      const payload: IngestionPayload = {
        modelPath: 'afula/data/tileset.json',
        productShapefilePath: 'afula/shape/Product.shp',
        metadataShapefilePath: 'afula/shape/ShapeMetadata.shp',
        productType: '3DPhotoRealistic',
        classification: '4',
        region: ['israel'],
      };

      const result = await manager.createIngestion(payload);

      expect(result.jobId).toBeTypeOf('string');
      expect(result.status).toBeTypeOf('string');
      expect(filesValidator.validateIngestionFiles).toHaveBeenCalledWith({
        modelPath: payload.modelPath,
        productShapefilePath: payload.productShapefilePath,
        metadataShapefilePath: payload.metadataShapefilePath,
      });
      expect(extractor.extract).toHaveBeenCalledWith(files);
      expect(validator.validateAggregation).toHaveBeenCalledWith(extracted.aggregation);
      expect(validator.validateIngestion).toHaveBeenCalledWith({
        productType: '3DPhotoRealistic',
        classification: '4',
        region: ['israel'],
        ...extracted.core,
        ...extracted.aggregation,
      });
    });

    it('should not extract metadata when the files are invalid', async function () {
      filesValidator.validateIngestionFiles.mockRejectedValue(new Error('missing files'));

      await expect(
        manager.createIngestion({
          modelPath: 'afula/data/tileset.json',
          productShapefilePath: 'afula/shape/Product.shp',
          metadataShapefilePath: 'afula/shape/ShapeMetadata.shp',
          productType: '3DPhotoRealistic',
          classification: '4',
          region: ['israel'],
        })
      ).rejects.toThrow('missing files');
      expect(extractor.extract).not.toHaveBeenCalled();
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
