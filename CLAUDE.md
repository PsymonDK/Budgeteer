# Personal Budgeteer

Self-hosted open-source household budget tracker. Pirate-themed (☠️).
React + TypeScript frontend, Fastify + TypeScript + Prisma + PostgreSQL backend, monorepo.

## Stack
- Frontend: `apps/web` — React 18, Vite, Tailwind CSS, Lucide React (icons), Sonner (toasts), TanStack Query, React Router v6, Recharts
- Backend: `apps/api` — Fastify, Prisma ORM, JWT auth, node-cron (currency sync), @anthropic-ai/sdk (payslip parsing)
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
- The helpers in `apps/web/src/lib/constants.ts` (`calcMonthly`) and `apps/web/src/pages/IncomePage.tsx` (`calcDanishDeductions`) may be used on the frontend ONLY for live previews in forms before submission
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
- TaxCardSettings (Danish): traekprocent, personfradrag, pension %, ATP, brutto items — server-side deduction calculation (`apps/api/src/lib/taxCalcDK.ts`); frontend mirrors the calculation for live preview in IncomePage
- Payslip import: CSV template or AI-assisted parsing via `POST /jobs/:id/payslips/parse` (requires `ANTHROPIC_API_KEY`); parsed data pre-fills the salary/override form

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
- Forms use controlled components with live preview via helpers in `apps/web/src/lib/constants.ts`
- All amounts displayed in base currency unless viewing a foreign currency expense detail
- Warnings (over-allocation, expenses > income, no savings) are soft — never block user actions

## Workflow
- Each feature maps to a GitHub issue
- Reference issues in commits: `feat: user login (#12)`
- Branch naming: `feature/AUTH-001-user-login`, `fix/EXP-003-delete-expense`
- Sprints tracked as GitHub Milestones
- Always update `CHANGELOG.md` when committing — add an entry under the current version describing what changed and why
- Always update `docs/architecture.md` when making architectural changes — new entities, new/removed API endpoints, schema changes, or stack changes
- When adding or removing directories from the project structure, always update `docker/Dockerfile.api` and `docker/Dockerfile.web` — both Dockerfiles copy source explicitly and must stay in sync with the repo layout

## Docs
- Architecture & data model: docs/architecture.md