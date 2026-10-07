import axios from 'axios';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { AppError, type LogContext, type IFindRecordsPayload, type Record3D } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';

@injectable()
export class CatalogClient {
  private readonly logContext: LogContext;
  private readonly catalog: string;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.catalog = this.config.get('externalServices.catalog');
    this.logContext = {
      fileName: __filename,
      class: CatalogClient.name,
    };
  }

  public async findRecords(payload: IFindRecordsPayload): Promise<Record3D[]> {
    const logContext = { ...this.logContext, function: this.findRecords.name };
    this.logger.debug({ msg: `Searching in catalog ${this.catalog}/metadata/find`, logContext, payload });
    try {
      const response = await axios.post<Record3D[]>(`${this.catalog}/metadata/find`, payload);
      if (response.status !== StatusCodes.OK.valueOf()) {
        this.logger.error({ msg: `Catalog returned unexpected status: ${response.status}`, logContext, payload });
        throw new AppError('catalog', StatusCodes.INTERNAL_SERVER_ERROR, 'Problem with catalog during findRecords', true);
      }

      const records = response.data;
      if (!Array.isArray(records)) {
        this.logger.error({ msg: 'Catalog returned a non-array response', logContext, payload });
        throw new AppError('catalog', StatusCodes.INTERNAL_SERVER_ERROR, 'Problem with catalog during findRecords', true);
      }

      this.logger.debug({ msg: `Found ${records.length} record(s) in catalog`, logContext });
      return records;
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }

      this.logger.error({ msg: 'Something went wrong in catalog when trying to find records', logContext, err, payload });
      throw new AppError('catalog', StatusCodes.INTERNAL_SERVER_ERROR, 'Problem with catalog find', true);
    }
  }
}
