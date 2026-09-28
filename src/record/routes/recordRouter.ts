import { Router } from 'express';
import type { FactoryFunction } from 'tsyringe';
import { RecordController } from '../controllers/recordController';

const recordRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(RecordController);

  router.post('/', controller.createRecord);
  router.patch('/status/:id', controller.updateRecordStatus);
  router.delete('/:id', controller.deleteRecord);
  router.patch('/:id', controller.updateRecord);

  return router;
};

export const RECORD_ROUTER_SYMBOL = Symbol('recordRouterFactory');

export { recordRouterFactory };
