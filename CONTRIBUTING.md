# Contributing to Budgeteer

Thank you for your interest in contributing! This document covers how to get the project running locally, the branching strategy, and how to submit a PR.

---

## Prerequisites

- **Docker** and **Docker Compose** (recommended — runs everything with one command)
- Or: Node.js 20+, PostgreSQL 15+

---

## Running locally with Docker

```bash
# 1. Copy environment config
cp .env.example .env
# Edit .env — set ADMIN_EMAIL, ADMIN_PASSWORD, JWT_SECRET at minimum

# 2. Start all services (web, api, postgres)
docker compose up --build

# 3. App is available at:
#   Frontend  http://localhost:5173
#   API       http://localhost:3001
#   API docs  http://localhost:3001/docs  (once @fastify/swagger is configured)
```

### Seed demo data

Set `SEED_DEMO_DATA=true` in your `.env` to populate two households, four users, and sample budgets on first boot:

```
SEED_DEMO_DATA=true
```

Demo credentials: `alice@demo.local` / `demo1234`

---

## Running locally without Docker

```bash
# Install dependencies (from repo root — npm workspaces)
npm install

# Generate Prisma client
npm run db:generate

# Push schema to your local PostgreSQL instance
npx prisma db push --schema=prisma/schema.prisma

# Seed
npm run db:seed

# Start both API and web in parallel
npm run dev
```

---

## Project structure

```
budgeteer/
├── apps/
│   ├── api/          Fastify + TypeScript + Prisma
│   └── web/          React + Vite + Tailwind + TanStack Query
├── packages/
│   └── shared/       Shared TypeScript types (future)
├── prisma/
│   ├── schema.prisma Full data model
│   └── seed.ts       Admin user, default categories, optional demo data
├── docker/           Dockerfiles + entrypoint script
└── docker-compose.yml
```

---

## Running tests

```bash
# API unit tests (calculations, etc.)
cd apps/api && npm test

# Watch mode
cd apps/api && npm run test:watch
```

Tests use [Vitest](https://vitest.dev/). API tests live in `apps/api/src/**/*.test.ts`.

---

## Architecture decisions

| Decision | Choice | Reason |
|---|---|---|
| ORM | Prisma | Type-safe queries, great DX, easy schema evolution |
| Auth | JWT (access 15min + refresh 7d) | Stateless, works well for SPA; refresh rotation adds security |
| Schema migration | `prisma db push` | No migration files required in early development |
| Monorepo | npm workspaces | Keeps web/api/shared together without extra tooling |
| Amounts | `Decimal` + stored `monthlyEquivalent` | Avoids floating-point errors; pre-computed monthly avoids repeated calculation |

---

## Branching & PR guidelines

- Branch off `main` using `feature/your-description` or `fix/your-description`
- Keep PRs focused — one feature or fix per PR
- Update `CHANGELOG.md` under `[Unreleased]`
- Run tests before opening a PR: `cd apps/api && npm test`
- PR title format: `feat: short description` / `fix: short description`

---

## Adding an API endpoint

1. Add the route to the relevant file in `apps/api/src/routes/`
2. Use `authenticate` preHandler for any protected route
3. Use `requireAdmin` for system-admin-only routes
4. Validate request bodies with Zod schemas
5. Amounts: always store as `Decimal`, calculate `monthlyEquivalent` via `calcMonthlyEquivalent()`

---

## Environment variables

See `.env.example` for the full list. Required variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWTs — change in production |
| `ADMIN_EMAIL` | Email for the auto-created admin user |
| `ADMIN_PASSWORD` | Password for the auto-created admin user |
| `CORS_ORIGIN` | Allowed CORS origin (default: `http://localhost:5173`) |
| `SEED_DEMO_DATA` | Set to `true` to seed demo households and users |
