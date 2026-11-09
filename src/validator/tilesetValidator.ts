import { basename } from 'node:path';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { ValidationIssueSeverity, ValidationOptions, Validators, type ValidationIssue } from '3d-tiles-validator';
import { AppError, type LogContext } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';

const MAX_REPORTED_ISSUES = 3;

export const ERROR_TILESET_VALIDATION_FAILED = 'tileset validation failed';

@injectable()
export class TilesetValidator {
  private readonly logContext: LogContext;
  private readonly validationOptions = ValidationOptions.fromJson({ validateContentData: false });

  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {
    this.logContext = {
      fileName: __filename,
      class: TilesetValidator.name,
    };
  }

  public async validate(modelPath: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.validate.name };
    this.logger.info({ msg: 'validating tileset with 3d-tiles-validator', logContext, modelPath });

    let issues: readonly ValidationIssue[];
    try {
      ({ issues } = await Validators.validateTilesetFile(modelPath, this.validationOptions));
    } catch (err) {
      this.logger.error({ msg: ERROR_TILESET_VALIDATION_FAILED, logContext, modelPath, err });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, ERROR_TILESET_VALIDATION_FAILED, true);
    }

    const errors = issues.filter((issue) => issue.severity === ValidationIssueSeverity.ERROR);
    const warnings = issues.filter((issue) => issue.severity === ValidationIssueSeverity.WARNING);
    if (warnings.length > 0) {
      this.logger.warn({
        msg: 'tileset validation warnings',
        logContext,
        modelPath,
        warnings: warnings.map((issue) => this.format(issue, modelPath)),
      });
    }
    if (errors.length > 0) {
      const details = errors.map((issue) => this.format(issue, modelPath));
      const message = `${ERROR_TILESET_VALIDATION_FAILED}: ${details.slice(0, MAX_REPORTED_ISSUES).join('; ')}`;
      this.logger.error({ msg: message, logContext, modelPath, errors: details });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
    }

    this.logger.info({ msg: 'tileset validated successfully', logContext, modelPath });
  }

  private format(issue: ValidationIssue, modelPath: string): string {
    return `${issue.type}: ${issue.message} (${issue.path})`.replaceAll(modelPath, basename(modelPath));
  }
}
