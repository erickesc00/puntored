# PuntoRed Payment References Portal

Internal full-stack portal for creating, finding, reviewing, and cancelling payment references allocated by an external provider. The provider can later report asynchronous state changes without allowing duplicate events or competing transitions to corrupt terminal state.

## Table of contents

- [PuntoRed Payment References Portal](#puntored-payment-references-portal)
  - [Table of contents](#table-of-contents)
  - [Quick start](#quick-start)
    - [Demo data](#demo-data)
  - [Demo path](#demo-path)
  - [Project structure](#project-structure)
  - [API contract](#api-contract)
  - [Verification](#verification)
    - [Canonical checks](#canonical-checks)
    - [Browser E2E](#browser-e2e)
    - [Test ownership](#test-ownership)
  - [Technical decisions](#technical-decisions)
  - [Assumptions and boundaries](#assumptions-and-boundaries)
  - [Risks and conscious debt](#risks-and-conscious-debt)
  - [AI usage](#ai-usage)
  - [Next priorities](#next-priorities)

## Quick start

Prerequisites: Docker with Docker Compose. Node.js 22 is required only for commands run outside containers.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
cp provider-stub/.env.example provider-stub/.env
docker compose up --build
```

Compose starts MySQL and the provider stub first, then runs Prisma generation, migrations, and the reproducible seed before starting the backend and frontend.

| Surface | URL |
|---|---|
| Portal | <http://localhost:3001> |
| API health | <http://localhost:3000/api/health> |
| Swagger UI | <http://localhost:3000/api/docs> |
| Prometheus metrics | <http://localhost:3000/api/metrics> |
| Provider health | <http://localhost:3002/health> |
| Provider operator UI | <http://localhost:3002/operator> |

Stop the environment with `docker compose down`. Add `--volumes` only when you intentionally want to delete the MySQL and provider-stub data.

### Demo data

| Role | Username | Password |
|---|---|---|
| Operator | `operator` | `Puntored123!` |
| Supervisor | `supervisor` | `Puntored123!` |

The seed also creates one reference in each state: `DEMO-PENDING-001`, `DEMO-PAID-001`, `DEMO-CANCELLED-001`, and `DEMO-EXPIRED-001`.

## Demo path

1. Sign in as `operator` and create a reference. The response includes the provider-allocated `externalReference`.
2. Find the reference in the URL-driven, cursor-paginated list and open its detail and audit history.
3. Open the [provider operator UI](http://localhost:3002/operator) and send a `PAID` callback; reload the portal detail to see the transition and audit event.
4. Use the provider operator UI create form to create a provider-originated reference by sending an `externalReference` directly to the backend; verify that the stub stores the backend mapping and can later trigger callbacks for that reference.
5. Create another reference, sign in as `supervisor`, and cancel it from its detail page.
6. Attempt an invalid or competing terminal transition to observe the `409` conflict response without an invalid persisted state.

To inspect HTTP behavior directly, use the [Swagger UI](http://localhost:3000/api/docs) or the versioned [`backend/openapi.yaml`](backend/openapi.yaml). Creating a reference requires an `Idempotency-Key` header; cancellation requires the current `version` from the reference response.

## Project structure

| Path | Purpose |
|---|---|
| [`backend/`](backend) | NestJS API, domain/application layers, Prisma schema and migrations, OpenAPI, and backend tests |
| [`frontend/`](frontend) | Next.js portal and Vitest/Testing Library tests |
| [`provider-stub/`](provider-stub) | Fastify and SQLite simulation of allocation and callbacks |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Backend, frontend, provider-stub, and API-contract checks |
| [`docker-compose.yml`](docker-compose.yml) | Canonical local orchestration and persistent volumes |

## API contract

- Canonical versioned contract: [`backend/openapi.yaml`](backend/openapi.yaml)
- Interactive local documentation: <http://localhost:3000/api/docs>
- Generated frontend types: [`frontend/src/lib/api/generated-types.d.ts`](frontend/src/lib/api/generated-types.d.ts)

Regenerate and verify contract artifacts:

```bash
cd backend
npm ci
npm run openapi:export

cd ../frontend
npm ci
npm run openapi:types
```

CI fails when either generated artifact differs from the committed version. The current OpenAPI document describes successful payloads well but does not yet enumerate every normalized `4xx`/`5xx` response.

## Verification

### Canonical checks

Backend integration/E2E tests require MySQL on `127.0.0.1:33060`; the Compose `mysql` service provides it.

```bash
docker compose up -d mysql

cd backend
npm ci
npm run prisma:generate
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

```bash
cd provider-stub
npm ci
npm run typecheck
npm run test
npm run build
```

### Browser E2E

With the full Compose environment running:

```bash
cd frontend
npm ci
npx playwright install chromium
npm run test:e2e
```

The local Playwright flows exercise operator creation through supervisor cancellation and provider-driven payment in Chromium. They depend on a separately running Compose environment, are not part of [`.github/workflows/ci.yml`](.github/workflows/ci.yml), and are currently untracked files that must be added before browser E2E can count as delivered repository evidence.

### Test ownership

| Layer | Main evidence |
|---|---|
| Domain/unit | transition, expiration, idempotency, validation, mapping, and navigation policies in colocated `*.spec.ts` / `*.test.ts(x)` files |
| Persistence/API | real Prisma + MySQL suites in [`backend/test/references.e2e-spec.ts`](backend/test/references.e2e-spec.ts) and [`backend/test/provider-events.e2e-spec.ts`](backend/test/provider-events.e2e-spec.ts) |
| Auth/API | cookie lifecycle in [`backend/test/auth.e2e-spec.ts`](backend/test/auth.e2e-spec.ts) and session guard tests |
| Frontend | Vitest + Testing Library tests beside features and shared session/API behavior |
| Full browser | Local Playwright flows in [`frontend/e2e`](frontend/e2e); currently untracked and outside CI |
| Provider stub | Node test runner against temporary SQLite databases in [`provider-stub/test`](provider-stub/test) |

## Technical decisions

| Decision | Rationale | Trade-off |
|---|---|---|
| Layered modular monolith with ports and adapters at key seams | Separates HTTP, workflow, domain rules, and infrastructure while remaining proportional to a five-day challenge. | Framework and persistence types still appear at some module boundaries, so architectural discipline is not compiler-enforced. |
| Prisma + MySQL | Supplies relational constraints, transactions, reproducible migrations, and typed access with low setup cost. | Couples persistence adapters to Prisma conventions and gives less query-level control than a query builder or raw SQL. |
| Database-backed cookie sessions | Supports server-side expiry, revocation, logout, and role lookup without exposing a bearer token to browser JavaScript. | Adds a database lookup/refresh per protected request and assumes same-origin deployment for the current CSRF posture. |
| Integer minor units with an explicit currency allowlist | Avoids binary floating-point errors and keeps API/UI validation consistent for `COP`, `MXN`, `USD`, and `EUR`. | The model assumes two fractional digits in presentation and therefore does not generalize to zero- or three-decimal currencies. |
| Relational idempotency plus optimistic concurrency | Internal portal creates use actor-scoped idempotency keys, while provider-originated creates use normalized `externalReference` replay/conflict semantics; `version` predicates let one terminal transition win atomically across cancellation, provider events, and expiration. | Avoids another datastore, but adds retention, index growth, and contention concerns to MySQL while requiring two clearly separated replay strategies. |

## Assumptions and boundaries

- New references begin as `PENDING`; `PAID`, `CANCELLED`, and `EXPIRED` are terminal.
- All persisted timestamps and list date boundaries use UTC.
- Amounts cross API boundaries as positive integer minor units. Supported currencies are `COP`, `MXN`, `USD`, and `EUR`.
- Internal portal creates use actor-scoped `Idempotency-Key` headers. Provider-originated creates do not use `Idempotency-Key`; they rely on normalized `externalReference` replay/conflict semantics instead. Idempotency records store a 72-hour expiry timestamp, but expiry cleanup and enforcement are not implemented yet.
- The system supports two creation flows. Internal portal creates synchronously allocate an `externalReference` through the provider stub before the backend commit. Provider-originated creates are submitted by the provider stub directly to the backend with a caller-supplied `externalReference`, then persist the returned backend reference mapping locally for later callbacks.
- A contradictory provider event does not override a local terminal state. It is rejected and audited for later reconciliation.
- The frontend and API are deployed same-origin or behind a reverse proxy. Cross-origin cookie/CORS support is outside this delivery.
- Audit, provider-event, session, and idempotency retention policies require production requirements before implementation.

## Risks and conscious debt

- **Retention:** `expiresAt` is stored for idempotency records, but reads do not ignore expired rows and no cleanup job exists. Session cleanup is also access-driven; audit and provider events have no retention process.
- **Scale:** cursor pagination and compound ordering indexes are suitable foundations, but substring search on concept/external reference will not scale predictably to one million rows without a dedicated search strategy or revised indexes.
- **Security:** `SameSite=Lax`, same-origin routing, `httpOnly` cookies, Helmet, boundary validation, generic credential errors, and rate limits reduce risk, but there is no explicit CSRF token or Origin/Referer validation. Production secrets, TLS, cookie `Secure`, proxy trust, and distributed rate-limit storage remain deployment work.
- **Exposed local surfaces:** metrics and the provider operator routes are unauthenticated. They are useful for local assessment but must be network-restricted or protected before production use.
- **Audit coverage:** reference creation, cancellation attempts/results, expiration, and provider events are audited. Login/logout and read access have metrics/logs but no durable audit records, so "every sensitive operation" is only partially satisfied.
- **Provider reconciliation:** contradictory terminal events are rejected and recorded; no queue, dead-letter flow, cryptographic request signature, replay window, or reconciliation workflow exists.
- **Testing:** backend risk paths have real MySQL coverage, but the local Playwright files are untracked and not executed in CI. No load, multi-instance scheduler, security, or mobile-device browser suite is included.
- **Contract completeness:** OpenAPI drift is checked, but normalized error variants and the metrics endpoint are not fully represented.
- **Formatting:** CI runs lint and type checks, but there is no repository-wide format check; only the backend exposes a partial Prettier write command.
- **Repository hygiene:** `backend/package.json` currently contains duplicate dependency keys for Swagger/YAML packages; npm resolves the final values, but the manifest should be normalized.

## AI usage

- Tools: OpenCode
- Models: OpenAI GPT-5.4, GLM-5.2 models and deepseek v4 flash for implementation; GPT-5.6-sol for deep reasoning
- specification-driven development was used to organize the work.
- AI supported challenge analysis, implementation planning, code generation, tests, documentation, and requirement-gap review.
- Development followed these SDD phases across the backend and frontend workstreams:
  1. Initialization and spec context.
  2. Exploration and change proposal.
  3. Requirements specification.
  4. Technical design.
  5. Implementation task planning.
  6. Incremental implementation.
  7. Verification against the specification.
  8. Change archival and follow-up tracking.

## Next priorities

1. Move persisted sessions and idempotency keys to Redis with explicit TTLs, then define retention for audit and provider events.
2. Add registration API routes and a user-facing registration screen.
3. Protect operational/provider surfaces and add an explicit CSRF control suitable for the deployment topology.
4. Add Playwright to CI and cover session expiry, conflict recovery, and mobile viewports in a real browser.
5. Introduce provider reconciliation with authenticated signatures, replay protection, and recoverable delivery.
6. Validate list/search plans against a million-row dataset and choose indexed or dedicated full-text search accordingly.
