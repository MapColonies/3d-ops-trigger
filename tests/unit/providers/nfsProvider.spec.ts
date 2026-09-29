import { access } from 'node:fs/promises';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import { NFSProvider } from '@src/providers/nfsProvider';
import { AppError } from '@src/common/appError';
import type { ConfigType } from '@src/common/config';

vi.mock('node:fs/promises', () => ({ access: vi.fn() }));
const mockedAccess = vi.mocked(access);

const configStub = { get: (): unknown => ({ pvPath: '/data/models' }) } as unknown as ConfigType;

describe('NFSProvider', function () {
  let provider: NFSProvider;

  beforeEach(async function () {
    vi.clearAllMocks();
    provider = new NFSProvider(configStub, await jsLogger({ enabled: false }));
  });

  it('should return true when the path is accessible', async function () {
    mockedAccess.mockResolvedValue(undefined);

    await expect(provider.fileExists('afula/tileset.json')).resolves.toBe(true);
  });

  it('should return false when the path does not exist (ENOENT)', async function () {
    mockedAccess.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));

    await expect(provider.fileExists('missing/tileset.json')).resolves.toBe(false);
  });

  it('should throw an AppError on non-ENOENT errors', async function () {
    mockedAccess.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

    await expect(provider.fileExists('locked/tileset.json')).rejects.toThrow(AppError);
  });
});
