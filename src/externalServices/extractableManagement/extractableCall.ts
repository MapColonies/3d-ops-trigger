import axios from 'axios';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { SERVICES } from '@common/constants';
import { AppError } from '@common/appError';
import type { ConfigType } from '@common/config';
import type { LogContext } from '@common/interfaces';

@injectable()
export class ExtractableCall {
  private readonly logContext: LogContext;
  private readonly extractable: string;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.extractable = this.config.get('externalServices.extractable');
    this.logContext = {
      fileName: __filename,
      class: ExtractableCall.name,
    };
  }

  public async isExtractableRecordExists(recordName: string): Promise<boolean> {
    const logContext = { ...this.logContext, function: this.isExtractableRecordExists.name };
    this.logger.debug({ msg: `Checking record '${recordName}' in extractable service`, logContext });
    try {
      const response = await axios.get(`${this.extractable}/records/${encodeURIComponent(recordName)}`, {
        validateStatus: (status) => status === StatusCodes.OK.valueOf() || status === StatusCodes.NOT_FOUND.valueOf(),
      });
      return response.status === StatusCodes.OK.valueOf();
    } catch (err) {
      this.logger.error({ msg: 'Something went wrong in extractable when checking a record', logContext, recordName, err });
      throw new AppError('extractable', StatusCodes.INTERNAL_SERVER_ERROR, 'Problem with extractable during record lookup', true);
    }
  }
}
