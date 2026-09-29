import type { FactoryFunction } from 'tsyringe';
import { SERVICES } from '@common/constants';
import type { ConfigType } from '@common/config';
import { NFSProvider } from './nfsProvider';
import { S3Provider } from './s3Provider';
import type { Provider } from './interfaces';

export const providerFactory: FactoryFunction<Provider> = (dependencyContainer) => {
  const config = dependencyContainer.resolve<ConfigType>(SERVICES.CONFIG);
  return config.get('provider') === 'S3' ? dependencyContainer.resolve(S3Provider) : dependencyContainer.resolve(NFSProvider);
};
