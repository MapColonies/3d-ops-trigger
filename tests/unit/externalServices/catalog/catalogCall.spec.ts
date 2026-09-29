import axios from 'axios';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { CatalogCall } from '@src/externalServices/catalog/catalogCall';
import { AppError } from '@src/common/appError';
import type { ConfigType } from '@src/common/config';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

const configStub = { get: (): unknown => 'http://catalog' } as unknown as ConfigType;

describe('CatalogCall', function () {
  let client: CatalogCall;

  beforeEach(async function () {
    vi.clearAllMocks();
    client = new CatalogCall(configStub, await jsLogger({ enabled: false }));
  });

  it('should return the records found by the catalog service', async function () {
    mockedAxios.post.mockResolvedValue({ status: StatusCodes.OK, data: [{ id: '1', productName: 'afula' }] });

    const records = await client.findRecords({ productName: 'afula' });

    expect(records).toHaveLength(1);
    expect(records[0].productName).toBe('afula');
  });

  it('should throw an AppError when the catalog service fails', async function () {
    mockedAxios.post.mockRejectedValue(new Error('service down'));

    await expect(client.findRecords({ productName: 'afula' })).rejects.toThrow(AppError);
  });
});
