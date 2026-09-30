import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import type { TypedRequestHandlers } from '@openapi';
import { SERVICES } from '@common/constants';
import type { LogContext } from '@common/interfaces';
import { RecordManager } from '../../record/models/recordManager';

@injectable()
export class ModelsController {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(RecordManager) private readonly manager: RecordManager
  ) {
    this.logContext = {
      fileName: __filename,
      class: ModelsController.name,
    };
  }

  public validateModel: TypedRequestHandlers['validateModel'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.validateModel.name };
    try {
      const result = await this.manager.validateIngestion(req.body);
      return res.status(StatusCodes.OK).json(result);
    } catch (err) {
      this.logger.error({ msg: 'failed to validate ingestion request', logContext, err });
      return next(err);
    }
  };

  public canDeleteModel: TypedRequestHandlers['canDeleteModel'] = async (req, res, next) => {
    const logContext = { ...this.logContext, function: this.canDeleteModel.name };
    const { recordId } = req.params;
    try {
      const result = await this.manager.canDelete(recordId);
      return res.status(StatusCodes.OK).json(result);
    } catch (err) {
      this.logger.error({ msg: 'failed to validate record deletability', logContext, err, recordId });
      return next(err);
    }
  };
}
