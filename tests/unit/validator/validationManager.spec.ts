import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@map-colonies/3d-shared';
import type { IFindRecordsPayload } from '@map-colonies/3d-shared';
import { ValidationManager, ERROR_METADATA_PRODUCT_ID_UNIQUE, ERROR_METADATA_PRODUCT_NAME_UNIQUE } from '@src/validator/validationManager';
import type { LookupTablesClient } from '@src/externalServices/lookupTables/lookupTablesClient';
import type { CatalogClient } from '@src/externalServices/catalog/catalogClient';
import { buildValidFormFields as validForm, buildProductIdentity } from '@tests/helpers/metadata';

const lookupStub = {
  getClassifications: vi.fn().mockResolvedValue(['abc123']),
  getCountries: vi.fn().mockResolvedValue(['France', 'USA']),
} as unknown as LookupTablesClient;

const product = buildProductIdentity();

describe('ValidationManager', function () {
  let validator: ValidationManager;
  let catalogStub: CatalogClient;
  let findRecords: ReturnType<typeof vi.fn<(payload: IFindRecordsPayload) => Promise<unknown[]>>>;

  beforeEach(async function () {
    findRecords = vi.fn<(payload: IFindRecordsPayload) => Promise<unknown[]>>().mockResolvedValue([]);
    catalogStub = { findRecords } as unknown as CatalogClient;
    validator = new ValidationManager(await jsLogger({ enabled: false }), lookupStub, catalogStub);
  });

  it('should pass fully valid form fields and a unique product', async function () {
    await expect(validator.validateIngestion(validForm(), product)).resolves.toBeUndefined();
  });

  it('should throw 400 when a required form field is missing', async function () {
    const metadata = validForm();
    delete metadata.classification;

    await expect(validator.validateIngestion(metadata, product)).rejects.toThrow(AppError);
  });

  it('should throw 400 for an invalid productType', async function () {
    const metadata = { ...validForm(), productType: 'NOT_A_3D_TYPE' };

    let thrown: unknown;
    try {
      await validator.validateIngestion(metadata, product);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(StatusCodes.BAD_REQUEST);
  });

  it('should throw 400 when the classification is not in the lookup table', async function () {
    const metadata = { ...validForm(), classification: 'not-a-real-classification' };

    await expect(validator.validateIngestion(metadata, product)).rejects.toThrow(AppError);
  });

  it('should throw 400 listing the regions that are not in the countries lookup table', async function () {
    const metadata = { ...validForm(), region: ['France', 'Atlantis', 'Mordor'] };

    await expect(validator.validateIngestion(metadata, product)).rejects.toThrow('region contains invalid values: Atlantis,Mordor');
  });

  it('should throw 400 when the product id already exists in the catalog', async function () {
    findRecords.mockImplementation(async (payload) => Promise.resolve(payload.productId !== undefined ? [{ id: 'existing', productId: 'p-1' }] : []));

    await expect(validator.validateIngestion(validForm(), product)).rejects.toThrow(ERROR_METADATA_PRODUCT_ID_UNIQUE);
  });

  it('should throw 400 when the product name already exists in the catalog', async function () {
    findRecords.mockImplementation(async (payload) =>
      Promise.resolve(payload.productName !== undefined ? [{ id: 'existing', productName: 'afula' }] : [])
    );

    await expect(validator.validateIngestion(validForm(), product)).rejects.toThrow(ERROR_METADATA_PRODUCT_NAME_UNIQUE);
  });

  it('should query the catalog by product id and by product name', async function () {
    await validator.validateIngestion(validForm(), product);

    expect(findRecords).toHaveBeenCalledWith({ productId: 'p-1' });
    expect(findRecords).toHaveBeenCalledWith({ productName: 'afula' });
  });
});
