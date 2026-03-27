# Personal Budgeteer

Self-hosted open-source household budget tracker. Pirate-themed (☠️).
React + TypeScript frontend, Fastify + TypeScript + Prisma + PostgreSQL backend, monorepo.

## Stack
- Frontend: `apps/web` — React 18, Vite, Tailwind CSS, Lucide React (icons), Sonner (toasts), TanStack Query, React Router v6, Recharts
- Backend: `apps/api` — Fastify, Prisma ORM, JWT auth, node-cron (currency sync)
- Shared: `packages/shared` — calculation helpers, Zod schemas, shared types
- Database: PostgreSQL via Docker or bare metal
- Schema: `prisma/schema.prisma`

## Commands
```
npm install              # install all workspaces
npm run dev              # run api + web concurrently
npm run db:migrate       # run prisma migrations
npm run db:generate      # regenerate prisma client
npm run db:studio        # open prisma studio
npm run db:seed          # seed development data
```

## Architecture docs
- Full architecture and data model: `@docs/architecture.md`
- API endpoints, auth flow, budget lifecycle: `@docs/architecture.md`

## Calculation rules
- ALL business logic calculations are done server-side, never in React components
- `monthlyEquivalent` is always calculated on save and stored in the database — never recalculated at render time
- Currency conversion is calculated server-side using stored rates
- The `packages/shared` calculation helpers may be used on the frontend ONLY for live previews in forms before submission
- Dashboard totals come from pre-aggregated API responses, not client-side math
- Income history chart data is aggregated server-side — the endpoint returns ready-to-display time series data

## Currency
- Base currency is set via env var `BASE_CURRENCY` (default: DKK)
- Rates fetched daily from Danmarks Nationalbank XML API
- Past expenses lock their rate at payment date — never retroactively updated
- Future expenses use the latest available rate and recalculate when rates update
- All `monthlyEquivalent` values are always stored in base currency

## Income model
- Income is modelled as Jobs → SalaryRecords (history) + MonthlyOverrides + Bonuses
- Active salary for any month = most recent SalaryRecord where effectiveFrom <= that month
- Monthly override takes precedence over default salary for that specific month
- Bonuses are user-classified: excluded from budget, one-off, or spread annually (÷12)
- Income allocation to households is a % per job per budget year

## Data conventions
- All IDs use `cuid()`
- All monetary amounts stored as `Decimal(10,2)`
- Allocation percentages stored as `Decimal(5,2)`
- Soft deletes via `isActive` or `endDate` — never hard delete user or financial data
- Retired budget years are read-only — never modify historical data

## API conventions
- REST, JSON
- Auth: JWT access token (15 min) + refresh token (7 days), rotated on use
- All routes require authentication except `/auth/login` and `/health`
- System admin routes are prefixed `/admin/`
- Errors return `{ error: string, code: string }`
- Successful creates return the created object with 201
- Validation via Zod on all request bodies

## Frontend conventions
- Never put business logic or calculations in React components
- Server state managed with TanStack Query — no manual fetch calls
- Forms use controlled components with live preview via shared calculation helpers
- All amounts displayed in base currency unless viewing a foreign currency expense detail
- Warnings (over-allocation, expenses > income, no savings) are soft — never block user actions

## Workflow
- Each feature maps to a GitHub issue
- Reference issues in commits: `feat: user login (#12)`
- Branch naming: `feature/AUTH-001-user-login`, `fix/EXP-003-delete-expense`
- Sprints tracked as GitHub Milestones

## Docs
- Architecture & data model: docs/architecture.md