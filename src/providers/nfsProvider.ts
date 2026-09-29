import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import type { LogContext } from '@common/interfaces';
import { AppError } from '@common/appError';
import type { Provider } from './interfaces';

@injectable()
export class NFSProvider implements Provider {
  private readonly logContext: LogContext;
  private readonly pvPath: string;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.pvPath = this.config.get('NFS').pvPath;
    this.logContext = {
      fileName: __filename,
      class: NFSProvider.name,
    };
  }

  public async fileExists(relativePath: string): Promise<boolean> {
    const logContext = { ...this.logContext, function: this.fileExists.name };
    const fullPath = join(this.pvPath, relativePath);
    try {
      await access(fullPath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.debug({ msg: `path does not exist: ${fullPath}`, logContext });
        return false;
      }
      this.logger.error({ msg: 'something went wrong with the NFS provider', logContext, fullPath, err });
      throw new AppError('nfs', StatusCodes.INTERNAL_SERVER_ERROR, 'there is a problem with the NFS provider', true);
    }
  }
}
