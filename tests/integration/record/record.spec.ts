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
import { buildValidMetadata } from '@tests/helpers/metadata';

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
// findRecords by id (delete) → an existing deletable record; by productName (uniqueness) → none
const catalogStub = {
  findRecords: vi.fn().mockImplementation((payload: { id?: string }) => (payload.id !== undefined ? [deletableRecord] : [])),
} as unknown as CatalogCall;
const jobnikStub = {
  createIngestionJob: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'PENDING' }),
  createDeleteJob: vi.fn().mockResolvedValue({ jobId: 'del-1', status: 'PENDING' }),
} as unknown as JobnikClient;
const providerStub = { fileExists: vi.fn().mockResolvedValue(true) };

const validMetadata = buildValidMetadata();

const validIngestionPayload = {
  modelPath: '/shared/models/afula',
  tilesetFilename: 'tileset.json',
  metadata: validMetadata,
};

describe('record', function () {
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
        { token: SERVICES.PROVIDER, provider: { useValue: providerStub } },
      ],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
  });

  describe('POST /record', function () {
    it('should return 201 and a job response for a valid ingestion request', async function () {
      const response = await requestSender.createRecord({ requestBody: validIngestionPayload });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.CREATED);

      const body = response.body as paths['/record']['post']['responses']['201']['content']['application/json'];

      expect(body.jobId).toBeTypeOf('string');
      expect(body.status).toBeTypeOf('string');
    });

    it('should return 400 when a required field is missing', async function () {
      const response = await requestSender.createRecord({
        // @ts-expect-error intentionally invalid: missing tilesetFilename and metadata
        requestBody: { modelPath: '/shared/models/afula' },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 400 when metadata fails business validation', async function () {
      const response = await requestSender.createRecord({
        requestBody: { ...validIngestionPayload, metadata: { ...validMetadata, productType: 'NOT_A_3D_TYPE' } },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });
  });

  describe('DELETE /record/{id}', function () {
    it('should return 200 and a job response', async function () {
      const response = await requestSender.deleteRecord({ pathParams: { id: 'rec-1' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);

      const body = response.body as paths['/record/{id}']['delete']['responses']['200']['content']['application/json'];

      expect(body.jobId).toBeTypeOf('string');
    });
  });

  describe('PATCH /record/{id}', function () {
    it('should return 200 and an ack for a metadata update', async function () {
      const response = await requestSender.updateRecord({ pathParams: { id: 'rec-1' }, requestBody: { description: 'updated' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.message).toBeTypeOf('string');
    });
  });

  describe('PATCH /record/status/{id}', function () {
    it('should return 200 and an ack for a valid status change', async function () {
      const response = await requestSender.updateRecordStatus({ pathParams: { id: 'rec-1' }, requestBody: { status: 'PUBLISHED' } });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.OK);
    });

    it('should return 400 for an invalid status value', async function () {
      const response = await requestSender.updateRecordStatus({
        pathParams: { id: 'rec-1' },
        // @ts-expect-error intentionally invalid status enum value
        requestBody: { status: 'NOT_A_STATUS' },
      });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });
  });
});
