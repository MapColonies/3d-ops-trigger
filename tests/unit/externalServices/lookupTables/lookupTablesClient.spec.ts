import axios from 'axios';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import { AppError } from '@map-colonies/3d-shared';
import { LookupTablesClient } from '@src/externalServices/lookupTables/lookupTablesClient';
import type { ConfigType } from '@src/common/config';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const configStub = { get: (): unknown => ({ url: 'http://lookup', subUrl: 'lookup-tables/lookupData' }) } as unknown as ConfigType;

describe('LookupTablesClient', function () {
  let client: LookupTablesClient;

  beforeEach(async function () {
    vi.clearAllMocks();
    client = new LookupTablesClient(configStub, await jsLogger({ enabled: false }));
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
