import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import nock, { cleanAll, disableNetConnect, enableNetConnect } from 'nock';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-supertest';
import type { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { getConfig, initConfig, type LookupTablesConfig } from '@src/common/config';
import type { IngestionPayload } from '@src/record/models/recordManager';

const ingestionPayload: IngestionPayload = {
  modelPath: '/shared/models/afula/data/tileset.json',
  productShapefilePath: '/shared/models/afula/shape/Product.shp',
  metadataShapefilePath: '/shared/models/afula/shape/ShapeMetadata.shp',
  productType: '3DPhotoRealistic',
  classification: '4',
  region: ['israel'],
};

let lookupTables: LookupTablesConfig;

const mockLookupTables = (): void => {
  nock(lookupTables.url)
    .persist()
    .get(`/${lookupTables.subUrl}/classification`)
    .reply(httpStatusCodes.OK, [{ value: '4', translationCode: 'restricted' }])
    .get(`/${lookupTables.subUrl}/countries`)
    .reply(httpStatusCodes.OK, [{ value: 'israel', translationCode: 'israel' }]);
};

describe('record', function () {
  let requestSender: RequestSender<paths, operations>;

  beforeAll(async function () {
    await initConfig(true);
    lookupTables = getConfig().get('externalServices.lookupTables');
    const lookupTablesHost = new URL(lookupTables.url).host;
    disableNetConnect();
    enableNetConnect((host) => host !== lookupTablesHost);

    const [app] = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: await jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
      ],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
  });

  afterEach(function () {
    cleanAll();
  });

  describe('POST /record', function () {
    describe('Happy Path 🙂', function () {
      it('should return 201 and a job response for a valid ingestion request', async function () {
        mockLookupTables();

        const response = await requestSender.createRecord({ requestBody: ingestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.CREATED);

        expect(response.body).toMatchObject({ status: 'PENDING' });
      });
    });

    describe('Bad Path 😡', function () {
      it.each(['modelPath', 'productShapefilePath', 'metadataShapefilePath', 'productType', 'classification', 'region'] as const)(
        'should return 400 when the required field %s is missing',
        async function (field) {
          const requestBody: Partial<IngestionPayload> = { ...ingestionPayload };
          delete requestBody[field];

          const response = await requestSender.createRecord({ requestBody: requestBody as IngestionPayload });

          expect(response).toSatisfyApiSpec();
          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          expect(response.body).toHaveProperty('message', expect.stringContaining(field));
        }
      );

      it.each([
        ['modelPath is empty', { modelPath: '' }, 'modelPath'],
        ['productShapefilePath is empty', { productShapefilePath: '' }, 'productShapefilePath'],
        ['metadataShapefilePath is empty', { metadataShapefilePath: '' }, 'metadataShapefilePath'],
        ['classification is empty', { classification: '' }, 'classification'],
        ['region is empty', { region: [] }, 'region'],
        ['the region value is not in the lookup table', { region: ['invalid-region'] }, 'region'],
        ['productType is not a valid enum value', { productType: 'NOT_A_3D_TYPE' }, 'productType'],
        ['an invalid classification value is sent', { classification: '4-a' }, 'classification'],
      ])('should return 400 when %s', async function (_case, override, field) {
        mockLookupTables();

        const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, ...override } as IngestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', expect.stringContaining(field));
      });

      it.each([
        ['an unknown field', { unknownField: 'x' }],
        ['productName', { productName: 'afula' }],
        ['productId', { productId: 'afula-1' }],
      ])('should return 400 when %s is sent', async function (_case, extraField) {
        const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, ...extraField } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', 'request/body must NOT have additional properties');
      });

      it('should return 400 when the body is empty', async function () {
        const response = await requestSender.createRecord({ requestBody: {} as IngestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      });

      it('should return 400 when the classification is not in the lookup table', async function () {
        mockLookupTables();

        const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, classification: 'notInLookup' } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', expect.stringContaining('classification is not a valid value'));
      });

      it('should return 400 for an invalid region value (not in the lookup table)', async function () {
        mockLookupTables();

        const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, region: ['israel', 'Atlantis'] } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', expect.stringContaining('region contains invalid values: Atlantis'));
      });
    });

    describe('Sad Path 😥', function () {
      it('should return 500 when the lookup-tables service is down', async function () {
        nock(lookupTables.url).get(`/${lookupTables.subUrl}/classification`).reply(httpStatusCodes.SERVICE_UNAVAILABLE);

        const response = await requestSender.createRecord({ requestBody: ingestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
      });
    });
  });

  describe('DELETE /record/{id}', function () {
    describe('Happy Path 🙂', function () {
      it('should return 200 and a job response', async function () {
        const response = await requestSender.deleteRecord({ pathParams: { id: 'rec-1' } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.OK);

        expect(response.body).toMatchObject({ status: 'PENDING' });
      });
    });
  });

  describe('PATCH /record/{id}', function () {
    describe('Happy Path 🙂', function () {
      it('should return 200 and an ack for a metadata update', async function () {
        const response = await requestSender.updateRecord({ pathParams: { id: 'rec-1' }, requestBody: { description: 'updated' } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response.body.message).toBeTypeOf('string');
      });
    });

    describe('Bad Path 😡', function () {
      it('should return 400 when the body is not an object', async function () {
        const response = await requestSender.updateRecord({
          pathParams: { id: 'rec-1' },
          requestBody: ['description'] as unknown as Record<string, never>,
        });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      });
    });
  });

  describe('PATCH /record/status/{id}', function () {
    describe('Happy Path 🙂', function () {
      it('should return 200 and an ack for a valid status change', async function () {
        const response = await requestSender.updateRecordStatus({ pathParams: { id: 'rec-1' }, requestBody: { status: 'PUBLISHED' } });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.OK);
      });
    });

    describe('Bad Path 😡', function () {
      it('should return 400 for an invalid status value', async function () {
        const response = await requestSender.updateRecordStatus({
          pathParams: { id: 'rec-1' },
          // @ts-expect-error intentionally invalid status enum value
          requestBody: { status: 'NOT_A_STATUS' },
        });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      });

      it('should return 400 when the status is missing', async function () {
        const response = await requestSender.updateRecordStatus({
          pathParams: { id: 'rec-1' },
          requestBody: {} as { status: 'PUBLISHED' },
        });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', expect.stringContaining('status'));
      });
    });
  });
});
