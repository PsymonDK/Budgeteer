# Personal Budgeteer — Architecture

## Overview

Self-hosted, open-source household budget tracker. Tracks recurring income and expenses, calculates monthly averages from varied payment frequencies, splits costs between household members by income proportion, and allows side-by-side comparison of budget years and simulations.

---

## Tech Stack

### Frontend
- **React + TypeScript** — UI framework
- **Vite** — build tool and dev server
- **Tailwind CSS** — styling
- **shadcn/ui** — accessible component library
- **TanStack Query** — server state and caching
- **React Router v6** — client-side routing
- **Recharts** — budget visualisations

### Backend
- **Node.js + TypeScript** — runtime
- **Fastify** — API framework
- **Prisma ORM** — type-safe database access and migrations
- **PostgreSQL** — primary database
- **Zod** — runtime validation and shared types
- **JWT + Refresh Tokens** — stateless auth

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
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   └── setup.sh
└── docs/
```

---

## Data Model

### Entities

**users** — system accounts
- id, email, name, passwordHash, role (SYSTEM_ADMIN | USER), isActive, mustChangePassword

**households** — shared budget spaces
- id, name

**household_members** — many-to-many users ↔ households
- householdId, userId, role (ADMIN | MEMBER)

**budget_years** — one budget per year per household, multiple simulations allowed
- householdId, year (int), status (ACTIVE | FUTURE | RETIRED | SIMULATION)
- simulationName (nullable), copiedFromId (self-referencing, nullable)

**income_entries** — per user, not per household
- userId, label, amount, frequency, frequencyPeriod, monthlyEquivalent

**household_income_allocations** — user allocates % of income to a budget year
- incomeEntryId, budgetYearId, allocationPct
- Warning (not block) if total allocation across households exceeds 100%

**expense_categories** — system-wide or household-custom
- name, isSystemWide, householdId (null if system-wide), createdByUserId
- Household admins can create custom categories
- System admins can promote custom → system-wide

**expenses** — recurring expenses on a budget year
- budgetYearId, categoryId, label, amount, frequency, frequencyPeriod, monthlyEquivalent, notes

**savings_entries** — planned savings on a budget year
- budgetYearId, label, amount, frequency, monthlyEquivalent, notes

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
| Uncategorised expenses | Uncategorised expenses warning |

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

GET    /users                              # system admin only
POST   /users
PUT    /users/:id
DELETE /users/:id

GET    /households
POST   /households
PUT    /households/:id
GET    /households/:id/members
POST   /households/:id/members
DELETE /households/:id/members/:userId

GET    /households/:id/budget-years
POST   /households/:id/budget-years
PUT    /households/:id/budget-years/:yearId
POST   /households/:id/budget-years/:yearId/copy
POST   /households/:id/budget-years/:yearId/promote
POST   /households/:id/budget-years/:yearId/retire

GET    /budget-years/:id/expenses
POST   /budget-years/:id/expenses
PUT    /budget-years/:id/expenses/:expenseId
DELETE /budget-years/:id/expenses/:expenseId

GET    /users/:id/income
POST   /users/:id/income
PUT    /users/:id/income/:incomeId
DELETE /users/:id/income/:incomeId

GET    /budget-years/:id/savings
POST   /budget-years/:id/savings
PUT    /budget-years/:id/savings/:savingsId
DELETE /budget-years/:id/savings/:savingsId

GET    /categories
POST   /categories
PUT    /categories/:id
DELETE /categories/:id
POST   /categories/:id/promote             # system admin only

GET    /households/:id/compare?yearA=:id&yearB=:id
GET    /households/:id/budget-years/:yearId/summary
```

---

## Auth Flow

- Login returns JWT access token (15 min) + refresh token (7 days)
- Refresh token rotated on use
- Frontend silently refreshes before expiry
- Logout invalidates refresh token in database
- Account locked after 10 failed login attempts
- First login forces password change