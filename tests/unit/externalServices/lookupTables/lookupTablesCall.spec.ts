import axios from 'axios';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import { LookupTablesCall } from '@src/externalServices/lookupTables/lookupTablesCall';
import { AppError } from '@src/common/appError';
import type { ConfigType } from '@src/common/config';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const configStub = { get: (): unknown => ({ url: 'http://lookup', subUrl: 'lookup-tables/lookupData' }) } as unknown as ConfigType;

describe('LookupTablesCall', function () {
  let client: LookupTablesCall;

  beforeEach(async function () {
    vi.clearAllMocks();
    client = new LookupTablesCall(configStub, await jsLogger({ enabled: false }));
  });

  it('should return the classification values from the service', async function () {
    mockedAxios.get.mockResolvedValue({
      data: [
        { value: 'a', translationCode: 'x' },
        { value: 'b', translationCode: 'y' },
      ],
    });

    await expect(client.getClassifications()).resolves.toEqual(['a', 'b']);
  });

  it('should throw an AppError when the lookup-tables service fails', async function () {
    mockedAxios.get.mockRejectedValue(new Error('service down'));

    await expect(client.getClassifications()).rejects.toThrow(AppError);
  });
});
