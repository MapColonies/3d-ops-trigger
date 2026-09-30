import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import type { TypedRequestHandlers } from '@openapi';
import { SERVICES } from '@common/constants';
import type { LogContext } from '@common/interfaces';
import { JobManager } from '../models/jobManager';

@injectable()
export class JobController {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(JobManager) private readonly manager: JobManager
  ) {
    this.logContext = {
      fileName: __filename,
      class: JobController.name,
    };
  }

  public getJobStatus: TypedRequestHandlers['getJobStatus'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.getJobStatus.name };
    const { jobId } = req.params;
    try {
      const status = await this.manager.getStatus(jobId);
      return res.status(StatusCodes.OK).json(status);
    } catch (err) {
      this.logger.error({ msg: 'failed to get job status', logContext, err, jobId });
      return next(err);
    }
  };
}
