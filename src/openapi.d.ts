/* eslint-disable */
// This file was auto-generated. Do not edit manually.
// To update, run the error generation script again.

import type { TypedRequestHandlers as ImportedTypedRequestHandlers } from '@map-colonies/openapi-express-types';
export type paths = {
  '/jobOperations/ingestion': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Create a new ingestion job to invoke a new model ingestion flow
     * @description Validates the request (light & fast) and creates a Jobnik ingestion job.
     */
    post: operations['createIngestion'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/jobOperations/delete': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Create a new delete job to invoke a delete flow
     * @description Validates the record can be deleted and creates a Jobnik delete job.
     */
    post: operations['createDelete'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/jobStatus/{jobId}': {
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
  '/models/validate': {
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
    post: operations['validateModel'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/models/canDelete/{recordId}': {
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
    get: operations['canDeleteModel'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/metadata/{identifier}': {
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
    /** Update metadata of a model */
    patch: operations['updateMetadata'];
    trace?: never;
  };
  '/metadata/status/{identifier}': {
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
    /** Update the publish/unpublish status of a model */
    patch: operations['updateMetadataStatus'];
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
    deletePayload: {
      /** @description The record identifier to delete */
      id: string;
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
    identifier: string;
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
  createIngestion: {
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
  createDelete: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['deletePayload'];
      };
    };
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
  validateModel: {
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
  canDeleteModel: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description The record identifier */
        recordId: components['parameters']['recordId'];
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
  updateMetadata: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description The record identifier */
        identifier: components['parameters']['identifier'];
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
  updateMetadataStatus: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description The record identifier */
        identifier: components['parameters']['identifier'];
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
}
export type TypedRequestHandlers = ImportedTypedRequestHandlers<paths, operations>;
