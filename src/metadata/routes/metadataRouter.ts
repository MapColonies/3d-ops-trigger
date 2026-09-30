import { Router } from 'express';
import type { FactoryFunction } from 'tsyringe';
import { MetadataController } from '../controllers/metadataController';

const metadataRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(MetadataController);

  router.patch('/status/:identifier', controller.updateMetadataStatus);
  router.patch('/:identifier', controller.updateMetadata);

  return router;
};

export const METADATA_ROUTER_SYMBOL = Symbol('metadataRouterFactory');

export { metadataRouterFactory };
