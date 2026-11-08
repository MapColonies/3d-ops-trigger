import { basename } from 'node:path';
import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { ValidationIssueSeverity, ValidationOptions, Validators, type ValidationIssue } from '3d-tiles-validator';
import { AppError, type LogContext } from '@map-colonies/3d-shared';
import { SERVICES } from '@common/constants';

const MAX_REPORTED_ISSUES = 3;

interface IssueDetails {
  type: string;
  message: string;
  path: string;
}

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
    const fileName = basename(modelPath);
    this.logger.info({ msg: 'validating tileset with 3d-tiles-validator', logContext, modelPath });

    let issues: readonly ValidationIssue[];
    try {
      ({ issues } = await Validators.validateTilesetFile(modelPath, this.validationOptions));
    } catch (err) {
      const message = `${ERROR_TILESET_VALIDATION_FAILED} for ${fileName}: the validator could not read the file`;
      this.logger.error({ msg: message, logContext, modelPath, err });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
    }

    const errors = this.toDetails(issues, ValidationIssueSeverity.ERROR, modelPath);
    const warnings = this.toDetails(issues, ValidationIssueSeverity.WARNING, modelPath);
    if (warnings.length > 0) {
      this.logger.warn({ msg: 'tileset validation warnings', logContext, modelPath, warnings });
    }
    if (errors.length > 0) {
      const problems = this.summarize(errors);
      const reported = problems.slice(0, MAX_REPORTED_ISSUES).join('; ');
      const hidden = problems.length - MAX_REPORTED_ISSUES;

      const message = `${ERROR_TILESET_VALIDATION_FAILED} for ${fileName}: ${reported}${hidden > 0 ? `; and ${hidden} more` : ''}`;
      this.logger.error({ msg: message, logContext, modelPath, errorsCount: errors.length, errors });
      throw new AppError('badRequest', StatusCodes.BAD_REQUEST, message, true);
    }

    this.logger.info({ msg: 'tileset validated successfully', logContext, modelPath });
  }

  private toDetails(issues: readonly ValidationIssue[], severity: ValidationIssueSeverity, modelPath: string): IssueDetails[] {
    return issues
      .filter((issue) => issue.severity === severity)
      .map((issue) => ({
        type: issue.type,
        message: issue.message.replaceAll(modelPath, basename(modelPath)),
        path: issue.path === modelPath ? '' : issue.path.replaceAll(modelPath, basename(modelPath)),
      }))
      .sort((first, second) => first.path.localeCompare(second.path, undefined, { numeric: true }));
  }

  private summarize(errors: IssueDetails[]): string[] {
    const paths = new Map<string, string[]>();
    for (const { type, message, path } of errors) {
      const problem = `${type}: ${message}`;
      paths.set(problem, [...(paths.get(problem) ?? []), path]);
    }

    return [...paths].map(([problem, problemPaths]) => {
      const locations = problemPaths.filter((path) => path !== '');
      if (locations.length === 0) {
        return problem;
      }
      return locations.length === 1 ? `${problem} (at ${locations[0]})` : `${problem} (${locations.length} times, first at ${locations[0]})`;
    });
  }
}
