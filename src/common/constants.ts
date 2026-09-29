import { readPackageJsonSync } from '@map-colonies/read-pkg';
import type { Job } from '@map-colonies/jobnik-sdk';

export const SERVICE_NAME = readPackageJsonSync().name ?? 'unknown_service';
export const DEFAULT_SERVER_PORT = 80;

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/];

export const DOMAIN = '3D';

/* eslint-disable @typescript-eslint/naming-convention */
export const STAGE_TYPES = {
  DATA_EXTRACTION: 'data-extraction',
  VALIDATION: 'validation',
  CREATE_UPLOAD_MODEL_TASKS: 'create-upload-model-tasks',
  UPLOAD_MODEL_DATA: 'upload-model-data',
  CLEAR_DATA: 'clear-data',
  UPLOAD_MODEL_PARTS: 'upload-model-parts',
  INGESTION_FINALIZER: 'ingestion-finalizer',
} satisfies Record<string, string>;
/* eslint-enable @typescript-eslint/naming-convention */

export const IN_FLIGHT_JOB_STATUSES: readonly Job['status'][] = ['PENDING', 'IN_PROGRESS', 'PAUSED', 'CREATED'];

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  TRACER: Symbol('Tracer'),
  METRICS: Symbol('METRICS'),
  PROVIDER: Symbol('Provider'),
} satisfies Record<string, symbol>;
/* eslint-enable @typescript-eslint/naming-convention */
