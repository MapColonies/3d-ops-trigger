import type { NextFunction, Request, Response } from 'express';
import { jsLogger } from '@map-colonies/js-logger';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecordController } from '@src/record/controllers/recordController';
import type { RecordManager } from '@src/record/models/recordManager';

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

type ManagerMethod = 'createIngestion' | 'deleteRecord' | 'updateMetadata' | 'updateStatus';

const handlers: [keyof RecordController, ManagerMethod][] = [
  ['createRecord', 'createIngestion'],
  ['deleteRecord', 'deleteRecord'],
  ['updateRecord', 'updateMetadata'],
  ['updateRecordStatus', 'updateStatus'],
];

describe('RecordController', function () {
  let controller: RecordController;
  let manager: Record<ManagerMethod, ReturnType<typeof vi.fn>>;
  let res: Response;
  let next: NextFunction;

  const request = { params: { id: 'rec-1' }, body: {} } as unknown as Request;

  beforeEach(async function () {
    manager = {
      createIngestion: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'PENDING' }),
      deleteRecord: vi.fn().mockReturnValue({ jobId: 'job-2', status: 'PENDING' }),
      updateMetadata: vi.fn().mockReturnValue({ message: 'ok' }),
      updateStatus: vi.fn().mockReturnValue({ message: 'ok' }),
    };
    res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    next = vi.fn();
    controller = new RecordController(await jsLogger({ enabled: false }), manager as unknown as RecordManager);
  });

  it.each(handlers)('should respond with the manager result (%s)', async function (handlerName, managerMethod) {
    await (controller[handlerName] as unknown as Handler)(request, res, next);

    expect(manager[managerMethod]).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each(handlers)('should pass manager errors to next (%s)', async function (handlerName, managerMethod) {
    const error = new Error('boom');
    manager[managerMethod].mockImplementation(() => {
      throw error;
    });

    await (controller[handlerName] as unknown as Handler)(request, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
