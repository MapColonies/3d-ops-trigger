/* eslint-disable */
// This file was auto-generated. Do not edit manually.
// To update, run the error generation script again.

import type { TypedRequestHandlers as ImportedTypedRequestHandlers } from '@map-colonies/openapi-express-types';
export type paths = {
  '/record': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Start an ingestion process flow
     * @description Validates the request (light & fast) and creates a Jobnik ingestion job.
     */
    post: operations['createRecord'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/record/validate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Validate an ingestion request without creating a job
     * @description Runs the full ingestion validation and returns the result without triggering a Jobnik job.
     */
    post: operations['validateRecord'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/record/canDelete/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Validate whether a record can be deleted
     * @description Runs the delete validation and returns the result without creating a job.
     */
    get: operations['canDeleteRecord'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/record/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Start a delete process flow
     * @description Validates the record can be deleted and creates a Jobnik delete job.
     */
    delete: operations['deleteRecord'];
    options?: never;
    head?: never;
    /** Update metadata for a record */
    patch: operations['updateRecord'];
    trace?: never;
  };
  '/record/status/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Update the publish/unpublish status of a record */
    patch: operations['updateRecordStatus'];
    trace?: never;
  };
  '/jobs/{jobId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get the status and progress of a job */
    get: operations['getJobStatus'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    error: {
      message: string;
    };
    ingestionPayload: {
      /** @description Path on the shared storage to the 3DTiles folder or 3TZ archive */
      modelPath: string;
      /** @description The tileset entry name (e.g. tileset.json) */
      tilesetFilename: string;
      /** @description 3D record metadata (business validation applied downstream) */
      metadata: {
        [key: string]: unknown;
      };
    };
    /** @description Partial metadata fields to update */
    updatePayload: {
      [key: string]: unknown;
    };
    statusPayload: {
      /** @enum {string} */
      status: 'PUBLISHED' | 'UNPUBLISHED';
    };
    jobResponse: {
      jobId: string;
      status: string;
    };
    ackResponse: {
      message: string;
    };
    jobStatusResponse: {
      status: string;
      percentage?: number;
    };
    validationResultResponse: {
      isValid: boolean;
      message?: string;
    };
  };
  responses: never;
  parameters: {
    /** @description The record identifier */
    recordId: string;
    /** @description The job identifier */
    jobId: string;
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
  createRecord: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ingestionPayload'];
      };
    };
    responses: {
      /** @description Ingestion job created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['jobResponse'];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['error'];
        };
      };
    };
  };
  validateRecord: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ingestionPayload'];
      };
    };
    responses: {
      /** @description Validation result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['validationResultResponse'];
        };
      };
    };
  };
  canDeleteRecord: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description The record identifier */
        id: components['parameters']['recordId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Validation result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['validationResultResponse'];
        };
      };
    };
  };
  deleteRecord: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description The record identifier */
        id: components['parameters']['recordId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Delete job created */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['jobResponse'];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['error'];
        };
      };
      /** @description Record not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['error'];
        };
      };
    };
  };
  updateRecord: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description The record identifier */
        id: components['parameters']['recordId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['updatePayload'];
      };
    };
    responses: {
      /** @description Metadata updated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ackResponse'];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['error'];
        };
      };
      /** @description Record not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['error'];
        };
      };
    };
  };
  updateRecordStatus: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description The record identifier */
        id: components['parameters']['recordId'];
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['statusPayload'];
      };
    };
    responses: {
      /** @description Status updated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ackResponse'];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['error'];
        };
      };
      /** @description Record not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['error'];
        };
      };
    };
  };
  getJobStatus: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description The job identifier */
        jobId: components['parameters']['jobId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Job status */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['jobStatusResponse'];
        };
      };
      /** @description Job not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['error'];
        };
      };
    };
  };
}
export type TypedRequestHandlers = ImportedTypedRequestHandlers<paths, operations>;
