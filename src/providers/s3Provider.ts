import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { S3Client, HeadObjectCommand, type S3ClientConfig } from '@aws-sdk/client-s3';
import { StatusCodes } from 'http-status-codes';
import { SERVICES } from '@common/constants';
import type { ConfigType, S3Config } from '@common/config';
import type { LogContext } from '@common/interfaces';
import { AppError } from '@common/appError';
import type { Provider } from './interfaces';

@injectable()
export class S3Provider implements Provider {
  private readonly logContext: LogContext;
  private readonly s3Config: S3Config;
  private readonly s3: S3Client;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.s3Config = this.config.get('S3');
    const s3ClientConfig: S3ClientConfig = {
      endpoint: this.s3Config.endpointUrl,
      forcePathStyle: this.s3Config.forcePathStyle,
      credentials: {
        accessKeyId: this.s3Config.accessKeyId,
        secretAccessKey: this.s3Config.secretAccessKey,
      },
      region: this.s3Config.region,
      maxAttempts: this.s3Config.maxAttempts,
      tls: this.s3Config.sslEnabled,
    };
    this.s3 = new S3Client(s3ClientConfig);
    this.logContext = {
      fileName: __filename,
      class: S3Provider.name,
    };
  }

  public async fileExists(key: string): Promise<boolean> {
    const logContext = { ...this.logContext, function: this.fileExists.name };
    try {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await this.s3.send(new HeadObjectCommand({ Bucket: this.s3Config.bucket, Key: key }));
      return true;
    } catch (err) {
      const statusCode = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (statusCode === StatusCodes.NOT_FOUND) {
        this.logger.debug({ msg: `key does not exist: ${key}`, logContext });
        return false;
      }
      this.logger.error({ msg: 'something went wrong with S3', logContext, key, err });
      throw new AppError('s3', StatusCodes.INTERNAL_SERVER_ERROR, 'there is a problem with S3', true);
    }
  }
}
