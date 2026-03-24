# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.7.0] - 2026-03-24 — Sprint 7: Dashboard & Summary

### Added
- **Dashboard API** — `GET /households/:id/summary` returns a single-request payload: income totals and per-member breakdown, expense totals with full item list and by-category rollup, savings totals, surplus, member expense splits (proportional to income share), and warning flags (DASH-001, DASH-003)
- **Dashboard page** (`/households/:id`) — replaces household detail as the default landing page; shows income/expenses/savings/surplus summary cards, member split table with share % bars, expenses table, and by-category bar chart (DASH-001)
- **Monthly / actual charge toggle** on the expenses table — switch between monthly equivalent and the raw entered amount + frequency label (DASH-002)
- **Dismissible warning banners** — `expensesExceedIncome`, `noSavings`, `unnamedSimulations` each show an amber banner that can be individually dismissed (DASH-003)

### Changed
- `/households/:id` — now routes to `DashboardPage`; member management moved to `/households/:id/settings` (`HouseholdPage`)
- `HouseholdPage` breadcrumb updated to reflect settings route; "Manage" links replaced with "← Back to dashboard"

---

## [0.6.0] - 2026-03-24 — Sprint 6: Income

### Added
- **Income API** — `GET/POST/PUT/DELETE /income` for current user's income entries; monthly equivalent calculated on every save (INC-001)
- **Allocation API** — `PUT /income/:id/allocations/:householdId` sets allocation % using the household's active budget year (auto-created if absent); `DELETE` removes it; `GET /income` response includes `totalAllocatedPct` and `overAllocated` flag per entry (INC-002)
- **Income summary API** — `GET /households/:id/income-summary` returns per-member monthly allocated income, share %, and individual entry breakdown for the active budget year (INC-003)
- **Income page** (`/income`) — user manages income entries + sets allocation % per household inline; over-allocation warning banner if any entry exceeds 100% across households; pending changes workflow with Save/Discard (INC-001, INC-002, INC-004)
- **Household income page** (`/households/:id/income`) — per-member summary cards with share % progress bar and income entry breakdown; links to `/income` for self-management (INC-003)
- Over-allocation warning on `/income` page; note in architecture for dashboard (Sprint 7) (INC-004)
- Income link added to household detail page

---

## [0.5.0] - 2026-03-24 — Sprint 5: Expenses

### Added
- **Calculations utility** (`lib/calculations.ts`) — `calcMonthlyEquivalent` for all 6 frequencies; `deriveBudgetStatus` from year (EXP-001)
- **Budget years API** (minimal) — `GET /households/:id/budget-years`, `POST /households/:id/budget-years`; status auto-derived from year; prevents duplicate non-simulation years per household
- **Expenses API** — `GET/POST /budget-years/:id/expenses`, `PUT/DELETE /budget-years/:id/expenses/:expenseId`; monthly equivalent calculated and stored on every create/update (EXP-001, EXP-002, EXP-003)
- **Expenses page** (`/households/:id/expenses`) — sortable by label, category, frequency, amount, monthly equivalent; filterable by category; shows entered amount + frequency alongside monthly equivalent; running total in table footer (EXP-004)
- Auto-selects active budget year; prompts to create current year if none exists
- Real-time monthly equivalent preview in the add/edit form
- Delete confirmation dialog (EXP-003)
- Notes indicator (📝) shown inline on expense rows
- Expenses link added to household detail page

---

## [0.4.0] - 2026-03-24 — Sprint 4: Expense Categories

### Added
- **Categories API** — `GET /categories?householdId=`, `POST /categories`, `POST /categories/:id/promote`, `DELETE /categories/:id` with optional `{ replacementId }` body (CAT-001 – CAT-004)
- **Default system categories** seeded on first boot: Housing, Transport, Utilities, Food & Groceries, Insurance, Subscriptions, Healthcare, Savings, Other (CAT-001)
- **Custom category creation** — scoped to household; enforces name uniqueness within household; returns a warning if name duplicates a system-wide category (CAT-002)
- **Promote to system-wide** — system admin only; sets `isSystemWide: true`, clears `householdId`; all existing expenses on the category are unaffected as the FK stays the same (CAT-003)
- **Delete with reassignment** — returns 409 with expense count if category is in use; accepts `replacementId` to atomically reassign all expenses then delete (CAT-004)
- **Categories page** (`/households/:id/categories`) — lists system-wide and custom categories; household admins can create/delete; system admins can promote and delete system-wide (CAT-001 – CAT-004)
- **Admin categories page** (`/admin/categories`) — shows all custom categories across all households with promote action (CAT-003)
- Categories link added to household detail page

