# 3D Operations Trigger

----------------------------------

Entry point for 3D operations — **ingest, delete, update, publish/unpublish**. It validates incoming requests (light & fast) and triggers the corresponding [Jobnik](https://mapcolonies.github.io/infra-portal/docs/knowledge-base/jobnik) jobs. Successor to the legacy `3d-gateway` (and, in the near future, `store-trigger`).

> Epic: MAPCO-11833 · Design: [3D Ingestion High level architecture](https://mapcolonies.atlassian.net/wiki/spaces/MAPConflicResolution/pages/3342172161) · See [docs/PRD.md](./docs/PRD.md)

## API

| Endpoint | Method | Summary |
| --- | --- | --- |
| `/record` | POST | Start an ingestion flow (validate, create Jobnik ingestion job) |
| `/record/{id}` | DELETE | Validate deletability, create Jobnik delete job |
| `/record/{id}` | PATCH | Update metadata for a record |
| `/record/status/{id}` | PATCH | Publish / unpublish a record |

Full OpenAPI spec: [openapi3.yaml](/openapi3.yaml). Regenerate types on spec change with `npm run generate:openapi-types`.

## Requirements

- **Node.js ≥ 24** (required by `@map-colonies/jobnik-sdk`). Use the pinned version via `nvm use`.

## Installation

```bash
npm install
```

> During development this service consumes `@map-colonies/3d-shared` (and, later, mc-models v2) via local `file:` links until those packages are published to npm.

## Run Locally

```bash
npm run start        # build + run
npm run start:dev    # offline config + source maps
```

## Running Tests

```bash
npm run test              # all
npm run test:unit         # unit only
npm run test:integration  # integration only
```

## Development notes

- eslint / prettier via `@map-colonies/eslint-config` and `@map-colonies/prettier-config`
- vitest for tests
- OpenAPI request validation at the middleware layer
- config via [node-config](https://www.npmjs.com/package/node-config)
- tracing & metrics via `@map-colonies/telemetry`
