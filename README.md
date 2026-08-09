# PuntoRed Payment References Portal

Internal full-stack portal to create, review, and cancel payment references backed by an external provider with asynchronous status updates.

## Quick start

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
cp provider-stub/.env.example provider-stub/.env
docker compose up --build
```

After startup:

- Frontend: `http://localhost:3001`
- Backend health: `http://localhost:3000/api/health`
- Backend metrics: `http://localhost:3000/api/metrics`
- Provider stub health: `http://localhost:3002/health`
- Provider stub operator UI: `http://localhost:3002/operator`
- Same-origin frontend proxy: `http://localhost:3001/api/health`

## Main flow walkthrough

1. Sign in with an internal user.
2. Create a payment reference.
3. Confirm the response already contains a persisted `externalReference`.
4. Retry the same request with the same idempotency key and get the original result instead of a duplicate record.
5. Open the reference detail and review its audit history.
6. Browse references with pagination, status filters, date range filters, and search.
7. Cancel the reference as a `SUPERVISOR` only when the current state still allows it.
8. Process duplicate or contradictory provider events without corrupting terminal state.
9. If the session expires on a protected route, the frontend clears local state and redirects back to `/login` with `returnTo` when applicable.

## Demo credentials and fixtures

### Users

- `operator` / `Puntored123!`
- `supervisor` / `Puntored123!`

### Seeded references

| Status | External reference | Suggested use |
|---|---|---|
| `PENDING` | `DEMO-PENDING-001` | basic review flow |
| `PAID` | `DEMO-PAID-001` | provider callback evidence |
| `CANCELLED` | `DEMO-CANCELLED-001` | supervisor cancellation evidence |
| `EXPIRED` | `DEMO-EXPIRED-001` | expired terminal-state demo |

## Installation, execution, and tests

### Canonical local runtime

The repository is designed to run from the repo root with Docker Compose.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
cp provider-stub/.env.example provider-stub/.env
docker compose up --build
```

Startup order:

`mysql` + healthy `provider-stub` -> `backend-init` (`prisma generate` + migrations + seed) -> healthy `backend` -> `frontend`

### Backend-only runtime

Use this only if you need to debug the API in isolation.

```bash
cd backend
cp .env.example .env
docker compose up -d mysql
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

### Frontend local commands

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
npm run test
npm run lint
npm run typecheck
npm run build
```

Development default:

- `BACKEND_ORIGIN=http://localhost:3000`

### Provider stub local commands

```bash
cd provider-stub
npm install
cp .env.example .env
npm run dev
npm run test
npm run typecheck
npm run build
```

Useful stub surfaces:

- `GET /operator` serves a minimal operator page to inspect provider references and trigger `PAID` / `CANCELLED` callbacks.

- `POST /external-references` with header `x-stub-api-key`
- `GET /external-references?status=&backendReferenceId=` with header `x-stub-api-key`
- `POST /external-references/:backendReferenceId/callback` with header `x-stub-api-key` and body `{ "status": "PAID" | "CANCELLED" }`

### Canonical verification commands

#### Backend

