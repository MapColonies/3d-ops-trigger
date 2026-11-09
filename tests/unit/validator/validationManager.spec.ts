import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@map-colonies/3d-shared';
import type { IFindRecordsPayload } from '@map-colonies/3d-shared';
import { bboxPolygon } from '@turf/turf';
import {
  ValidationManager,
  ERROR_DELETE_PRODUCT_TYPE,
  ERROR_DELETE_RECORD_NOT_FOUND,
  ERROR_DELETE_STATUS,
  ERROR_METADATA_PRODUCT_ID_UNIQUE,
  ERROR_METADATA_PRODUCT_NAME_UNIQUE,
  ERROR_PRODUCT_NAME_IN_FLIGHT,
} from '@src/validator/validationManager';
import type { LookupTablesClient } from '@src/externalServices/lookupTables/lookupTablesClient';
import type { CatalogClient } from '@src/externalServices/catalog/catalogClient';
import type { JobnikClient } from '@src/externalServices/jobnik/jobnikClient';
import type { ConfigType } from '@src/common/config';
import { ERROR_FOOTPRINT_COVERAGE_FAILED, ERROR_FOOTPRINT_FAR_FROM_MODEL } from '@src/extractor/constants';
import { buildValidPayload, buildProductIdentity } from '@tests/helpers/metadata';

const lookupStub = {
  getClassifications: vi.fn().mockResolvedValue(['abc123']),
  getCountries: vi.fn().mockResolvedValue(['France', 'USA']),
} as unknown as LookupTablesClient;

const product = buildProductIdentity();
const INTERSECTION_PERCENTAGE_LIMIT = 10;
const configStub = { get: vi.fn().mockReturnValue(INTERSECTION_PERCENTAGE_LIMIT) } as unknown as ConfigType;
const modelPolygon = bboxPolygon([2.33, 48.85, 2.35, 48.87]).geometry;

