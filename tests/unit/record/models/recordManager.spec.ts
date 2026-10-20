import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordManager, type IngestionPayload } from '@src/record/models/recordManager';
import type { ValidationManager } from '@src/validator/validationManager';
import type { FilesValidator } from '@src/validator/filesValidator';
import type { MetadataExtractor } from '@src/extractor/metadataExtractor';
import type { ProductReader } from '@src/extractor/productReader';

describe('RecordManager', function () {
  let manager: RecordManager;
  let validator: { validateIngestion: ReturnType<typeof vi.fn> };
  let filesValidator: { validateIngestionFiles: ReturnType<typeof vi.fn> };
  let extractor: { extract: ReturnType<typeof vi.fn> };
  let productReader: { read: ReturnType<typeof vi.fn> };

  const files = { modelPath: '/models/afula/data/tileset.json', product: { shp: '/models/afula/shape/Product.shp' }, metadata: {} };
  const extracted = { productId: 'p-1', srsId: '4326' };

  beforeEach(async function () {
    validator = { validateIngestion: vi.fn().mockResolvedValue(undefined) };
    filesValidator = { validateIngestionFiles: vi.fn().mockResolvedValue(files) };
    extractor = { extract: vi.fn().mockResolvedValue(extracted) };
    productReader = { read: vi.fn().mockResolvedValue({ type: 'Polygon', coordinates: [] }) };
    manager = new RecordManager(
      await jsLogger({ enabled: false }),
      validator as unknown as ValidationManager,
      filesValidator as unknown as FilesValidator,
      extractor as unknown as MetadataExtractor,
      productReader as unknown as ProductReader
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
      expect(productReader.read).toHaveBeenCalledWith(files.product.shp);
      expect(extractor.extract).toHaveBeenCalledWith(files);
      expect(validator.validateIngestion).toHaveBeenCalledWith(
        { productType: '3DPhotoRealistic', classification: '4', region: ['israel'] },
        extracted
      );
    });

    it('should reject when the product shapefile is invalid', async function () {
      productReader.read.mockRejectedValue(new Error('invalid product'));

      await expect(
        manager.createIngestion({
          modelPath: 'afula/data/tileset.json',
          productShapefilePath: 'afula/shape/Product.shp',
          metadataShapefilePath: 'afula/shape/ShapeMetadata.shp',
          productType: '3DPhotoRealistic',
          classification: '4',
          region: ['israel'],
        })
      ).rejects.toThrow('invalid product');
      expect(validator.validateIngestion).not.toHaveBeenCalled();
    });

    it('should reject when the metadata shapefile is invalid', async function () {
      extractor.extract.mockRejectedValue(new Error('invalid metadata'));

      await expect(
        manager.createIngestion({
          modelPath: 'afula/data/tileset.json',
          productShapefilePath: 'afula/shape/Product.shp',
          metadataShapefilePath: 'afula/shape/ShapeMetadata.shp',
          productType: '3DPhotoRealistic',
          classification: '4',
          region: ['israel'],
        })
      ).rejects.toThrow('invalid metadata');
      expect(validator.validateIngestion).not.toHaveBeenCalled();
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
      expect(productReader.read).not.toHaveBeenCalled();
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
