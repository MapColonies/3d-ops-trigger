import { type ConfigInstance, config } from '@map-colonies/config';
import { commonBoilerplateV3, type commonBoilerplateV3Type } from '@map-colonies/schemas';

interface LookupTablesConfig {
  url: string;
  subUrl: string;
}

interface ExternalServicesConfig {
  lookupTables: LookupTablesConfig;
  catalog: string;
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

interface ValidationConfig {
  percentageLimit: number;
}

interface NFSConfig {
  pvPath: string;
}

interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpointUrl: string;
  bucket: string;
  region: string;
  forcePathStyle: boolean;
  sslEnabled: boolean;
  maxAttempts: number;
}

type ProviderSource = 'NFS' | 'S3';

type OpsTriggerConfigType = commonBoilerplateV3Type & {
  externalServices: ExternalServicesConfig;
  jobManager: JobManagerConfig;
  validation: ValidationConfig;
  provider: ProviderSource;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  NFS: NFSConfig;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  S3: S3Config;
};

type ConfigType = ConfigInstance<OpsTriggerConfigType>;

const opsTriggerConfigSchema = {
  $id: 'https://mapcolonies.com/3d/opsTrigger/v1',
  type: 'object',
  allOf: [
    { $ref: commonBoilerplateV3.$id },
    {
      type: 'object',
      required: ['externalServices', 'jobManager', 'validation', 'provider'],
      properties: {
        provider: { type: 'string', enum: ['NFS', 'S3'] },
        validation: {
          type: 'object',
          required: ['percentageLimit'],
          properties: {
            percentageLimit: { type: 'number' },
          },
        },
        // eslint-disable-next-line @typescript-eslint/naming-convention
        NFS: {
          type: 'object',
          required: ['pvPath'],
          properties: { pvPath: { type: 'string' } },
        },
        // eslint-disable-next-line @typescript-eslint/naming-convention
        S3: {
          type: 'object',
          required: ['accessKeyId', 'secretAccessKey', 'endpointUrl', 'bucket', 'region', 'forcePathStyle', 'sslEnabled', 'maxAttempts'],
          properties: {
            accessKeyId: { type: 'string' },
            secretAccessKey: { type: 'string' },
            endpointUrl: { type: 'string' },
            bucket: { type: 'string' },
            region: { type: 'string' },
            forcePathStyle: { type: 'boolean' },
            sslEnabled: { type: 'boolean' },
            maxAttempts: { type: 'number' },
          },
        },
        externalServices: {
          type: 'object',
          required: ['lookupTables', 'catalog'],
          properties: {
            lookupTables: {
              type: 'object',
              required: ['url', 'subUrl'],
              properties: {
                url: { type: 'string' },
                subUrl: { type: 'string' },
              },
            },
            catalog: { type: 'string' },
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
export type { ConfigType, LookupTablesConfig, ExternalServicesConfig, JobManagerConfig, ValidationConfig, NFSConfig, S3Config, ProviderSource };
