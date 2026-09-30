import { Router } from 'express';
import type { FactoryFunction } from 'tsyringe';
import { JobController } from '../controllers/jobController';

const jobRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(JobController);

  router.get('/:jobId', controller.getJobStatus);

  return router;
};

export const JOB_ROUTER_SYMBOL = Symbol('jobRouterFactory');

export { jobRouterFactory };
