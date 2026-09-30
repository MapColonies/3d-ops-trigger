import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { type Registry, Counter } from 'prom-client';
import type { TypedRequestHandlers } from '@openapi';
import { SERVICES } from '@common/constants';
import type { LogContext } from '@common/interfaces';
import { RecordManager } from '../../record/models/recordManager';

@injectable()
export class JobOperationsController {
  private readonly logContext: LogContext;
  private readonly ingestionJobCounter: Counter;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(RecordManager) private readonly manager: RecordManager,
    @inject(SERVICES.METRICS) private readonly metricsRegistry: Registry
  ) {
    this.logContext = {
      fileName: __filename,
      class: JobOperationsController.name,
    };
    this.ingestionJobCounter = new Counter({
      name: 'ingestion_jobs_created',
      help: 'number of ingestion jobs created',
      registers: [this.metricsRegistry],
    });
  }

  public createIngestion: TypedRequestHandlers['createIngestion'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.createIngestion.name };
    try {
      const job = await this.manager.createIngestion(req.body);
      this.ingestionJobCounter.inc(1);
      return res.status(StatusCodes.CREATED).json(job);
    } catch (err) {
      this.logger.error({ msg: 'failed to create ingestion job', logContext, err });
      return next(err);
    }
  };

  public createDelete: TypedRequestHandlers['createDelete'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.createDelete.name };
    const { id } = req.body;
    try {
      const job = await this.manager.deleteRecord(id);
      return res.status(StatusCodes.OK).json(job);
    } catch (err) {
      this.logger.error({ msg: 'failed to create delete job', logContext, err, recordId: id });
      return next(err);
    }
  };
}
