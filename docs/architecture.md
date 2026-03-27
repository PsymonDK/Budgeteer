# Personal Budgeteer — Architecture

## Overview

Self-hosted, open-source household budget tracker. Tracks recurring income and expenses, calculates monthly averages from varied payment frequencies, splits costs between household members by income proportion, and allows side-by-side comparison of budget years and simulations.

---

## Tech Stack

### Frontend
- **React + TypeScript** — UI framework
- **Vite** — build tool and dev server
- **Tailwind CSS** — styling (custom components, no component library)
- **Lucide React** — icon library
- **Sonner** — toast notifications
- **TanStack Query** — server state and caching
- **React Router v6** — client-side routing
- **Recharts** — budget visualisations
- **D3 / Sankey** — income flow diagram

### Backend
- **Node.js + TypeScript** — runtime
- **Fastify** — API framework
- **Prisma ORM** — type-safe database access and migrations
- **PostgreSQL** — primary database
- **Zod** — runtime validation and shared types
- **JWT + Refresh Tokens** — stateless auth
- **node-cron** — daily currency rate sync (06:00)

### Infrastructure
- **Docker + Docker Compose** — single-command self-hosted setup
- **Bare metal** — setup script for direct server installs

---

## Project Structure

```
budgeteer/
├── apps/
│   ├── web/          # React frontend (Vite)
│   └── api/          # Fastify backend
├── packages/
│   └── shared/       # Shared Zod schemas, types, calculation helpers
├── docker/
│   ├── Dockerfile.web
│   ├── Dockerfile.api
│   ├── nginx.conf
│   └── docker-compose.yml
├── prisma/
│   └── schema.prisma
├── scripts/
│   └── setup.sh
└── docs/
```

---

## Data Model

### Entities

**users** — system accounts
- id, email, name, passwordHash, role (`SYSTEM_ADMIN` | `BOOKKEEPER` | `USER`), isActive, isProxy, mustChangePassword, avatarUrl, failedLoginAttempts, lockedUntil

**user_preferences** — per-user settings (1:1 with user)
- userId, defaultHouseholdId, preferredCurrency, notifyOverAllocation, notifyExpensesExceedIncome, notifyNoSavings, notifyUncategorised

**households** — shared budget spaces
- id, name

**household_members** — many-to-many users ↔ households
- householdId, userId, role (`ADMIN` | `MEMBER`)

**budget_years** — one budget per year per household; multiple simulations allowed
- householdId, year (int), status (`ACTIVE` | `FUTURE` | `RETIRED` | `SIMULATION`)
- simulationName (nullable), copiedFromId (self-referencing, nullable)

**jobs** — a user's employment record; income is modelled per job
- userId, name, employer (nullable), startDate, endDate (nullable)

**salary_records** — salary history for a job
- jobId, grossAmount, netAmount, effectiveFrom, currencyCode (nullable), rateUsed (nullable)
- Active salary for any month = most recent record where `effectiveFrom <= that month`

**monthly_income_overrides** — one-off overrides for a specific month
- jobId, year, month, grossAmount, netAmount, note
- Takes precedence over the default salary record for that month

**bonuses** — additional payments on a job
- jobId, label, grossAmount, netAmount, paymentDate, includeInBudget, budgetMode (`ONE_OFF` | `SPREAD_ANNUALLY`), currencyCode (nullable)

**household_income_allocations** — user allocates % of a job's income to a budget year
- jobId, budgetYearId, allocationPct
- Warning (not block) if total allocation across households exceeds 100%

**categories** — expense or savings classification; system-wide or household-custom
- name, icon, categoryType (`EXPENSE` | `SAVINGS`), isSystemWide, isActive, householdId (null if system-wide), createdByUserId
- Household members can create custom categories; system admins can promote them system-wide
- Inactive categories are hidden from new entries but remain on historical records

**expenses** — recurring expenses on a budget year
- budgetYearId, categoryId, label, amount, frequency, frequencyPeriod, monthlyEquivalent, notes
- ownership (`SHARED` | `INDIVIDUAL` | `CUSTOM`), ownedByUserId (nullable)
- currencyCode (nullable), originalAmount (nullable), rateUsed (nullable), rateDate (nullable)

**expense_custom_splits** — per-member percentage splits for CUSTOM ownership expenses
- expenseId, userId, pct (must sum to 100%)

**savings_entries** — planned savings on a budget year
- budgetYearId, label, amount, frequency, frequencyPeriod, monthlyEquivalent, notes
- ownership (`SHARED` | `INDIVIDUAL` | `CUSTOM`), ownedByUserId (nullable), categoryId (nullable)
- currencyCode (nullable), originalAmount (nullable), rateUsed (nullable), rateDate (nullable)

**savings_custom_splits** — per-member percentage splits for CUSTOM ownership savings
- savingsEntryId, userId, pct (must sum to 100%)

**currencies** — admin-managed catalog of available currencies
- code (PK), name, isEnabled
- Disabled currencies are hidden from user-facing currency selectors

**currency_rates** — time-series exchange rates fetched from Danmarks Nationalbank
- currencyCode, rate (relative to BASE_CURRENCY), baseCurrency, fetchedDate
- New rows appended daily; queries use `DISTINCT ON` to get the latest rate per currency
- Past expense/savings rates are locked at `rateDate`; future ones recalculate on sync

