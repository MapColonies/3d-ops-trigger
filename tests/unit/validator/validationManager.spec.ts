import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import {
  ValidationManager,
  ERROR_METADATA_DATE,
  ERROR_METADATA_FOOTPRINT,
  ERROR_METADATA_MISSING_DATE,
  ERROR_METADATA_INVALID_DATE,
  ERROR_DELETE_RECORD_NOT_FOUND,
  ERROR_DELETE_PRODUCT_TYPE,
  ERROR_DELETE_STATUS,
  ERROR_FILE_NOT_FOUND,
  ERROR_PRODUCT_NAME_IN_FLIGHT,
} from '@src/validator/validationManager';
import { AppError } from '@src/common/appError';
import type { LookupTablesCall } from '@src/externalServices/lookupTables/lookupTablesCall';
import type { CatalogCall } from '@src/externalServices/catalog/catalogCall';
import type { JobnikClient } from '@src/externalServices/jobnik/jobnikClient';
import type { Provider } from '@src/providers/interfaces';
import type { IngestionPayload } from '@src/record/models/recordManager';
import { buildValidMetadata } from '@tests/helpers/metadata';

const lookupStub = { getClassifications: vi.fn().mockResolvedValue(['abc123']) } as unknown as LookupTablesCall;

const ingest = (metadata: Record<string, unknown>): IngestionPayload => ({
  modelPath: '/shared/models/afula',
  tilesetFilename: 'tileset.json',
  metadata,
});

describe('ValidationManager', function () {
  let validator: ValidationManager;
  let catalogStub: CatalogCall;
  let jobnikStub: JobnikClient;
  let providerStub: Provider;

  beforeEach(async function () {
    catalogStub = { findRecords: vi.fn().mockResolvedValue([]) } as unknown as CatalogCall;
    jobnikStub = { hasInFlightIngestionJob: vi.fn().mockResolvedValue(false) } as unknown as JobnikClient;
    providerStub = { fileExists: vi.fn().mockResolvedValue(true) };
    validator = new ValidationManager(await jsLogger({ enabled: false }), lookupStub, catalogStub, jobnikStub, providerStub);
  });

  it('should pass a fully valid ingestion payload', async function () {
    await expect(validator.validateIngestion(ingest(buildValidMetadata()))).resolves.toBeUndefined();
  });

  it('should throw 400 when a required core field is missing', async function () {
    const metadata = buildValidMetadata();
    delete metadata.productName;

    await expect(validator.validateIngestion(ingest(metadata))).rejects.toThrow(AppError);
  });

  it('should throw 400 for an invalid productType', async function () {
    const metadata = { ...buildValidMetadata(), productType: 'NOT_A_3D_TYPE' };

    let thrown: unknown;
    try {
      await validator.validateIngestion(ingest(metadata));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(StatusCodes.BAD_REQUEST);
  });

  it('should throw the footprint error for a malformed geometry', async function () {
    const metadata = { ...buildValidMetadata(), footprint: { type: 'Point', coordinates: [34.45, 31.48] } };

    await expect(validator.validateIngestion(ingest(metadata))).rejects.toThrow(ERROR_METADATA_FOOTPRINT);
  });

  it('should throw the date error when imagingTimeBeginUTC is after imagingTimeEndUTC', async function () {
    const metadata = { ...buildValidMetadata(), imagingTimeBeginUTC: '2025-07-11T00:00:00.000Z' };

    await expect(validator.validateIngestion(ingest(metadata))).rejects.toThrow(ERROR_METADATA_DATE);
  });

  it('should throw the missing-date error when a source date is absent', async function () {
    const metadata = buildValidMetadata();
    delete metadata.imagingTimeEndUTC;

    await expect(validator.validateIngestion(ingest(metadata))).rejects.toThrow(ERROR_METADATA_MISSING_DATE);
  });

  it('should throw the invalid-date error for an unparseable date', async function () {
    const metadata = { ...buildValidMetadata(), imagingTimeBeginUTC: 'not-a-date' };

    await expect(validator.validateIngestion(ingest(metadata))).rejects.toThrow(ERROR_METADATA_INVALID_DATE);
  });

  it('should throw 400 when the classification is not in the lookup table', async function () {
    const metadata = { ...buildValidMetadata(), classification: 'not-a-real-classification' };

    await expect(validator.validateIngestion(ingest(metadata))).rejects.toThrow(AppError);
  });

  it('should throw 400 when the product name already exists in the catalog', async function () {
    (catalogStub.findRecords as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'existing', productName: 'afula' }]);

    await expect(validator.validateIngestion(ingest(buildValidMetadata()))).rejects.toThrow(AppError);
  });

  it('should throw 409 when the product name has an in-flight ingestion job', async function () {
    (jobnikStub.hasInFlightIngestionJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    let thrown: unknown;
    try {
      await validator.validateIngestion(ingest(buildValidMetadata()));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(StatusCodes.CONFLICT);
    expect((thrown as AppError).message).toBe(ERROR_PRODUCT_NAME_IN_FLIGHT);
  });

  it('should throw 400 when the model files do not exist', async function () {
    (providerStub.fileExists as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    await expect(validator.validateIngestion(ingest(buildValidMetadata()))).rejects.toThrow(ERROR_FILE_NOT_FOUND);
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
