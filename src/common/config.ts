import { type ConfigInstance, config } from '@map-colonies/config';
import { commonBoilerplateV3, type commonBoilerplateV3Type } from '@map-colonies/schemas';

interface LookupTablesConfig {
  url: string;
  subUrl: string;
}

interface ExternalServicesConfig {
  catalog: string;
  extractable: string;
  lookupTables: LookupTablesConfig;
}

type OpsTriggerConfigType = commonBoilerplateV3Type & { externalServices: ExternalServicesConfig };

type ConfigType = ConfigInstance<OpsTriggerConfigType>;

const opsTriggerConfigSchema = {
  $id: 'https://mapcolonies.com/3d/opsTrigger/v1',
  type: 'object',
  allOf: [
    { $ref: commonBoilerplateV3.$id },
    {
      type: 'object',
      required: ['externalServices'],
      properties: {
        externalServices: {
          type: 'object',
          required: ['catalog', 'extractable', 'lookupTables'],
          properties: {
            extractable: { type: 'string' },
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
export type { ConfigType, LookupTablesConfig, ExternalServicesConfig };
