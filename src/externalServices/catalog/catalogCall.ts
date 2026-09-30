import axios from 'axios';
import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { SERVICES } from '@common/constants';
import { AppError } from '@common/appError';
import type { ConfigType } from '@common/config';
import type { LogContext } from '@common/interfaces';
import type { CatalogStatusPayload, CatalogUpdatePayload, IFindRecordsPayload, Record3D } from './interfaces';

@injectable()
export class CatalogCall {
  private readonly logContext: LogContext;
  private readonly catalog: string;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    this.catalog = this.config.get('externalServices.catalog');
    this.logContext = {
      fileName: __filename,
      class: CatalogCall.name,
    };
  }

  public async findRecords(payload: IFindRecordsPayload): Promise<Record3D[]> {
    const logContext = { ...this.logContext, function: this.findRecords.name };
    this.logger.debug({ msg: `Searching in catalog ${this.catalog}/metadata/find`, logContext, payload });
    try {
      const response = await axios.post<Record3D[]>(`${this.catalog}/metadata/find`, payload);
      if (response.status !== StatusCodes.OK.valueOf()) {
        this.logger.error({ msg: `Catalog returned unexpected status: ${response.status}`, logContext });
        throw new AppError('catalog', StatusCodes.INTERNAL_SERVER_ERROR, 'Problem with catalog during record lookup', true);
      }

      const records = response.data;
      if (!Array.isArray(records)) {
        return [];
      }

      this.logger.debug({ msg: `Found ${records.length} record(s) in catalog`, logContext });
      return records;
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }

      this.logger.error({ msg: 'Something went wrong in catalog when trying to find records', logContext, err });
      throw new AppError('catalog', StatusCodes.INTERNAL_SERVER_ERROR, 'Problem with catalog find', true);
    }
  }

  public async getRecord(identifier: string): Promise<Record3D | undefined> {
    const logContext = { ...this.logContext, function: this.getRecord.name };
    this.logger.debug({ msg: `Getting record ${identifier} from catalog`, logContext });
    try {
      const response = await axios.get<Record3D | undefined>(`${this.catalog}/metadata/${identifier}`, {
        validateStatus: (status) => status === StatusCodes.OK.valueOf() || status === StatusCodes.NOT_FOUND.valueOf(),
      });
      return response.status === StatusCodes.NOT_FOUND.valueOf() ? undefined : response.data;
    } catch (err) {
      this.logger.error({ msg: 'Something went wrong in catalog when getting a record', logContext, identifier, err });
      throw new AppError('catalog', StatusCodes.INTERNAL_SERVER_ERROR, 'Problem with catalog during record lookup', true);
    }
  }

  public async patchMetadata(identifier: string, payload: CatalogUpdatePayload): Promise<Record3D> {
    const logContext = { ...this.logContext, function: this.patchMetadata.name };
    this.logger.debug({ msg: `Updating metadata for record ${identifier} in catalog`, logContext });
    try {
      const response = await axios.patch<Record3D>(`${this.catalog}/metadata/${identifier}`, payload);
      return response.data;
    } catch (err) {
      this.logger.error({ msg: 'Something went wrong in catalog when updating metadata', logContext, identifier, err });
      throw new AppError('catalog', StatusCodes.INTERNAL_SERVER_ERROR, 'Problem with catalog during metadata update', true);
    }
  }

  public async changeStatus(identifier: string, payload: CatalogStatusPayload): Promise<Record3D> {
    const logContext = { ...this.logContext, function: this.changeStatus.name };
    this.logger.debug({ msg: `Changing status for record ${identifier} in catalog`, logContext });
    try {
      const response = await axios.patch<Record3D>(`${this.catalog}/metadata/status/${identifier}`, payload);
      return response.data;
    } catch (err) {
      this.logger.error({ msg: 'Something went wrong in catalog when changing status', logContext, identifier, err });
      throw new AppError('catalog', StatusCodes.INTERNAL_SERVER_ERROR, 'Problem with catalog during status change', true);
    }
  }
}
