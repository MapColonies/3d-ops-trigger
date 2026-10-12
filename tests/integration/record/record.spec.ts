import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import nock from 'nock';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-supertest';
import type { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { getConfig, initConfig, type LookupTablesConfig } from '@src/common/config';
import type { IngestionPayload } from '@src/record/models/recordManager';

const ingestionPayload: IngestionPayload = {
  modelPath: '\\\\domtest\\models\\afula\\data\\tileset.json',
  productShapefilePath: '\\\\domtest\\models\\afula\\shape\\Product.shp',
  metadataShapefilePath: '\\\\domtest\\models\\afula\\shape\\ShapeMetadata.shp',
  productType: '3DPhotoRealistic',
  classification: '4',
  region: ['israel'],
};

let lookupTables: LookupTablesConfig;
let catalogUrl: string;

const mockLookupTables = (): void => {
  nock(lookupTables.url)
    .persist()
    .get(`/${lookupTables.subUrl}/classification`)
    .reply(httpStatusCodes.OK, [{ value: '4', translationCode: 'restricted' }])
    .get(`/${lookupTables.subUrl}/countries`)
    .reply(httpStatusCodes.OK, [{ value: 'israel', translationCode: 'israel' }]);
};

const mockCatalogFind = (records: unknown[] = []): void => {
  nock(catalogUrl).persist().post('/metadata/find').reply(httpStatusCodes.OK, records);
};

describe('record', function () {
  let requestSender: RequestSender<paths, operations>;

  beforeAll(async function () {
    await initConfig(true);
    lookupTables = getConfig().get('externalServices.lookupTables');
    catalogUrl = getConfig().get('externalServices.catalogUrl');
    const externalHosts = [new URL(lookupTables.url).host, new URL(catalogUrl).host];
    nock.disableNetConnect();
    nock.enableNetConnect((host) => !externalHosts.includes(host));

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
    nock.cleanAll();
  });

  describe('POST /record', function () {
    describe('Happy Path 🙂', function () {
      it.each([
        ['a tileset.json model', '\\\\domtest\\models\\afula\\data\\tileset.json'],
        ['a .3tz model', '\\\\domtest\\models\\afula\\data\\model.3tz'],
      ])('should return 201 and a job response for %s', async function (_case, modelPath) {
        mockLookupTables();
        mockCatalogFind();

        const response = await requestSender.createRecord({ requestBody: { ...ingestionPayload, modelPath } });

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
        ["modelPath can't be empty", { modelPath: '' }, 'modelPath'],
        ["productShapefilePath can't be empty", { productShapefilePath: '' }, 'productShapefilePath'],
        ["metadataShapefilePath can't be empty", { metadataShapefilePath: '' }, 'metadataShapefilePath'],
        ['classification is empty', { classification: '' }, 'classification'],
        ['region is empty', { region: [] }, 'region'],
        ["a region value can't be empty", { region: ['israel', ''] }, 'region/1'],
        ['the classification value is not in the lookup table', { classification: 'notInLookup' }, 'classification'],
        ['invalid region value', { region: ['invalid-region'] }, 'region'],
        ['region values must be unique', { region: ['israel', 'israel'] }, 'region'],
        ['invalid productType value', { productType: 'NOT_A_3D_TYPE' }, 'productType'],
        ['invalid classification value', { classification: '4-a' }, 'classification'],
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

      it('should return 400 when a model file does not exist', async function () {
        const response = await requestSender.createRecord({
          requestBody: { ...ingestionPayload, modelPath: '\\\\domtest\\models\\afula\\data\\missing.json' },
        });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', 'missing files: afula/data/missing.json');
      });

      it('should return 400 when a path is not under the base path', async function () {
        const response = await requestSender.createRecord({
          requestBody: { ...ingestionPayload, modelPath: '\\\\other\\share\\afula\\data\\tileset.json' },
        });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', expect.stringContaining("isn't in the agreed folder"));
      });

      it('should return 400 when the product already exists in the catalog', async function () {
        mockLookupTables();
        mockCatalogFind([{ id: 'existing', productId: 'AFL', productName: 'afula' }]);

        const response = await requestSender.createRecord({ requestBody: ingestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', 'product id is not unique!');
      });
    });

    describe('Sad Path 😥', function () {
      it('should return 500 when the lookup-tables service is down', async function () {
        nock(lookupTables.url).get(`/${lookupTables.subUrl}/classification`).reply(httpStatusCodes.SERVICE_UNAVAILABLE);

        const response = await requestSender.createRecord({ requestBody: ingestionPayload });

        expect(response).toSatisfyApiSpec();
        expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
      });

      it('should return 500 when the catalog service is down', async function () {
        mockLookupTables();
        nock(catalogUrl).post('/metadata/find').reply(httpStatusCodes.SERVICE_UNAVAILABLE);

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