```bash
cd backend
npm ci
npm run prisma:generate
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

#### Frontend

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

#### Provider stub

```bash
cd provider-stub
npm ci
npm run typecheck
npm run test
npm run build
```

#### CI evidence

- Minimal CI workflow: `.github/workflows/ci.yml`
- Reproducible demo data: `backend/prisma/seed.ts`

## Scope delivered in this repository

### Backend

- NestJS API in TypeScript.
- Relational persistence with Prisma + MySQL and reproducible migrations.
- Role-based authentication and authorization for `OPERATOR` and `SUPERVISOR`.
- Idempotent reference creation.
- Paginated list with status, date range, and search filters.
- Reference detail with audit/history.
- State-aware cancellation with concurrency control.
- Provider-backed external reference allocation plus notification ingestion/simulation.
- Health endpoint and basic metrics.

### Frontend

- Next.js App Router frontend in TypeScript.
- Login/logout with session bootstrap through `/auth/me`.
- Protected same-origin API access through `/api/*` proxying.
- Paginated list with URL-driven filters and navigation state.
- Reference creation with client-side validation and idempotency intent reuse.
- Detail/history view and supervisor-only cancellation with conflict recovery.
- Loading, empty, success, and error states for the main flows.

## Technical decisions


| Topic | Context | Options considered | Decision | Consequences |
|---|---|---|---|---|
| Architecture | The challenge requires separation of transport, use-case orchestration, and infrastructure without overengineering. | Tight controller/component logic vs. layered modular monolith vs. heavier hexagonal split. | Use a layered modular monolith. | Trade-off: this structure makes easier to separate responsabilities, but it is less explicit than a full ports-and-adapters design and still requires discipline to keep business rules out of controllers and framework-specific code. |
| Persistence | The system needs relational storage, reproducible migrations, and strong TypeScript ergonomics inside NestJS. | TypeORM + MySQL vs. Prisma + MySQL vs. raw SQL/query builder. | Use Prisma + MySQL. | Trade-off: Prisma gives faster typed modeling and a straightforward migration flow, but it moves away from the most common NestJS default (`TypeORM`) and requires accepting Prisma-specific patterns instead of repository abstractions baked around TypeORM. [Prisma vs TypeORM](https://www.prisma.io/docs/orm/more/comparisons/prisma-and-typeorm) |
| Authentication | The app is internal and needs role-based authorization plus safe session expiration. | Browser-stored JWT vs. backend session cookie. | Use server-side sessions with secure `httpOnly` cookies. | Easier logout/revocation and less token exposure in the browser, but requires session persistence and careful cookie configuration. |
| Money modeling | The challenge explicitly forbids precision errors in monetary amounts. | Floating-point amounts vs. decimal strings vs. minor units. | Store `amount` in minor units plus mandatory `currency`. | Avoids floating-point bugs and makes validation rules explicit at API and UI boundaries. |
| Concurrency and idempotency | Idempotent creation is a hard requirement, and cancel-vs-paid races are a core risk area. The design decision was how to transport and persist the idempotency key while keeping the solution operable. | Idempotency key in request body vs. idempotency key in request header, combined with persistence in Redis vs. persistence in the relational database. | Use the `Idempotency-Key` request header, persist the key in a dedicated database table, and use `version` + transactions for state changes. | Trade-off: this keeps the contract explicit, auditable, and self-contained in the main datastore, but sacrifices the maximum throughput and low-latency profile a Redis-based strategy could provide and adds indexing/retention concerns to the relational layer. |

## Assumptions and controlled open questions

### Assumptions

- Every locally created reference starts as `PENDING`.
- Terminal states are `PAID`, `CANCELLED`, and `EXPIRED`.
- Terminal transitions are only valid from `PENDING`.
- All timestamps are handled in UTC.
- Pagination must remain stable and deterministic for large datasets.
- The frontend runs same-origin or behind a reverse proxy so cookie-based auth works without a separate cross-origin auth design.
- Provider notifications use a simple authenticated mechanism such as a shared secret.

## Risks and conscious debt

- Session-based authentication is safer for this use case, but it increases persistence and cookie management complexity.
- Contradictory provider events are rejected and audited so it is not a full reconciliation strategy.
- The frontend depends on same-origin or reverse proxy deployment assumptions; cross-origin auth/CORS is intentionally out of scope.
- Frontend runtime evidence uses Vitest + Testing Library rather than a browser-driven external E2E tool such as Playwright.

## Testing strategy

| Layer | What it validates |
|---|---|
| Unit | transition rules, cancellation eligibility, expiration logic, idempotency normalization |
| Integration | Prisma/MySQL persistence, constraints/indexes, authorization, duplicates, cancel-vs-paid race handling |
| E2E/runtime | highest-risk flow: login -> create -> safe retry -> list/detail -> valid cancel or conflict |

Also covered explicitly:

- duplicate requests,
- invalid transitions,
- session-loss handling,
- stale version/conflict recovery in the UI.

## API contract and supporting evidence

### Canonical API contract

No standalone exported API collection is versioned in this repository right now. The canonical local contract is the running backend plus the endpoint list and verification commands documented in this README.

### Main endpoints currently available

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/references`
- `POST /api/references`
- `GET /api/references/:id`
- `POST /api/references/:id/cancel`
- `GET /api/health`
- `GET /api/metrics`

## AI usage summary

* **Agent**: OpenCode
* **Models**: OpenAI GPT5.4, GLM5.2
* **Strategy**: SDD

- AI was used to support challenge analysis, SDD planning, documentation refinement, gap review between requirements and implementation, and guided execution.
- Architecture choices, scope decisions, trade-offs, and simplifications were explicitly reviewed and owned by the developer.
- Everything delivered in this repository must remain explainable, debuggable, and modifiable without relying on generated output.

## Next priorities

If a second iteration were available, the priorities would be:

1. Strengthen provider reconciliation beyond the current reject-and-audit MVP rule.
2. Expand operational observability with richer business metrics and alerting thresholds.
3. Increase browser-level end-to-end coverage for the highest-risk flows.
4. Harden rate limiting and abuse protections with more production-oriented policies.
5. Revisit search breadth, audit retention, and scaling indexes with production traffic assumptions.
