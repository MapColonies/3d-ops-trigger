import type { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '@common/constants';
import type { JobStatusResponse, LogContext } from '@common/interfaces';
import { JobnikClient } from '../../externalServices/jobnik/jobnikClient';

@injectable()
export class JobManager {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(JobnikClient) private readonly jobnik: JobnikClient
  ) {
    this.logContext = {
      fileName: __filename,
      class: JobManager.name,
    };
  }

  public async getStatus(jobId: string): Promise<JobStatusResponse> {
    const logContext = { ...this.logContext, function: this.getStatus.name };
    this.logger.info({ msg: 'fetching job status', logContext, jobId });
    return this.jobnik.getJobStatus(jobId);
  }
}
