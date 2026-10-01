import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { IngestionValidator } from '@src/validator/ingestionValidator';
import { TilesetValidator } from '@src/validator/tilesetValidator';
import {
  ERROR_METADATA_DATE,
  ERROR_METADATA_FOOTPRINT,
  ERROR_METADATA_MISSING_DATE,
  ERROR_METADATA_INVALID_DATE,
  ERROR_FILE_NOT_FOUND,
  ERROR_PRODUCT_NAME_IN_FLIGHT,
  ERROR_FOOTPRINT_FAR_FROM_MODEL,
  ERROR_MODEL_PATH_INVALID,
} from '@src/validator/errors';
import { AppError } from '@src/common/appError';
import type { ConfigType } from '@src/common/config';
import type { LookupTablesCall } from '@src/externalServices/lookupTables/lookupTablesCall';
import type { CatalogCall } from '@src/externalServices/catalog/catalogCall';
import type { JobnikClient } from '@src/externalServices/jobnik/jobnikClient';
import type { TilesetReader } from '@src/tileset/tilesetReader';
import type { Provider } from '@src/providers/interfaces';
import type { IngestionPayload } from '@src/common/interfaces';
import { buildValidMetadata } from '@tests/helpers/metadata';

const regionTilesetJson = readFileSync(join(__dirname, '../../helpers/tilesets/folder/tileset.json'), 'utf-8');
const boxTilesetJson = JSON.stringify({ root: { boundingVolume: { box: [0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100] } } });

const lookupStub = { getClassifications: vi.fn().mockResolvedValue(['abc123']) } as unknown as LookupTablesCall;
const configStub = {
  get: vi.fn((key: string) => (key === 'validation.basePath' ? '/shared/models' : 10)),
} as unknown as ConfigType;

const ingest = (metadata: Record<string, unknown>): IngestionPayload => ({
  modelPath: '/shared/models/afula',
  tilesetFilename: 'tileset.json',
  metadata,
});

describe('IngestionValidator', function () {
  let validator: IngestionValidator;
  let catalogStub: CatalogCall;
  let jobnikStub: JobnikClient;
  let tilesetReaderStub: TilesetReader;
  let providerStub: Provider;

  beforeEach(async function () {
    catalogStub = {
      findRecords: vi.fn().mockResolvedValue([]),
    } as unknown as CatalogCall;
    jobnikStub = { hasInFlightIngestionJob: vi.fn().mockResolvedValue(false) } as unknown as JobnikClient;
    tilesetReaderStub = { readTilesetJson: vi.fn().mockResolvedValue(regionTilesetJson) } as unknown as TilesetReader;
    providerStub = { fileExists: vi.fn().mockResolvedValue(true) };
    const logger = await jsLogger({ enabled: false });
    const tilesetValidator = new TilesetValidator(configStub, logger, tilesetReaderStub);
    validator = new IngestionValidator(configStub, logger, lookupStub, catalogStub, jobnikStub, providerStub, tilesetValidator);
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

  it('should throw 400 when the model path is not under the agreed base path', async function () {
    const payload = { ...ingest(buildValidMetadata()), modelPath: '/etc/passwd' };

    await expect(validator.validateIngestion(payload)).rejects.toThrow(ERROR_MODEL_PATH_INVALID);
  });

  it('should throw 409 when the productId already exists in the catalog', async function () {
    (catalogStub.findRecords as ReturnType<typeof vi.fn>).mockImplementation((query: { productId?: string; productName?: string }) =>
      query.productId !== undefined ? [{ id: 'existing', productId: query.productId }] : []
    );

    let thrown: unknown;
    try {
      await validator.validateIngestion(ingest(buildValidMetadata()));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(StatusCodes.CONFLICT);
  });

  it('should throw 400 when the footprint does not intersect the tileset model', async function () {
    const metadata = buildValidMetadata();
    metadata.footprint = {
      type: 'Polygon',
      coordinates: [
        [
          [10, 10],
          [10.01, 10],
          [10.01, 10.01],
          [10, 10.01],
          [10, 10],
        ],
      ],
    };

    await expect(validator.validateIngestion(ingest(metadata))).rejects.toThrow(ERROR_FOOTPRINT_FAR_FROM_MODEL);
  });

  it('should throw 400 when the footprint coverage of the model is below the threshold', async function () {
    const metadata = buildValidMetadata();
    metadata.footprint = {
      type: 'Polygon',
      coordinates: [
        [
          [35.17, 32.9],
          [35.172, 32.9],
          [35.172, 32.902],
          [35.17, 32.902],
          [35.17, 32.9],
        ],
      ],
    };

    let thrown: unknown;
    try {
      await validator.validateIngestion(ingest(metadata));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(StatusCodes.BAD_REQUEST);
    expect((thrown as AppError).message).toMatch(/minimum required threshhold/);
  });

  it('should throw 400 when the tileset bounding volume is an unsupported box', async function () {
    (tilesetReaderStub.readTilesetJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce(boxTilesetJson);

    let thrown: unknown;
    try {
      await validator.validateIngestion(ingest(buildValidMetadata()));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(StatusCodes.BAD_REQUEST);
  });
});
