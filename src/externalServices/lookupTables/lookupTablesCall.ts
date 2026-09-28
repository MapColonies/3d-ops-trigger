import axios from 'axios';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { SERVICES } from '@common/constants';
import { AppError } from '@common/appError';
import type { ConfigType, LookupTablesConfig } from '@common/config';
import type { LogContext } from '@common/interfaces';
import type { ILookupOption } from './interfaces';

@injectable()
export class LookupTablesCall {
  private readonly logContext: LogContext;
  private readonly lookupTables: LookupTablesConfig;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.lookupTables = this.config.get('externalServices.lookupTables');
    this.logContext = {
      fileName: __filename,
      class: LookupTablesCall.name,
    };
  }

  public async getClassifications(): Promise<string[]> {
    const logContext = { ...this.logContext, function: this.getClassifications.name };
    this.logger.debug({ msg: 'Get Classifications from lookup-tables service', logContext });
    try {
      const response = await axios.get<ILookupOption[]>(`${this.lookupTables.url}/${this.lookupTables.subUrl}/classification`);
      const classifications = response.data.map((item) => item.value);
      this.logger.debug({ msg: 'Got Classifications', logContext, classifications });

      return classifications;
    } catch (err) {
      this.logger.error({ msg: 'something went wrong with lookup-tables service', logContext, err });
      throw new AppError('lookup-tables', StatusCodes.INTERNAL_SERVER_ERROR, 'there is a problem with lookup-tables', true);
    }
  }
}
