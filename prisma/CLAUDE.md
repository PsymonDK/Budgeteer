# Personal Budgeteer

Self-hosted household budget tracker. React + TypeScript + Vite + Tailwind 
frontend, Fastify + TypeScript + Prisma + PostgreSQL backend, monorepo.

## Stack
- Frontend: apps/web (React, Vite, Tailwind, TanStack Query)
- Backend: apps/api (Fastify, Prisma, JWT auth)
- Shared types: packages/shared
- DB schema: prisma/schema.prisma

## Commands
- Dev: npm run dev (from root)
- DB migrate: npm run db:migrate
- DB studio: npm run db:studio

## Conventions
- All amounts stored as Decimal with monthlyEquivalent calculated on save
- Frequencies: WEEKLY | FORTNIGHTLY | MONTHLY | QUARTERLY | BIANNUAL | ANNUAL
- cuid() for all IDs
- Soft deletes via isActive where relevant

## Docs
- Architecture & data model: docs/architecture.md
- User stories & sprint plan: docs/sprints.md