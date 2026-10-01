import type { components } from '@openapi';

export type IngestionPayload = components['schemas']['ingestionPayload'];
export type UpdatePayload = components['schemas']['updatePayload'];
export type StatusPayload = components['schemas']['statusPayload'];
export type JobResponse = components['schemas']['jobResponse'];
export type AckResponse = components['schemas']['ackResponse'];
export type ValidationResultResponse = components['schemas']['validationResultResponse'];
export type JobStatusResponse = components['schemas']['jobStatusResponse'];

export interface IConfig {
  get: <T>(setting: string) => T;
  has: (setting: string) => boolean;
}

export interface LogContext {
  fileName: string;
  class: string;
  function?: string;
}

export interface ValidationResponse {
  isValid: boolean;
  message?: string;
}
