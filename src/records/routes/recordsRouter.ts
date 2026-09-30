import { Router } from 'express';
import type { FactoryFunction } from 'tsyringe';
import { RecordsController } from '../controllers/recordsController';

const recordsRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(RecordsController);

  router.post('/', controller.createRecord);
  router.post('/validate', controller.validateRecord);
  router.get('/canDelete/:recordId', controller.canDeleteRecord);
  router.delete('/:recordId', controller.deleteRecord);

  return router;
};

export const RECORDS_ROUTER_SYMBOL = Symbol('recordsRouterFactory');

export { recordsRouterFactory };
