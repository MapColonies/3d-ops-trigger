import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@map-colonies/3d-shared';
import type { IFindRecordsPayload } from '@map-colonies/3d-shared';
import { ValidationManager, ERROR_METADATA_PRODUCT_ID_UNIQUE, ERROR_METADATA_PRODUCT_NAME_UNIQUE } from '@src/validator/validationManager';
import type { LookupTablesClient } from '@src/externalServices/lookupTables/lookupTablesClient';
import type { CatalogClient } from '@src/externalServices/catalog/catalogClient';
import { buildValidMetadata as validMetadata } from '@tests/helpers/metadata';

const lookupStub = {
  getClassifications: vi.fn().mockResolvedValue(['abc123']),
  getCountries: vi.fn().mockResolvedValue(['ישראל', 'USA']),
} as unknown as LookupTablesClient;

describe('ValidationManager', function () {
  let validator: ValidationManager;
  let catalogStub: CatalogClient;
  let findRecords: ReturnType<typeof vi.fn<(payload: IFindRecordsPayload) => Promise<unknown[]>>>;

  beforeEach(async function () {
    findRecords = vi.fn<(payload: IFindRecordsPayload) => Promise<unknown[]>>().mockResolvedValue([]);
    catalogStub = { findRecords } as unknown as CatalogClient;
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

  it('should throw 400 when the classification is not in the lookup table', async function () {
    const metadata = { ...validMetadata(), classification: 'not-a-real-classification' };

    await expect(validator.validateIngestion(metadata)).rejects.toThrow(AppError);
  });

  it('should throw 400 listing the regions that are not in the countries lookup table', async function () {
    const metadata = { ...validMetadata(), region: ['ישראל', 'Atlantis', 'Mordor'] };

    await expect(validator.validateIngestion(metadata)).rejects.toThrow('region contains invalid values: Atlantis,Mordor');
  });

  it('should throw 400 when the product id already exists in the catalog', async function () {
    findRecords.mockImplementation(async (payload) => Promise.resolve(payload.productId !== undefined ? [{ id: 'existing', productId: 'p-1' }] : []));

    await expect(validator.validateIngestion(validMetadata())).rejects.toThrow(ERROR_METADATA_PRODUCT_ID_UNIQUE);
  });

  it('should throw 400 when the product name already exists in the catalog', async function () {
    findRecords.mockImplementation(async (payload) =>
      Promise.resolve(payload.productName !== undefined ? [{ id: 'existing', productName: 'afula' }] : [])
    );

    await expect(validator.validateIngestion(validMetadata())).rejects.toThrow(ERROR_METADATA_PRODUCT_NAME_UNIQUE);
  });

  it('should query the catalog by product id and by product name', async function () {
    await validator.validateIngestion(validMetadata());

    expect(findRecords).toHaveBeenCalledWith({ productId: 'p-1' });
    expect(findRecords).toHaveBeenCalledWith({ productName: 'afula' });
  });
});
