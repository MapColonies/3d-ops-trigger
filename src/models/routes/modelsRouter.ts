import { Router } from 'express';
import type { FactoryFunction } from 'tsyringe';
import { ModelsController } from '../controllers/modelsController';

const modelsRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(ModelsController);

  router.post('/validate', controller.validateModel);
  router.get('/canDelete/:recordId', controller.canDeleteModel);

  return router;
};

export const MODELS_ROUTER_SYMBOL = Symbol('modelsRouterFactory');

export { modelsRouterFactory };
