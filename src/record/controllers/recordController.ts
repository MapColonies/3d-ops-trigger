import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import type { LogContext } from '@map-colonies/3d-shared';
import type { TypedRequestHandlers } from '@openapi';
import { SERVICES } from '@common/constants';
import { RecordManager } from '../models/recordManager';

@injectable()
export class RecordController {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(RecordManager) private readonly manager: RecordManager
  ) {
    this.logContext = {
      fileName: __filename,
      class: RecordController.name,
    };
  }

  public createRecord: TypedRequestHandlers['createRecord'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.createRecord.name };
    try {
      const job = await this.manager.createIngestion(req.body);
      return res.status(StatusCodes.CREATED).json(job);
    } catch (err) {
      this.logger.error({ msg: 'failed to create ingestion job', logContext, err });
      return next(err);
    }
  };

  public deleteRecord: TypedRequestHandlers['deleteRecord'] = (req, res, next) => {
    const logContext = { ...this.logContext, function: this.deleteRecord.name };
    const { id } = req.params;
    try {
      const job = this.manager.deleteRecord(id);
      return res.status(StatusCodes.OK).json(job);
    } catch (err) {
      this.logger.error({ msg: 'failed to create delete job', logContext, err, recordId: id });
      return next(err);
    }
  };

  public updateRecord: TypedRequestHandlers['updateRecord'] = (req, res, next) => {
    const logContext = { ...this.logContext, function: this.updateRecord.name };
    const { id } = req.params;
    try {
      const ack = this.manager.updateMetadata(id, req.body);
      return res.status(StatusCodes.OK).json(ack);
    } catch (err) {
      this.logger.error({ msg: 'failed to update record metadata', logContext, err, recordId: id });
      return next(err);
    }
  };

  public updateRecordStatus: TypedRequestHandlers['updateRecordStatus'] = (req, res, next) => {
    const logContext = { ...this.logContext, function: this.updateRecordStatus.name };
    const { id } = req.params;
    try {
      const ack = this.manager.updateStatus(id, req.body);
      return res.status(StatusCodes.OK).json(ack);
    } catch (err) {
      this.logger.error({ msg: 'failed to update record status', logContext, err, recordId: id });
      return next(err);
    }
  };
}
