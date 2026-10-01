import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { MetadataValidator } from '@src/validator/metadataValidator';
import {
  ERROR_DELETE_RECORD_NOT_FOUND,
  ERROR_DELETE_PRODUCT_TYPE,
  ERROR_DELETE_STATUS,
  ERROR_RECORD_NOT_FOUND,
  ERROR_RECORD_BEING_DELETED,
  ERROR_EXTRACTABLE_CONFLICT,
} from '@src/validator/errors';
import { AppError } from '@src/common/appError';
import type { LookupTablesCall } from '@src/externalServices/lookupTables/lookupTablesCall';
import type { CatalogCall } from '@src/externalServices/catalog/catalogCall';
import type { ExtractableCall } from '@src/externalServices/extractableManagement/extractableCall';

const lookupStub = { getClassifications: vi.fn().mockResolvedValue(['abc123']) } as unknown as LookupTablesCall;

describe('MetadataValidator', function () {
  let validator: MetadataValidator;
  let catalogStub: CatalogCall;
  let extractableStub: ExtractableCall;

  beforeEach(async function () {
    catalogStub = {
      findRecords: vi.fn().mockResolvedValue([]),
      getRecord: vi.fn().mockResolvedValue({ id: 'rec-1', productName: 'afula' }),
    } as unknown as CatalogCall;
    extractableStub = { isExtractableRecordExists: vi.fn().mockResolvedValue(false) } as unknown as ExtractableCall;
    validator = new MetadataValidator(await jsLogger({ enabled: false }), lookupStub, catalogStub, extractableStub);
  });

  describe('validateUpdate', function () {
    it('should return the record for a valid update payload', async function () {
      await expect(validator.validateUpdate('rec-1', { description: 'x' })).resolves.toEqual({ id: 'rec-1', productName: 'afula' });
    });

    it('should throw 404 when the record does not exist', async function () {
      (catalogStub.getRecord as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      let thrown: unknown;
      try {
        await validator.validateUpdate('missing', { description: 'x' });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).status).toBe(StatusCodes.NOT_FOUND);
      expect((thrown as AppError).message).toBe(ERROR_RECORD_NOT_FOUND);
    });

    it('should throw 400 when the record is being deleted', async function () {
      (catalogStub.getRecord as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'rec-1', productStatus: 'BEING_DELETED' });

      await expect(validator.validateUpdate('rec-1', { description: 'x' })).rejects.toThrow(ERROR_RECORD_BEING_DELETED);
    });

    it('should throw 400 when a renamed product name collides with another record', async function () {
      (catalogStub.findRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'other', productName: 'haifa' }]);

      await expect(validator.validateUpdate('rec-1', { productName: 'haifa' })).rejects.toThrow(AppError);
    });
  });

  describe('validateStatusChange', function () {
    it('should throw 404 when the record does not exist', async function () {
      (catalogStub.getRecord as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await expect(validator.validateStatusChange('missing')).rejects.toThrow(ERROR_RECORD_NOT_FOUND);
    });
  });

  describe('ensureRecordAbsentFromExtractable', function () {
    it('should throw 409 when the record exists in extractable-management', async function () {
      (extractableStub.isExtractableRecordExists as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      let thrown: unknown;
      try {
        await validator.ensureRecordAbsentFromExtractable({ id: 'rec-1', productName: 'afula' });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).status).toBe(StatusCodes.CONFLICT);
      expect((thrown as AppError).message).toBe(ERROR_EXTRACTABLE_CONFLICT);
    });

    it('should pass when the record is absent from extractable-management', async function () {
      await expect(validator.ensureRecordAbsentFromExtractable({ id: 'rec-1', productName: 'afula' })).resolves.toBeUndefined();
    });
  });

  describe('validateDelete', function () {
    it('should return the record when it is deletable', async function () {
      const record = { id: 'rec-1', productType: '3DPhotoRealistic', productStatus: 'UNPUBLISHED' };
      (catalogStub.findRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([record]);

      await expect(validator.validateDelete('rec-1')).resolves.toEqual(record);
    });

    it('should throw when the record is not found', async function () {
      (catalogStub.findRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await expect(validator.validateDelete('missing')).rejects.toThrow(ERROR_DELETE_RECORD_NOT_FOUND);
    });

    it('should throw when the productType is blocked', async function () {
      (catalogStub.findRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'rec-1', productType: 'QuantizedMeshDTMBest', productStatus: 'UNPUBLISHED' },
      ]);

      await expect(validator.validateDelete('rec-1')).rejects.toThrow(ERROR_DELETE_PRODUCT_TYPE);
    });

    it('should throw when the record is not unpublished', async function () {
      (catalogStub.findRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'rec-1', productType: '3DPhotoRealistic', productStatus: 'PUBLISHED' },
      ]);

      await expect(validator.validateDelete('rec-1')).rejects.toThrow(ERROR_DELETE_STATUS);
    });
  });
});