**refresh_tokens** — JWT refresh token store
- token, userId, expiresAt

---

## Key Calculations

### Monthly Equivalent
All amounts stored with a calculated `monthlyEquivalent`:

| Frequency | Multiplier |
|---|---|
| WEEKLY | × 52 ÷ 12 |
| FORTNIGHTLY | × 26 ÷ 12 |
| MONTHLY | × 1 |
| QUARTERLY | ÷ 3 |
| BIANNUAL | ÷ 6 |
| ANNUAL | ÷ 12 |

### Income Splitting
Each member's share of household expenses is proportional to their share of total household income.

```
User A contributes €3,000/month → 60% of household income
User B contributes €2,000/month → 40% of household income
Shared expense €1,000/month → A owes €600, B owes €400
```

Individual and custom-split expenses bypass the proportional calculation.

Informational only — system calculates and displays, never enforces.

---

## Budget Lifecycle

```
[FUTURE] → (year arrives or manual promotion) → [ACTIVE]
[ACTIVE] → (new year or manual action) → [RETIRED]
[ACTIVE | FUTURE] → (copy) → [SIMULATION]
[SIMULATION] → (promote) → becomes ACTIVE, previous ACTIVE → RETIRED
```

- Status is date-derived: year < current = RETIRED, year = current = ACTIVE, year > current = FUTURE
- Simulations override date logic — always editable
- Multiple simulations per year allowed, each with a unique name
- Retired budget years are read-only

---

## Notification Rules (soft warnings, never blocking)

| Trigger | Warning |
|---|---|
| Income allocation > 100% across households | Over-allocation warning on income screen and dashboard |
| Total expenses > total income | Expenses exceed income warning |
| No savings entries in budget year | No savings allocated warning |
| Expense has no category assigned | Uncategorised expenses warning |

---

## Comparison View

Any two budget years (including simulations) within a household can be compared side by side.

- New items highlighted green, removed red, changed amber, unchanged neutral
- Summary totals: income, expenses, savings, surplus/deficit with delta
- Slicers: category, frequency, member, time period (monthly / quarterly / annual)

---

## API Structure

```
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

GET    /users                                          # admin only
POST   /users
PUT    /users/:id
DELETE /users/:id
POST   /users/:id/reset-password                       # admin only
GET    /users/:id/income/history
GET    /users/:id/jobs
POST   /users/:id/jobs
PUT    /users/:id/jobs/:jobId
DELETE /users/:id/jobs/:jobId
GET    /users/me
PUT    /users/me
POST   /users/me/avatar
DELETE /users/me/avatar
POST   /users/me/change-password
PUT    /users/me/preferences
GET    /users/me/income/summary
GET    /users/me/income/trend
GET    /users/me/income/sankey
GET    /me/summary                                     # cross-household dashboard summary

GET    /jobs/:id/salary
POST   /jobs/:id/salary
PUT    /jobs/:id/salary/:salaryId
DELETE /jobs/:id/salary/:salaryId
GET    /jobs/:id/overrides
POST   /jobs/:id/overrides
DELETE /jobs/:id/overrides/:overrideId
GET    /jobs/:id/bonuses
POST   /jobs/:id/bonuses
PUT    /jobs/:id/bonuses/:bonusId
DELETE /jobs/:id/bonuses/:bonusId

PUT    /income/:id/allocations/:householdId
DELETE /income/:id/allocations/:householdId

GET    /households
POST   /households
GET    /households/:id
PUT    /households/:id
GET    /households/:id/members
POST   /households/:id/members
PUT    /households/:id/members/:memberId
DELETE /households/:id/members/:memberId
GET    /households/:id/budget-years
POST   /households/:id/budget-years
GET    /households/:id/summary
GET    /households/:id/income-summary
GET    /households/:id/savings-history
GET    /households/:id/trends
GET    /households/:id/compare

PATCH  /households/:id/budget-years/:yearId
POST   /households/:id/budget-years/:yearId/copy
PATCH  /households/:id/budget-years/:yearId/promote
PATCH  /households/:id/budget-years/:yearId/retire
DELETE /households/:id/budget-years/:yearId

GET    /budget-years/:id/expenses
POST   /budget-years/:id/expenses
PUT    /budget-years/:id/expenses/:expenseId
DELETE /budget-years/:id/expenses/:expenseId

GET    /budget-years/:id/savings
POST   /budget-years/:id/savings
PUT    /budget-years/:id/savings/:entryId
DELETE /budget-years/:id/savings/:entryId

GET    /categories
POST   /categories
DELETE /categories/:id
POST   /categories/:id/promote                         # admin only
POST   /admin/categories
PATCH  /admin/categories/:id

GET    /currencies
GET    /currencies/:code/history
GET    /admin/currencies                               # admin only
POST   /admin/currencies                               # admin only
PATCH  /admin/currencies/:code                         # admin only
POST   /admin/currencies/refresh                       # admin only

GET    /admin/users
GET    /admin/households

GET    /health
GET    /config
```

---

## Auth Flow

- Login returns JWT access token (15 min) + refresh token (7 days)
- Refresh token rotated on use
- Frontend silently refreshes before expiry
- Logout invalidates refresh token in database
- Account locked after 10 failed login attempts for 15 minutes
- First login (and admin-triggered reset) forces password change
- Proxy accounts (`isProxy = true`) cannot log in directly — used for income entry on behalf of others
