import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordManager, type IngestionPayload } from '@src/record/models/recordManager';
import type { ValidationManager } from '@src/validator/validationManager';
import type { FilesValidator } from '@src/validator/filesValidator';
import type { MetadataExtractor } from '@src/extractor/metadataExtractor';
import type { ProductReader } from '@src/extractor/productReader';
import type { TilesetReader } from '@src/extractor/tilesetReader';
import type { TilesetValidator } from '@src/validator/tilesetValidator';

describe('RecordManager', function () {
  let manager: RecordManager;
  let validator: { validateIngestion: ReturnType<typeof vi.fn>; validateFootprint: ReturnType<typeof vi.fn> };
  let filesValidator: { validateIngestionFiles: ReturnType<typeof vi.fn> };
  let metadataExtractor: { extract: ReturnType<typeof vi.fn> };
  let productReader: { read: ReturnType<typeof vi.fn> };
  let tilesetReader: { readModelPolygon: ReturnType<typeof vi.fn> };
  let tilesetValidator: { validate: ReturnType<typeof vi.fn> };

  const files = { modelPath: '/models/paris/data/tileset.json', product: { shp: '/models/paris/shape/Product.shp' }, metadata: {} };
  const extracted = { productId: 'p-1', srsId: '4326' };
  const footprint = { type: 'Polygon', coordinates: [[[2.33, 48.85]]] };
  const modelPolygon = { type: 'Polygon', coordinates: [[[2.34, 48.86]]] };

  beforeEach(async function () {
    validator = { validateIngestion: vi.fn().mockResolvedValue(undefined), validateFootprint: vi.fn() };
    filesValidator = { validateIngestionFiles: vi.fn().mockResolvedValue(files) };
    metadataExtractor = { extract: vi.fn().mockResolvedValue(extracted) };
    productReader = { read: vi.fn().mockResolvedValue(footprint) };
    tilesetReader = { readModelPolygon: vi.fn().mockResolvedValue(modelPolygon) };
    tilesetValidator = { validate: vi.fn().mockResolvedValue(undefined) };
    manager = new RecordManager(
      await jsLogger({ enabled: false }),
      validator as unknown as ValidationManager,
      filesValidator as unknown as FilesValidator,
      metadataExtractor as unknown as MetadataExtractor,
      productReader as unknown as ProductReader,
      tilesetReader as unknown as TilesetReader,
      tilesetValidator as unknown as TilesetValidator
    );
  });

  describe('createIngestion', function () {
    it('should return a job response with a jobId and status', async function () {
      const payload: IngestionPayload = {
        modelPath: 'paris/data/tileset.json',
        productShapefilePath: 'paris/shape/Product.shp',
        metadataShapefilePath: 'paris/shape/ShapeMetadata.shp',
        productType: '3DPhotoRealistic',
        classification: '4',
        region: ['France'],
      };

      const result = await manager.createIngestion(payload);

      expect(result.jobId).toBeTypeOf('string');
      expect(result.status).toBeTypeOf('string');
      expect(filesValidator.validateIngestionFiles).toHaveBeenCalledWith(payload);
      expect(productReader.read).toHaveBeenCalledWith(files.product.shp);
      expect(metadataExtractor.extract).toHaveBeenCalledWith(files);
      expect(tilesetValidator.validate).toHaveBeenCalledWith(files.modelPath);
      expect(tilesetReader.readModelPolygon).toHaveBeenCalledWith(files.modelPath);
      expect(validator.validateFootprint).toHaveBeenCalledWith(footprint, modelPolygon);
      expect(validator.validateIngestion).toHaveBeenCalledWith(payload, extracted);
    });

    it('should reject when the product shapefile is invalid', async function () {
      productReader.read.mockRejectedValue(new Error('invalid product'));

      await expect(
        manager.createIngestion({
          modelPath: 'paris/data/tileset.json',
          productShapefilePath: 'paris/shape/Product.shp',
          metadataShapefilePath: 'paris/shape/ShapeMetadata.shp',
          productType: '3DPhotoRealistic',
          classification: '4',
          region: ['France'],
        })
      ).rejects.toThrow('invalid product');
      expect(validator.validateIngestion).not.toHaveBeenCalled();
    });

    it('should reject when the metadata shapefile is invalid', async function () {
      metadataExtractor.extract.mockRejectedValue(new Error('invalid metadata'));

      await expect(
        manager.createIngestion({
          modelPath: 'paris/data/tileset.json',
          productShapefilePath: 'paris/shape/Product.shp',
          metadataShapefilePath: 'paris/shape/ShapeMetadata.shp',
          productType: '3DPhotoRealistic',
          classification: '4',
          region: ['France'],
        })
      ).rejects.toThrow('invalid metadata');
      expect(validator.validateIngestion).not.toHaveBeenCalled();
    });

    it('should reject when the tileset is invalid', async function () {
      tilesetReader.readModelPolygon.mockRejectedValue(new Error('invalid tileset'));

      await expect(
        manager.createIngestion({
          modelPath: 'paris/data/tileset.json',
          productShapefilePath: 'paris/shape/Product.shp',
          metadataShapefilePath: 'paris/shape/ShapeMetadata.shp',
          productType: '3DPhotoRealistic',
          classification: '4',
          region: ['France'],
        })
      ).rejects.toThrow('invalid tileset');
      expect(validator.validateFootprint).not.toHaveBeenCalled();
      expect(validator.validateIngestion).not.toHaveBeenCalled();
    });

    it('should reject when the footprint does not cover the model', async function () {
      validator.validateFootprint.mockImplementation(() => {
        throw new Error('low coverage');
      });

      await expect(
        manager.createIngestion({
          modelPath: 'paris/data/tileset.json',
          productShapefilePath: 'paris/shape/Product.shp',
          metadataShapefilePath: 'paris/shape/ShapeMetadata.shp',
          productType: '3DPhotoRealistic',
          classification: '4',
          region: ['France'],
        })
      ).rejects.toThrow('low coverage');
      expect(validator.validateIngestion).not.toHaveBeenCalled();
    });

    it('should not extract metadata when the files are invalid', async function () {
      filesValidator.validateIngestionFiles.mockRejectedValue(new Error('missing files'));

      await expect(
        manager.createIngestion({
          modelPath: 'paris/data/tileset.json',
          productShapefilePath: 'paris/shape/Product.shp',
          metadataShapefilePath: 'paris/shape/ShapeMetadata.shp',
          productType: '3DPhotoRealistic',
          classification: '4',
          region: ['France'],
        })
      ).rejects.toThrow('missing files');
      expect(productReader.read).not.toHaveBeenCalled();
      expect(tilesetValidator.validate).not.toHaveBeenCalled();
      expect(tilesetReader.readModelPolygon).not.toHaveBeenCalled();
      expect(metadataExtractor.extract).not.toHaveBeenCalled();
    });

    it('should not read the model when the tileset validation fails', async function () {
      tilesetValidator.validate.mockRejectedValue(new Error('tileset validation failed'));

      await expect(
        manager.createIngestion({
          modelPath: 'paris/data/tileset.json',
          productShapefilePath: 'paris/shape/Product.shp',
          metadataShapefilePath: 'paris/shape/ShapeMetadata.shp',
          productType: '3DPhotoRealistic',
          classification: '4',
          region: ['France'],
        })
      ).rejects.toThrow('tileset validation failed');
      expect(productReader.read).not.toHaveBeenCalled();
      expect(tilesetReader.readModelPolygon).not.toHaveBeenCalled();
      expect(metadataExtractor.extract).not.toHaveBeenCalled();
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
