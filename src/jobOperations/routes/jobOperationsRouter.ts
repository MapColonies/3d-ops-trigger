import { Router } from 'express';
import type { FactoryFunction } from 'tsyringe';
import { JobOperationsController } from '../controllers/jobOperationsController';

const jobOperationsRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(JobOperationsController);

  router.post('/ingestion', controller.createIngestion);
  router.post('/delete', controller.createDelete);

  return router;
};

export const JOB_OPERATIONS_ROUTER_SYMBOL = Symbol('jobOperationsRouterFactory');

export { jobOperationsRouterFactory };