---

## [0.3.0] - 2026-03-24 — Sprint 3: Households

### Added
- **Household API** — `GET/POST /households`, `GET/PUT /households/:id`, member endpoints (`POST/PUT/DELETE /households/:id/members`) (HH-001 – HH-004)
- **Households page** (`/`) — lists all user households with member count and role badge; create household modal navigates directly into the new household (HH-001, HH-004)
- **Household detail page** (`/households/:id`) — inline name editing (admin), members table with role toggle and remove actions; last-admin guard enforced on both frontend and API (HH-002, HH-003)
- **Admin households page** (`/admin/households`) — system admin view of all households with member count and admin names (ADMIN-004)
- `GET /users` now accessible to all authenticated users so household admins can select members from the full user list (HH-002)
- Income allocations are preserved on member removal — they live on `IncomeEntry`, not `HouseholdMember` (HH-003)

### Changed
- `App.tsx` — placeholder Dashboard replaced by `HouseholdsPage`; added `/households/:id` and `/admin/households` routes

---

## [0.2.0] - 2026-03-24 — Sprint 2: Auth & User Management

### Added
- **Auth** — JWT login (15 min access token + 7 day refresh token), token rotation on refresh, refresh token invalidation on logout (AUTH-001, AUTH-002, AUTH-003)
- **Account lockout** — 10 consecutive failed login attempts locks the account for 15 minutes (AUTH-001)
- **First-run seed** — admin user created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` env vars on first boot; `mustChangePassword` flag set (ADMIN-001)
- **User management API** — `GET /users`, `POST /users`, `PUT /users/:id`; password never returned; email uniqueness enforced (ADMIN-002, ADMIN-003)
- **User management UI** — admin-only Users page with create and edit/deactivate modals (ADMIN-002, ADMIN-003)
- **Protected routes** — `ProtectedRoute` component redirects unauthenticated users to `/login`; `requireAdmin` guard returns 403 for non-admins
- **Silent token refresh** — Axios response interceptor transparently refreshes access token on 401 and queues concurrent requests (AUTH-002)
- **Login page** — email/password form with error display
- **Prisma schema extensions** — `failedLoginAttempts`, `lockedUntil` fields added to `User`

### Changed
- `docker-compose.yml` moved to repo root; postgres healthcheck added so API waits for DB before starting
- `docker/entrypoint.sh` — switched from `prisma migrate deploy` to `prisma db push` (no migration files required at this stage)
- `Dockerfile.api` — added `openssl` via `apk` to fix Prisma engine binary on Alpine
- `Dockerfile.web` — added `vite-env.d.ts` reference to fix `import.meta.env` TypeScript error
- CORS origin now reads from `CORS_ORIGIN` env var (was hardcoded to Vite dev URL)
- `docker-compose.yml` exposes postgres on port 5432 to allow local `prisma migrate dev`

---

## [0.1.0] - 2026-03-01 — Sprint 1: Project Scaffolding & Docker

### Added
- Monorepo structure: `apps/web` (React + Vite + TypeScript + Tailwind), `apps/api` (Fastify + TypeScript + Prisma), `packages/shared` (DEV-001)
- `docker-compose.yml` with web, api, and postgres services; named volume for data persistence (DEV-002)
- `.env.example` documenting all required environment variables (DEV-002)
- Prisma schema — full data model: `User`, `Household`, `HouseholdMember`, `BudgetYear`, `IncomeEntry`, `HouseholdIncomeAllocation`, `ExpenseCategory`, `Expense`, `SavingsEntry`, `RefreshToken`
- API health endpoint `GET /health`
- React frontend skeleton with Tailwind CSS
