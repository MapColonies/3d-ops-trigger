import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import type { TypedRequestHandlers } from '@openapi';
import { SERVICES } from '@common/constants';
import type { LogContext } from '@common/interfaces';
import { RecordManager } from '../../records/models/recordManager';

@injectable()
export class MetadataController {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(RecordManager) private readonly manager: RecordManager
  ) {
    this.logContext = {
      fileName: __filename,
      class: MetadataController.name,
    };
  }

  public updateMetadata: TypedRequestHandlers['updateMetadata'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.updateMetadata.name };
    const { identifier } = req.params;
    try {
      const ack = await this.manager.updateMetadata(identifier, req.body);
      return res.status(StatusCodes.OK).json(ack);
    } catch (err) {
      this.logger.error({ msg: 'failed to update record metadata', logContext, err, recordId: identifier });
      return next(err);
    }
  };

  public updateMetadataStatus: TypedRequestHandlers['updateMetadataStatus'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.updateMetadataStatus.name };
    const { identifier } = req.params;
    try {
      const ack = await this.manager.updateStatus(identifier, req.body);
      return res.status(StatusCodes.OK).json(ack);
    } catch (err) {
      this.logger.error({ msg: 'failed to update record status', logContext, err, recordId: identifier });
      return next(err);
    }
  };
}
