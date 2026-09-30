import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, beforeEach, it, expect, beforeAll, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-supertest';
import type { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { initConfig } from '@src/common/config';
import { LookupTablesCall } from '@src/externalServices/lookupTables/lookupTablesCall';
import { CatalogCall } from '@src/externalServices/catalog/catalogCall';
import { JobnikClient } from '@src/externalServices/jobnik/jobnikClient';
import { TilesetReader } from '@src/tileset/tilesetReader';
import { ExtractableCall } from '@src/externalServices/extractableManagement/extractableCall';
import { buildValidMetadata } from '@tests/helpers/metadata';

const regionTilesetJson = readFileSync(join(__dirname, '../../helpers/tilesets/folder/tileset.json'), 'utf-8');

const deletableRecord = {
  id: 'rec-1',
  productId: 'p-1',
  productName: 'afula',
  productType: '3DPhotoRealistic',
  productVersion: 1,
  producerName: 'IDFMU',
  productStatus: 'UNPUBLISHED',
};

const lookupStub = { getClassifications: vi.fn().mockResolvedValue(['abc123']) } as unknown as LookupTablesCall;
const catalogStub = {
  findRecords: vi.fn().mockImplementation((payload: { id?: string }) => (payload.id !== undefined ? [deletableRecord] : [])),
  getRecord: vi.fn().mockResolvedValue(deletableRecord),
  patchMetadata: vi.fn().mockResolvedValue(deletableRecord),
  changeStatus: vi.fn().mockResolvedValue(deletableRecord),
} as unknown as CatalogCall;
const jobnikStub = {
  createIngestionJob: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'PENDING' }),
  createDeleteJob: vi.fn().mockResolvedValue({ jobId: 'del-1', status: 'PENDING' }),
  hasInFlightIngestionJob: vi.fn().mockResolvedValue(false),
  getJobStatus: vi.fn().mockResolvedValue({ status: 'IN_PROGRESS', percentage: 42 }),
} as unknown as JobnikClient;
const tilesetReaderStub = { readTilesetJson: vi.fn().mockResolvedValue(regionTilesetJson) } as unknown as TilesetReader;
const extractableStub = { isExtractableRecordExists: vi.fn().mockResolvedValue(false) } as unknown as ExtractableCall;
const providerStub = { fileExists: vi.fn().mockResolvedValue(true) };

const validMetadata = buildValidMetadata();

const validIngestionPayload = {
  modelPath: '/app/models/afula',
  tilesetFilename: 'tileset.json',
  metadata: validMetadata,
};

describe('3d-ops-trigger', function () {
  let requestSender: RequestSender<paths, operations>;

  beforeAll(async function () {
    await initConfig(true);
  });

  beforeEach(async function () {
    const [app] = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: await jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        { token: LookupTablesCall, provider: { useValue: lookupStub } },
        { token: CatalogCall, provider: { useValue: catalogStub } },
        { token: JobnikClient, provider: { useValue: jobnikStub } },
        { token: TilesetReader, provider: { useValue: tilesetReaderStub } },
        { token: ExtractableCall, provider: { useValue: extractableStub } },
        { token: SERVICES.PROVIDER, provider: { useValue: providerStub } },
      ],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
  });

  describe('POST /jobOperations/ingestion', function () {
    it('should return 201 and a job response for a valid ingestion request', async function () {
      const response = await requestSender.createIngestion({ requestBody: validIngestionPayload });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.CREATED);

      const body = response.body as paths['/jobOperations/ingestion']['post']['responses']['201']['content']['application/json'];

      expect(body.jobId).toBeTypeOf('string');
      expect(body.status).toBeTypeOf('string');
    });

    it('should return 400 when a required field is missing', async function () {
      const response = await requestSender.createIngestion({
        // @ts-expect-error intentionally invalid: missing tilesetFilename and metadata
        requestBody: { modelPath: '/app/models/afula' },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 400 when metadata fails business validation', async function () {
      const response = await requestSender.createIngestion({
        requestBody: { ...validIngestionPayload, metadata: { ...validMetadata, productType: 'NOT_A_3D_TYPE' } },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });
  });

  describe('POST /jobOperations/delete', function () {
    it('should return 200 and a job response', async function () {
      const response = await requestSender.createDelete({ requestBody: { id: 'rec-1' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);

      const body = response.body as paths['/jobOperations/delete']['post']['responses']['200']['content']['application/json'];

      expect(body.jobId).toBeTypeOf('string');
    });
  });

  describe('GET /jobStatus/{jobId}', function () {
    it('should return 200 with the job status and percentage', async function () {
      const response = await requestSender.getJobStatus({ pathParams: { jobId: 'job-1' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);

      const body = response.body as paths['/jobStatus/{jobId}']['get']['responses']['200']['content']['application/json'];

      expect(body.status).toBeTypeOf('string');
      expect(body.percentage).toBe(42);
    });
  });

  describe('POST /models/validate', function () {
    it('should return 200 with isValid true for a valid request without creating a job', async function () {
      const response = await requestSender.validateModel({ requestBody: validIngestionPayload });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);

      const body = response.body;

      expect(body.isValid).toBe(true);
    });

    it('should return 200 with isValid false and a message for an invalid request', async function () {
      const response = await requestSender.validateModel({
        requestBody: { ...validIngestionPayload, metadata: { ...validMetadata, productType: 'NOT_A_3D_TYPE' } },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);

      const body = response.body;

      expect(body.isValid).toBe(false);
      expect(body.message).toBeTypeOf('string');
    });
  });

  describe('GET /models/canDelete/{recordId}', function () {
    it('should return 200 with isValid true for a deletable record', async function () {
      const response = await requestSender.canDeleteModel({ pathParams: { recordId: 'rec-1' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);

      const body = response.body;

      expect(body.isValid).toBe(true);
    });
  });

  describe('PATCH /metadata/{identifier}', function () {
    it('should return 200 and an ack for a metadata update', async function () {
      const response = await requestSender.updateMetadata({ pathParams: { identifier: 'rec-1' }, requestBody: { description: 'updated' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.message).toBeTypeOf('string');
    });
  });

  describe('PATCH /metadata/status/{identifier}', function () {
    it('should return 200 and an ack for a valid status change', async function () {
      const response = await requestSender.updateMetadataStatus({ pathParams: { identifier: 'rec-1' }, requestBody: { status: 'PUBLISHED' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);
    });

    it('should return 400 for an invalid status value', async function () {
      const response = await requestSender.updateMetadataStatus({
        pathParams: { identifier: 'rec-1' },
        // @ts-expect-error intentionally invalid status enum value
        requestBody: { status: 'NOT_A_STATUS' },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });
  });
});
