import { type ConfigInstance, config } from '@map-colonies/config';
import { commonBoilerplateV3, type commonBoilerplateV3Type } from '@map-colonies/schemas';

interface LookupTablesConfig {
  url: string;
  subUrl: string;
}

interface PathsConfig {
  basePath: string;
  pvPath: string;
}

interface ProductReaderConfig {
  maxVerticesPerChunk: number;
}

interface ValidationConfig {
  intersectionPercentageLimit: number;
}

interface JobManagerConfig {
  url: string;
  ingestion: {
    jobType: string;
    taskType: string;
    batches: number;
  };
  delete: {
    jobType: string;
    taskType: string;
  };
}

interface ExternalServicesConfig {
  catalogUrl: string;
  extractableUrl: string;
  lookupTables: LookupTablesConfig;
}

type OpsTriggerConfigType = commonBoilerplateV3Type & {
  externalServices: ExternalServicesConfig;
  paths: PathsConfig;
  productReader: ProductReaderConfig;
  validation: ValidationConfig;
  jobManager: JobManagerConfig;
};

type ConfigType = ConfigInstance<OpsTriggerConfigType>;

const opsTriggerConfigSchema = {
  $id: 'https://mapcolonies.com/3d/opsTrigger/v1',
  type: 'object',
  allOf: [
    { $ref: commonBoilerplateV3.$id },
    {
      type: 'object',
      required: ['externalServices', 'paths', 'productReader', 'validation', 'jobManager'],
      properties: {
        paths: {
          type: 'object',
          required: ['basePath', 'pvPath'],
          properties: {
            basePath: { type: 'string', minLength: 1 },
            pvPath: { type: 'string', minLength: 1 },
          },
        },
        validation: {
          type: 'object',
          required: ['intersectionPercentageLimit'],
          properties: {
            intersectionPercentageLimit: { type: 'number', minimum: 0, maximum: 100 },
          },
        },
        productReader: {
          type: 'object',
          required: ['maxVerticesPerChunk'],
          properties: {
            maxVerticesPerChunk: { type: 'integer', minimum: 1 },
          },
        },
        jobManager: {
          type: 'object',
          required: ['url', 'ingestion', 'delete'],
          properties: {
            url: { type: 'string' },
            ingestion: {
              type: 'object',
              required: ['jobType'],
              properties: {
                jobType: { type: 'string' },
                taskType: { type: 'string' },
                batches: { type: 'number' },
              },
            },
            delete: {
              type: 'object',
              required: ['jobType'],
              properties: {
                jobType: { type: 'string' },
                taskType: { type: 'string' },
              },
            },
          },
        },
        externalServices: {
          type: 'object',
          required: ['catalogUrl', 'extractableUrl', 'lookupTables'],
          properties: {
            extractableUrl: { type: 'string' },
            lookupTables: {
              type: 'object',
              required: ['url', 'subUrl'],
              properties: {
                url: { type: 'string' },
                subUrl: { type: 'string' },
              },
            },
            catalogUrl: { type: 'string' },
          },
        },
      },
    },
  ],
};

let configInstance: ConfigType | undefined;

async function initConfig(offlineMode?: boolean): Promise<void> {
  configInstance = (await config({
    schema: opsTriggerConfigSchema as unknown as typeof commonBoilerplateV3,
    offlineMode,
  })) as unknown as ConfigType;
}

function getConfig(): ConfigType {
  if (!configInstance) {
    throw new Error('config not initialized');
  }
  return configInstance;
}

export { getConfig, initConfig };
export type { ConfigType, JobManagerConfig, LookupTablesConfig, ExternalServicesConfig, PathsConfig, ProductReaderConfig, ValidationConfig };
