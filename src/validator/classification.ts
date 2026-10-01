import type { Logger } from '@map-colonies/js-logger';
import { StatusCodes } from 'http-status-codes';
import type { LogContext } from '@common/interfaces';
import { AppError } from '@common/appError';
import type { LookupTablesCall } from '../externalServices/lookupTables/lookupTablesCall';

export const validateClassification = async (
  lookupTables: LookupTablesCall,
  logger: Logger,
  logContext: LogContext,
  classification: string
): Promise<void> => {
  const classifications = await lookupTables.getClassifications();
  logger.debug({ msg: 'classification validation', logContext, classifications });

  if (!classifications.includes(classification)) {
    throw new AppError(
      'badRequest',
      StatusCodes.BAD_REQUEST,
      `classification is not a valid value. Optional values: ${classifications.join()}`,
      true
    );
  }
};
