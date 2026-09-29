# Contributing to Budgeteer

Thank you for your interest in contributing! This document covers how to get the project running locally, the checks a change must pass, and how to submit a PR. Architecture, data model and API reference: [`docs/architecture.md`](docs/architecture.md). Coding conventions: [`AGENTS.md`](AGENTS.md).

---

## Prerequisites

- **Docker** with Docker Compose (runs everything with one command)
- Or: **Node.js 22+** and **PostgreSQL 15+**

---

## Running locally with Docker

```bash
# 1. Optional: override defaults (admin login, demo data, …)
cp .env.example .env

# 2. Build and start Postgres, API and web from source
docker compose -f docker-compose.dev.yml up --build
```

The app is served at **http://localhost:7272** (the API is reached through nginx at `/api`). Default login: `admin@budgeteer.local` / `changeme123`, which you must change on first login.

Behind a TLS-intercepting proxy (e.g. a corporate gateway), set `EXTRA_CA_FILE` in `.env` to the proxy's root CA (PEM); it is only used while building the images.

### Demo data

Set `SEED_DEMO_DATA=true` in `.env` to create two demo households, four users and sample budgets on first boot. Demo login: `alice@demo.local` / `demo1234` (demo users must change their password on first login).

---

## Running locally without Docker

```bash
# Install dependencies (from the repo root — npm workspaces)
npm install

# A Postgres to develop against (or use your own and set DATABASE_URL in .env)
docker compose -f docker-compose.dev.yml up postgres -d

cp .env.example .env        # the API, Prisma CLI and seed all read the root .env
npm run db:generate          # generate the Prisma client
npm run db:migrate           # apply migrations
npm run db:seed              # admin user, default categories, optional demo data
npm run dev                  # API on :3001 and web on :5173 (Vite proxies /api to the API)
```

---

## Project structure

```
budgeteer/
├── apps/
│   ├── api/          Fastify + TypeScript + Prisma (routes/, lib/, plugins/)
│   └── web/          React + Vite + Tailwind + TanStack Query (pages/, components/, api/)
├── prisma/
│   ├── schema.prisma Data model
│   ├── migrations/   Committed migrations (a single baseline plus later changes)
│   └── seed.ts       Admin user, default categories, receipt training data, optional demo data
├── docker/           Dockerfiles, nginx config, entrypoint
├── deploy/           Compose files for running the published images
├── docs/             Architecture reference and review notes
└── docker-compose.dev.yml
```

---

## Checks

CI runs these on every pull request; run them before pushing:

```bash
npm run typecheck   # both apps, including API tests
npm run lint        # ESLint for the whole repo
npm run test        # Vitest (API)
npm run build       # API and web production builds
```

For UI changes, also try the change in the browser. For schema changes, add a migration (`npm run db:migrate -- --name <change>`); CI applies all migrations to an empty database and fails if they don't match `schema.prisma`.

Tests use [Vitest](https://vitest.dev/) and live next to the code (`apps/api/src/**/*.test.ts`). `cd apps/api && npm run test:watch` runs them in watch mode.

---

## Architecture decisions

| Decision | Choice | Reason |
|---|---|---|
| ORM | Prisma | Type-safe queries, straightforward schema evolution |
| Auth | JWT access token (15 min) + rotated refresh token (7 days) | Works well for a SPA; rotation with reuse detection limits stolen tokens |
| Schema changes | Prisma migrations (`prisma/migrations/`) | Reproducible fresh installs; CI checks migrations match the schema |
| Monorepo | npm workspaces | Keeps web and API together without extra tooling |
| Amounts | `Decimal` + stored `monthlyEquivalent` | Avoids floating-point errors; monthly amounts are computed once, on save |
| Deletes | Soft delete (`deletedAt`, `isActive`, `endDate`) | Financial data is never erased; deleted items can be restored from the trash |

---

## Branching & PR guidelines

- Branch off `main`, e.g. `feature/AUTH-001-user-login` or `fix/EXP-003-delete-expense`
- Keep PRs focused: one feature or fix per PR
- Add an entry to `CHANGELOG.md` under `[Unreleased]` describing what changed and why
- Update `docs/architecture.md` for new entities, endpoints, schema changes or stack changes
- PR title format: `feat: short description` / `fix: short description`

---

## Adding an API endpoint

1. Add the route to the relevant module in `apps/api/src/routes/` (register new modules in `apps/api/src/index.ts`)
2. Protect it with the `authenticate` preHandler (or `requireAdmin` for system-admin routes)
3. Check household access with the helpers in `apps/api/src/lib/ownership.ts` (`assertHouseholdAccess`, `assertBudgetYearAccess`, `getActiveMembership`)
4. Validate request bodies (and query strings) with Zod
5. Store amounts as `Decimal`; compute stored monthly amounts with `calcMonthlyInBase()` from `lib/calculations.ts`
6. Return errors as `{ error, code? }`; unexpected errors are handled by the global error handler
7. List the endpoint in `docs/architecture.md`

---

## Environment variables

See [`.env.example`](.env.example) and the table in the [README](README.md#configuration). For local development only `DATABASE_URL` and `JWT_SECRET` are required; the seed also needs `ADMIN_PASSWORD`.
