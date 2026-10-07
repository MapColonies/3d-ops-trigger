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
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    error: {
      message: string;
    };
    ingestionPayload: {
      /**
       * @description Full share path (must start with the configured base path) to the model inside the data/ folder - a tileset.json (3D Tiles) or a .3tz file
       * @example \\domtest\models\afula\data\tileset.json
       */
      modelPath: string;
      /**
       * @description Full share path (must start with the configured base path) to the footprint shapefile (shape/Product.shp). .shx, .dbf, .prj (WGS84) and .cpg (UTF-8) must sit next to it
       * @example \\domtest\models\afula\shape\Product.shp
       */
      productShapefilePath: string;
      /**
       * @description Full share path (must start with the configured base path) to the parts metadata shapefile (shape/ShapeMetadata.shp). .shx, .dbf, .prj (WGS84) and .cpg (UTF-8) must sit next to it
       * @example \\domtest\models\afula\shape\ShapeMetadata.shp
       */
      metadataShapefilePath: string;
      /** @enum {string} */
      productType:
        | '3DPhotoRealistic'
        | '3DPhotoRealisticBest'
        | '3DSemantic'
        | '3DSemanticMesh'
        | 'QuantizedMeshDTMBest'
        | 'QuantizedMeshDSMBest'
        | '3DPointCloud';
      productSubType?: string;
      description?: string;
      region: string[];
      classification: string;
      keywords?: string;
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
  };
  responses: never;
  parameters: {
    /** @description The record identifier */
    recordId: string;
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
      /** @description An external service (lookup-tables / catalog) failed */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['error'];
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
}
export type TypedRequestHandlers = ImportedTypedRequestHandlers<paths, operations>;
