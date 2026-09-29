import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { S3Provider } from '@src/providers/s3Provider';
import { AppError } from '@src/common/appError';
import type { ConfigType } from '@src/common/config';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  S3Client: class {
    public send = sendMock;
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention
  HeadObjectCommand: class {
    public constructor(public readonly input: unknown) {}
  },
}));

const configStub = {
  get: (): unknown => ({
    accessKeyId: 'k',
    secretAccessKey: 's',
    endpointUrl: 'http://s3',
    bucket: 'b',
    region: 'us-east-1',
    forcePathStyle: true,
    sslEnabled: false,
    maxAttempts: 3,
  }),
} as unknown as ConfigType;

describe('S3Provider', function () {
  let provider: S3Provider;

  beforeEach(async function () {
    vi.clearAllMocks();
    provider = new S3Provider(configStub, await jsLogger({ enabled: false }));
  });

  it('should return true when the object exists', async function () {
    sendMock.mockResolvedValue({});

    await expect(provider.fileExists('afula/tileset.json')).resolves.toBe(true);
  });

  it('should return false when the object is not found (404)', async function () {
    sendMock.mockRejectedValue({ $metadata: { httpStatusCode: StatusCodes.NOT_FOUND } });

    await expect(provider.fileExists('missing')).resolves.toBe(false);
  });

  it('should throw an AppError on other S3 errors', async function () {
    sendMock.mockRejectedValue({ $metadata: { httpStatusCode: StatusCodes.INTERNAL_SERVER_ERROR } });

    await expect(provider.fileExists('boom')).rejects.toThrow(AppError);
  });
});
