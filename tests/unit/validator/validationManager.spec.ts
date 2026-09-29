import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import {
  ValidationManager,
  ERROR_METADATA_DATE,
  ERROR_METADATA_FOOTPRINT,
  ERROR_METADATA_MISSING_DATE,
  ERROR_METADATA_INVALID_DATE,
} from '@src/validator/validationManager';
import { AppError } from '@src/common/appError';
import type { LookupTablesCall } from '@src/externalServices/lookupTables/lookupTablesCall';
import type { CatalogCall } from '@src/externalServices/catalog/catalogCall';
import { buildValidMetadata as validMetadata } from '@tests/helpers/metadata';

const lookupStub = { getClassifications: vi.fn().mockResolvedValue(['abc123']) } as unknown as LookupTablesCall;

describe('ValidationManager', function () {
  let validator: ValidationManager;
  let catalogStub: CatalogCall;

  beforeEach(async function () {
    catalogStub = { findRecords: vi.fn().mockResolvedValue([]) } as unknown as CatalogCall;
    validator = new ValidationManager(await jsLogger({ enabled: false }), lookupStub, catalogStub);
  });

  it('should pass a fully valid metadata object', async function () {
    await expect(validator.validateIngestion(validMetadata())).resolves.toBeUndefined();
  });

  it('should throw 400 when a required core field is missing', async function () {
    const metadata = validMetadata();
    delete metadata.productName;

    await expect(validator.validateIngestion(metadata)).rejects.toThrow(AppError);
  });

  it('should throw 400 for an invalid productType', async function () {
    const metadata = { ...validMetadata(), productType: 'NOT_A_3D_TYPE' };

    let thrown: unknown;
    try {
      await validator.validateIngestion(metadata);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(StatusCodes.BAD_REQUEST);
  });

  it('should throw the footprint error for a malformed geometry', async function () {
    const metadata = { ...validMetadata(), footprint: { type: 'Point', coordinates: [34.45, 31.48] } };

    await expect(validator.validateIngestion(metadata)).rejects.toThrow(ERROR_METADATA_FOOTPRINT);
  });

  it('should throw the date error when imagingTimeBeginUTC is after imagingTimeEndUTC', async function () {
    const metadata = { ...validMetadata(), imagingTimeBeginUTC: '2025-07-11T00:00:00.000Z' };

    await expect(validator.validateIngestion(metadata)).rejects.toThrow(ERROR_METADATA_DATE);
  });

  it('should throw the missing-date error when a source date is absent', async function () {
    const metadata = validMetadata();
    delete metadata.imagingTimeEndUTC;

    await expect(validator.validateIngestion(metadata)).rejects.toThrow(ERROR_METADATA_MISSING_DATE);
  });

  it('should throw the invalid-date error for an unparseable date', async function () {
    const metadata = { ...validMetadata(), imagingTimeBeginUTC: 'not-a-date' };

    await expect(validator.validateIngestion(metadata)).rejects.toThrow(ERROR_METADATA_INVALID_DATE);
  });

  it('should throw 400 when the classification is not in the lookup table', async function () {
    const metadata = { ...validMetadata(), classification: 'not-a-real-classification' };

    await expect(validator.validateIngestion(metadata)).rejects.toThrow(AppError);
  });

  it('should throw 400 when the product name already exists in the catalog', async function () {
    (catalogStub.findRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'existing', productName: 'afula' }]);

    await expect(validator.validateIngestion(validMetadata())).rejects.toThrow(AppError);
  });
});
