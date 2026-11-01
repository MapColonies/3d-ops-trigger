import axios from 'axios';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '@map-colonies/3d-shared';
import { CatalogClient } from '@src/externalServices/catalog/catalogClient';
import type { ConfigType } from '@src/common/config';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const configStub = { get: (): unknown => 'http://catalog' } as unknown as ConfigType;

describe('CatalogClient', function () {
  let client: CatalogClient;

  beforeEach(async function () {
    vi.clearAllMocks();
    client = new CatalogClient(configStub, await jsLogger({ enabled: false }));
  });

  it('should return the records found by the catalog service', async function () {
    mockedAxios.post.mockResolvedValue({ status: StatusCodes.OK, data: [{ id: '1', productName: 'paris' }] });

    const records = await client.findRecords({ productName: 'paris' });

    expect(records).toHaveLength(1);
    expect(records[0]?.productName).toBe('paris');
  });

  it('should throw an AppError when the catalog service fails', async function () {
    mockedAxios.post.mockRejectedValue(new Error('service down'));

    await expect(client.findRecords({ productName: 'paris' })).rejects.toThrow(AppError);
  });

  it('should throw an AppError when the catalog returns an unexpected status', async function () {
    mockedAxios.post.mockResolvedValue({ status: StatusCodes.NO_CONTENT, data: [] });

    await expect(client.findRecords({ productName: 'paris' })).rejects.toThrow('Problem with catalog during findRecords');
  });

  it('should throw an AppError when the catalog returns a non-array body', async function () {
    mockedAxios.post.mockResolvedValue({ status: StatusCodes.OK, data: { id: '1' } });

    await expect(client.findRecords({ productName: 'paris' })).rejects.toThrow('Problem with catalog during findRecords');
  });
});
