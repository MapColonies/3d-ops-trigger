import axios from 'axios';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { AppError, type LogContext } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { ConfigType, LookupTablesConfig } from '@common/config';
import { LookupKey, type ILookupOption } from './interfaces';

@injectable()
export class LookupTablesClient {
  private readonly logContext: LogContext;
  private readonly lookupTables: LookupTablesConfig;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.lookupTables = this.config.get('externalServices.lookupTables');
    this.logContext = {
      fileName: __filename,
      class: LookupTablesClient.name,
    };
  }

  public async getClassifications(): Promise<string[]> {
    return this.getLookupValues(LookupKey.CLASSIFICATION);
  }

  public async getCountries(): Promise<string[]> {
    return this.getLookupValues(LookupKey.COUNTRIES);
  }

  private async getLookupValues(lookupKey: LookupKey): Promise<string[]> {
    const logContext = { ...this.logContext, function: this.getLookupValues.name };
    this.logger.debug({ msg: `Get ${lookupKey} from lookup-tables service`, logContext });
    try {
      const response = await axios.get<ILookupOption[]>(`${this.lookupTables.url}/${this.lookupTables.subUrl}/${lookupKey}`);
      const values = response.data.map((item) => item.value);
      this.logger.debug({ msg: `Got ${lookupKey}`, logContext, values });

      return values;
    } catch (err) {
      this.logger.error({ msg: 'something went wrong with lookup-tables service', logContext, err, lookupKey });
      throw new AppError(
        'lookup-tables',
        StatusCodes.INTERNAL_SERVER_ERROR,
        `there is a problem with lookup-tables while getting ${lookupKey}`,
        true
      );
    }
  }
}
