import type { GdalDate } from './interfaces';

const isGdalDate = (value: unknown): value is GdalDate =>
  typeof value === 'object' &&
  value !== null &&
  'year' in value &&
  'month' in value &&
  'day' in value &&
  [value.year, value.month, value.day].every((part) => Number.isInteger(part));

export const isEmpty = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

export const toUtcDate = (value: unknown): Date | undefined => {
  if (isGdalDate(value)) {
    const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
};
