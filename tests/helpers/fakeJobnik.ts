import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  return text === '' ? undefined : (JSON.parse(text) as unknown);
};

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export interface JobnikCalls {
  job?: { name: string; data: Record<string, unknown> };
  stages: string[];
  tasks: { stageId: string; data: Record<string, unknown> }[];
}

export interface FakeJobnik {
  url: string;
  calls: JobnikCalls;
  reset: (inFlightJobs?: unknown[]) => void;
  close: () => Promise<void>;
}

export const startFakeJobnik = async (): Promise<FakeJobnik> => {
  let calls: JobnikCalls = { stages: [], tasks: [] };
  let inFlight: unknown[] = [];
  const stageTypes = new Map<string, string>();

  const server: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      const body = await readBody(req);
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const stageMatch = /^\/v1\/stages\/(stage-\d+)(\/tasks)?$/.exec(path);

      if (req.method === 'GET' && path === '/v1/jobs') {
        return send(res, HTTP_OK, { items: inFlight });
      }
      if (req.method === 'POST' && path === '/v1/jobs') {
        calls.job = body as JobnikCalls['job'];
        return send(res, HTTP_CREATED, { id: 'job-1', status: 'PENDING', ...(body as object) });
      }
      if (req.method === 'GET' && path === '/v1/jobs/job-1') {
        return send(res, HTTP_OK, { id: 'job-1', status: 'PENDING' });
      }
      if (req.method === 'POST' && path === '/v1/jobs/job-1/stage') {
        const { type } = body as { type: string };
        calls.stages.push(type);
        const id = `stage-${calls.stages.length}`;
        stageTypes.set(id, type);
        return send(res, HTTP_CREATED, { id, type, status: 'CREATED' });
      }
      if (req.method === 'GET' && stageMatch && stageMatch[2] === undefined) {
        const id = stageMatch[1] as string;
        return send(res, HTTP_OK, { id, type: stageTypes.get(id), status: 'CREATED' });
      }
      if (req.method === 'POST' && stageMatch?.[2] !== undefined) {
        for (const task of body as { data: Record<string, unknown> }[]) {
          calls.tasks.push({ stageId: stageMatch[1] as string, data: task.data });
        }
        return send(res, HTTP_CREATED, []);
      }
      send(res, HTTP_NOT_FOUND, { message: `unexpected ${req.method} ${path}` });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const fake: FakeJobnik = {
    url: `http://127.0.0.1:${port}`,
    calls,
    reset: (inFlightJobs: unknown[] = []): void => {
      calls = { stages: [], tasks: [] };
      fake.calls = calls;
      inFlight = inFlightJobs;
      stageTypes.clear();
    },
    close: async (): Promise<void> => new Promise((resolve) => server.close(() => resolve())),
  };
  return fake;
};