describe('ValidationManager', function () {
  let validator: ValidationManager;
  let catalogStub: CatalogClient;
  let findRecords: ReturnType<typeof vi.fn<(payload: IFindRecordsPayload) => Promise<unknown[]>>>;
  let hasInFlightIngestionJob: ReturnType<typeof vi.fn<(productName: string) => Promise<boolean>>>;

  beforeEach(async function () {
    findRecords = vi.fn<(payload: IFindRecordsPayload) => Promise<unknown[]>>().mockResolvedValue([]);
    catalogStub = { findRecords } as unknown as CatalogClient;
    hasInFlightIngestionJob = vi.fn<(productName: string) => Promise<boolean>>().mockResolvedValue(false);
    const jobnikStub = { hasInFlightIngestionJob } as unknown as JobnikClient;
    validator = new ValidationManager(configStub, await jsLogger({ enabled: false }), lookupStub, catalogStub, jobnikStub);
  });

  it('should pass fully valid form fields and a unique product', async function () {
    await expect(validator.validateIngestion(buildValidPayload(), product)).resolves.toBeUndefined();
  });

  it('should throw 400 when a required form field is missing', async function () {
    const metadata = buildValidPayload();
    delete metadata.classification;

    await expect(validator.validateIngestion(metadata, product)).rejects.toThrow(AppError);
  });

  it('should throw 400 for an invalid productType', async function () {
    const metadata = { ...buildValidPayload(), productType: 'NOT_A_3D_TYPE' };

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
    const metadata = { ...buildValidPayload(), classification: 'not-a-real-classification' };

    await expect(validator.validateIngestion(metadata, product)).rejects.toThrow(AppError);
  });

  it('should throw 400 listing the regions that are not in the countries lookup table', async function () {
    const metadata = { ...buildValidPayload(), region: ['France', 'Atlantis', 'Mordor'] };

    await expect(validator.validateIngestion(metadata, product)).rejects.toThrow('region contains invalid values: Atlantis,Mordor');
  });

  it('should throw 400 when the product id already exists in the catalog', async function () {
    findRecords.mockImplementation(async (payload) => Promise.resolve(payload.productId !== undefined ? [{ id: 'existing', productId: 'p-1' }] : []));

    await expect(validator.validateIngestion(buildValidPayload(), product)).rejects.toThrow(ERROR_METADATA_PRODUCT_ID_UNIQUE);
  });

  it('should throw 400 when the product name already exists in the catalog', async function () {
    findRecords.mockImplementation(async (payload) =>
      Promise.resolve(payload.productName !== undefined ? [{ id: 'existing', productName: 'paris' }] : [])
    );

    await expect(validator.validateIngestion(buildValidPayload(), product)).rejects.toThrow(ERROR_METADATA_PRODUCT_NAME_UNIQUE);
  });

  it('should query the catalog by product id and by product name', async function () {
    await validator.validateIngestion(buildValidPayload(), product);

    expect(findRecords).toHaveBeenCalledWith({ productId: 'p-1' });
    expect(findRecords).toHaveBeenCalledWith({ productName: 'paris' });
  });

  it('should throw 409 when the product name already has an in-flight ingestion job', async function () {
    hasInFlightIngestionJob.mockResolvedValue(true);

    let thrown: unknown;
    try {
      await validator.validateIngestion(buildValidPayload(), product);
    } catch (err) {
      thrown = err;
    }

    expect(hasInFlightIngestionJob).toHaveBeenCalledWith('paris');
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(StatusCodes.CONFLICT);
    expect((thrown as AppError).message).toBe(ERROR_PRODUCT_NAME_IN_FLIGHT);
  });

  describe('validateDelete', function () {
    const record = { id: 'rec-1', productType: '3DPhotoRealistic', productStatus: 'UNPUBLISHED' };

    it('should return the record when it can be deleted', async function () {
      findRecords.mockResolvedValue([record]);

      await expect(validator.validateDelete('rec-1')).resolves.toEqual(record);
      expect(findRecords).toHaveBeenCalledWith({ id: 'rec-1' });
    });

    it.each([
      ['no record matches', []],
      ['more than one record matches', [record, { ...record, id: 'rec-2' }]],
    ])('should throw 400 when %s', async function (_case, records) {
      findRecords.mockResolvedValue(records);

      await expect(validator.validateDelete('rec-1')).rejects.toThrow(ERROR_DELETE_RECORD_NOT_FOUND);
    });

    it('should throw 400 for a QuantizedMeshDTMBest record', async function () {
      findRecords.mockResolvedValue([{ ...record, productType: 'QuantizedMeshDTMBest' }]);

      await expect(validator.validateDelete('rec-1')).rejects.toThrow(ERROR_DELETE_PRODUCT_TYPE);
    });

    it('should throw 400 for a published record', async function () {
      findRecords.mockResolvedValue([{ ...record, productStatus: 'PUBLISHED' }]);

      await expect(validator.validateDelete('rec-1')).rejects.toThrow(ERROR_DELETE_STATUS);
    });
  });

  describe('validateFootprint', function () {
    it.each([
      ['equal to the model', [2.33, 48.85, 2.35, 48.87]],
      ['covering a part of the model', [2.33, 48.85, 2.34, 48.87]],
      ['bigger than the model', [2.32, 48.84, 2.36, 48.88]],
    ])('should accept a footprint %s', function (_case, box) {
      expect(() => validator.validateFootprint(bboxPolygon(box as [number, number, number, number]).geometry, modelPolygon)).not.toThrow();
    });

    it('should accept a multipolygon footprint', function () {
      const footprint = { type: 'MultiPolygon' as const, coordinates: [bboxPolygon([2.33, 48.85, 2.35, 48.87]).geometry.coordinates] };

      expect(() => validator.validateFootprint(footprint, modelPolygon)).not.toThrow();
    });

    it('should throw 400 when the footprint does not intersect the model', function () {
      const footprint = bboxPolygon([10, 10, 10.01, 10.01]).geometry;

      expect(() => validator.validateFootprint(footprint, modelPolygon)).toThrow(ERROR_FOOTPRINT_FAR_FROM_MODEL);
    });

    it('should throw 400 when the footprint coverage of the model is below the limit', function () {
      const footprint = bboxPolygon([2.33, 48.85, 2.332, 48.852]).geometry;

      expect(() => validator.validateFootprint(footprint, modelPolygon)).toThrow(
        `footprint coverage of the model is 1%, the minimum required coverage is ${INTERSECTION_PERCENTAGE_LIMIT}%`
      );
    });

    it('should throw 400 when the coverage cannot be calculated', function () {
      const footprint = {
        type: 'Polygon' as const,
        coordinates: [
          [
            [Number.NaN, 48.85],
            [2.34, 48.86],
            [2.34, 48.85],
            [Number.NaN, 48.85],
          ],
        ],
      };

      expect(() => validator.validateFootprint(footprint, modelPolygon)).toThrow(ERROR_FOOTPRINT_COVERAGE_FAILED);
    });
  });
});
