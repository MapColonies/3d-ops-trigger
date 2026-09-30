import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { type Registry, Counter } from 'prom-client';
import type { TypedRequestHandlers } from '@openapi';
import { SERVICES } from '@common/constants';
import type { LogContext } from '@common/interfaces';
import { RecordManager } from '../models/recordManager';

@injectable()
export class RecordsController {
  private readonly logContext: LogContext;
  private readonly ingestionJobCounter: Counter;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(RecordManager) private readonly manager: RecordManager,
    @inject(SERVICES.METRICS) private readonly metricsRegistry: Registry
  ) {
    this.logContext = {
      fileName: __filename,
      class: RecordsController.name,
    };
    this.ingestionJobCounter = new Counter({
      name: 'ingestion_jobs_created',
      help: 'number of ingestion jobs created',
      registers: [this.metricsRegistry],
    });
  }

  public createRecord: TypedRequestHandlers['createRecord'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.createRecord.name };
    try {
      const job = await this.manager.createIngestion(req.body);
      this.ingestionJobCounter.inc(1);
      return res.status(StatusCodes.CREATED).json(job);
    } catch (err) {
      this.logger.error({ msg: 'failed to create ingestion job', logContext, err });
      return next(err);
    }
  };

  public validateRecord: TypedRequestHandlers['validateRecord'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.validateRecord.name };
    try {
      const result = await this.manager.validateIngestion(req.body);
      return res.status(StatusCodes.OK).json(result);
    } catch (err) {
      this.logger.error({ msg: 'failed to validate ingestion request', logContext, err });
      return next(err);
    }
  };

  public canDeleteRecord: TypedRequestHandlers['canDeleteRecord'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.canDeleteRecord.name };
    const { recordId } = req.params;
    try {
      const result = await this.manager.canDelete(recordId);
      return res.status(StatusCodes.OK).json(result);
    } catch (err) {
      this.logger.error({ msg: 'failed to validate record deletability', logContext, err, recordId });
      return next(err);
    }
  };

  public deleteRecord: TypedRequestHandlers['deleteRecord'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.deleteRecord.name };
    const { recordId } = req.params;
    try {
      const job = await this.manager.deleteRecord(recordId);
      return res.status(StatusCodes.OK).json(job);
    } catch (err) {
      this.logger.error({ msg: 'failed to create delete job', logContext, err, recordId });
      return next(err);
    }
  };
}
