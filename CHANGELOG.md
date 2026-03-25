# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.17.0] - 2026-03-25 — Avatar, Bookkeeper Role & Household Switcher

### Added
- **User avatar** — circular avatar in all headers; initials fallback with deterministic colour (8-colour palette, name-hashed); BOOKKEEPER and SYSTEM_ADMIN users show an amber ring (AVT-001)
- **Avatar upload** — profile page lets users upload a JPG/PNG/WebP (max 2 MB); stored server-side via `POST /users/me/avatar`; served as static files from `UPLOAD_DIR/avatars/`; `DELETE /users/me/avatar` reverts to initials (AVT-002)
- **Header user dropdown** — clicking the avatar opens a menu with name, email, Profile link, and Sign out; replaces the plain user-name link and separate sign-out button (AVT-003)
- **`@fastify/multipart`** and **`@fastify/static`** registered in the API for file upload handling and avatar serving; `UPLOAD_DIR` env var (default `./uploads`) controls storage location
- **`BOOKKEEPER` role** — added to `Role` enum between `SYSTEM_ADMIN` and `USER`; `requireBookkeeperOrAdmin` middleware exported from authenticate plugin; admin user management page shows role selector and Bookkeeper option (BK-001)
- **Proxy users** — `isProxy Boolean` field on `User`; proxy users cannot log in (403 on `/auth/login`); admin can create proxy users without a password; proxy users cannot be given elevated roles (BK-003)
- **Bookkeeper proxy income entry** — BOOKKEEPER and SYSTEM_ADMIN can manage income for proxy users via `GET /users/:id/jobs` (extended permission check); "Manage income →" link shown next to proxy members in household settings; `/income?proxyUserId=` opens IncomePage with a banner "Entering income on behalf of [name]" (BK-002)
- **Household switcher** — header dropdown listing all user households with fast switching; selecting a household navigates to the same sub-page in the new household; single-household users see a static label (HH-010)
- **`HouseholdContext`** — React context provider wrapping the app; `useHousehold()` hook; active household persisted to `localStorage` key `budgeteer_active_household`; validated against current membership on app load; falls back to `defaultHouseholdId` → first household (HH-010)
- **Default household pin** — pin icon in household switcher dropdown sets `defaultHouseholdId` in `UserPreferences`; current default shown with filled pin icon (HH-011)

### Changed
- `GET /users/me` now returns `avatarUrl` and `isProxy` fields
- `POST /users` accepts optional `isProxy` flag; proxy users skip password requirement
- `PUT /users/:id` accepts `role` and `isProxy` updates (admin only)
- Job ownership checks now allow BOOKKEEPER access to proxy users' jobs across all job/salary/bonus/override endpoints

---

## [0.16.0] - 2026-03-25 — Sprint 16: Category Icons

### Added
- **Icon field on expense categories** — optional `icon String?` added to `ExpenseCategory` schema; stores a Lucide icon name (e.g. `"Home"`, `"Zap"`); defaults to `"Tag"` at render time if unset (CAT-010)
- **Icon picker** — scrollable, searchable grid of all 1,400+ Lucide icons in the create-category modal; uses `lucide-react/dynamicIconImports` for the full index without upfront bundle cost; icons loaded lazily on demand (CAT-011)
- **`CategoryIcon` component** — shared `apps/web/src/components/CategoryIcon.tsx` renders a Lucide icon by name via dynamic import with `Tag` as static fallback; zero bundle cost for icons not assigned to any category (CAT-012)
- **Icon rendering throughout UI** — category icons appear in expense table rows, compare view category chips and table, dashboard by-category section, and category management tables (CAT-012)
- **Default system category icons in seed** — Housing→Home, Transport→Car, Utilities→Zap, Food & Groceries→ShoppingCart, Insurance→Shield, Subscriptions→RefreshCw, Healthcare→Heart, Savings→PiggyBank, Other→Tag; seed is idempotent (CAT-013)

---

## [0.15.0] - 2026-03-25 — Sprint 15: User Profile

### Added
- **`UserPreferences` model** — `preferredCurrency`, `defaultHouseholdId`, four notification toggles (`notifyOverAllocation`, `notifyExpensesExceedIncome`, `notifyNoSavings`, `notifyUncategorised`); created automatically with defaults when a new user is created (USR-003)
- **Profile API** — `GET /users/me` (profile + preferences), `PUT /users/me` (name/email; email change requires current password), `PUT /users/me/preferences` (partial update with upsert) (USR-001, USR-003)
- **Income summary API** — `GET /users/me/income/summary` returns totalMonthly, totalAllocated, totalUnallocated, allocationPct, overAllocated across all active jobs and their household allocations (USR-004)
- **Income trend API** — `GET /users/me/income/trend` resolves salary history server-side for each of the past 12 months; returns per-job monthly arrays, combined total, and bonus markers (USR-005)
- **Income Sankey API** — `GET /users/me/income/sankey` returns d3-sankey-shaped `{ nodes, links }` showing job → income total → household → expenses/savings/surplus flow; unallocated node omitted when fully allocated (USR-006)
- **Profile page** (`/profile`) — three-tab layout: Profile | Income | Households (USR-002)
  - *Profile tab*: editable name/email (email change requires inline password confirmation), Change Password button, preferred currency select (from `/currencies`), default household select, four notification preference toggles with auto-save (USR-003)
  - *Income tab*: summary bar (4 stat cards with over-allocation badge), 12-month recharts line chart with per-job coloured lines + dashed total + bonus dot markers, d3-sankey SVG flow diagram, link to full job management at `/income` (USR-004, USR-005, USR-006, USR-007)
  - *Households tab*: list of user's households with role badge, budget year status, and quick links to open each household; over-allocation warning banner (USR-008)
- **Profile navigation** — user's name in the household top-bar header links to `/profile` (USR-001)

---

## [0.14.1] - 2026-03-25 — Auth improvements + sidebar navigation

### Added
- **Admin password reset** — system admins can reset any user's password via a modal on the Users page; sets `mustChangePassword=true` so the user must choose a new password on next login
- **User self-service password change** — `POST /users/me/change-password` verifies current password and clears the `mustChangePassword` flag; accessible from a "Change password" link in the header nav
- **Mandatory change-password flow** — `ProtectedRoute` redirects to `/change-password` when `mustChangePassword` is set, blocking access to all other pages until complete; the page switches to an optional flow (with cancel) for voluntary changes
- **Household left sidebar navigation** — all household sub-pages now share a `HouseholdLayout` wrapper rendered via React Router v6 nested routes; a fixed `w-56` sidebar (lucide-react icons, active highlight via `useLocation`) replaces the bottom "Manage" button grid on the dashboard; top header shows household name and right-side links (My income, Users for admins, Change password, Sign out)

### Changed
- `App.tsx` — 9 flat `/households/:id/*` routes replaced by a single nested route under `HouseholdLayout`; `DashboardPage` no longer renders the "Manage" section
- Admin `UsersPage` brand link changed from plain text to a `<Link>` so users can navigate back from the admin area

---

## [0.14.0] - 2026-03-25 — Sprint 14: Enhanced Income Tracking

### Added
- **Job-centric income model** — replaces the flat `IncomeEntry` with `Job`, `SalaryRecord`, `MonthlyIncomeOverride`, and `Bonus` models; `HouseholdIncomeAllocation` now references `jobId`
- **Salary history resolution** — `lib/incomeCalc.ts` helpers (`getJobMonthlyIncome`, `calcIncomeForYear`) resolve the active salary for any month using the most recent `SalaryRecord` where `effectiveFrom <= month`; monthly overrides take precedence
- **Bonuses** — `includeInBudget` toggle + budget mode (`ONE_OFF` or `SPREAD_ANNUALLY`) controls whether a bonus is factored into the annual income calculation
- **Jobs API** (`routes/jobs.ts`) — full CRUD for jobs, salary records, monthly overrides, bonuses, allocations, and `GET /jobs/history` income history endpoint
- **Income page rewrite** — three-tab UI: Jobs & Salary / Monthly Overrides / Bonuses; allocation grid per household; recharts history chart of monthly income over time

### Changed
- Dashboard, compare, and savings-history endpoints updated to use `incomeCalc` helpers
- Demo seed data updated to use `Job` / `SalaryRecord` / `Bonus` records instead of `IncomeEntry`

---

## [0.13.0] - 2026-03-25 — Sprint 13: Currency Support

### Added
- **Base currency configuration** — `BASE_CURRENCY` env var (default `DKK`); `GET /config` returns `baseCurrency` to the frontend (CUR-001)
- **Exchange rate sync** — fetches and parses Danmarks Nationalbank XML feed via `fast-xml-parser`; rates stored in new `CurrencyRate` table (CUR-002)
- **Daily rate sync job** — `node-cron` job runs at 06:00; recalculates monthly equivalents for all unlocked foreign-currency expenses and savings entries (CUR-003)
- **Manual rate refresh** — `POST /admin/currencies/refresh` (admin only) triggers an immediate rate sync (CUR-004)
- **Foreign-currency expenses and savings** — `currencyCode`, `originalAmount`, `rateUsed`, `rateDate` fields on `Expense` and `SavingsEntry`; UI shows currency selector, original amount, and applied rate in add/edit forms and table rows (CUR-005)
- **Rate snapshot on payment** — nightly job locks `rateUsed` / `rateDate` for expenses and savings entries once their `frequencyPeriod` date has passed (CUR-006)
- **Currency API** — `GET /currencies` (latest rates), `GET /currencies/:code/history` (CUR-007)
- `SavingsEntry` gains `frequencyPeriod` field to support payment-date rate locking

---

## [0.12.1] - 2026-03-24 — Infrastructure: Docker fixes + Prisma v7 upgrade

### Changed
- **Prisma v5 → v7** — added `prisma.config.ts` with `@prisma/adapter-pg` migrate adapter; `PrismaClient` now uses the PrismaPg driver adapter; `--schema` flags removed from npm scripts (handled by config file); `Dockerfile.api` copies `prisma.config.ts`
- Removed deprecated `url` field from the `datasource` block in `schema.prisma`
- Decimal imports updated from `runtime/library` → `runtime/client`

### Fixed
- `SEED_DEMO_DATA` env var now correctly passed into the API container via `docker-compose.yml`
- TypeScript build errors in `Dockerfile.web` that prevented the Docker web image from building
- Removed `pg Pool` import from `seed.ts` (no `@types/pg` in scope); PrismaPg adapter initialised correctly for seed context

---

## [0.12.0] - 2026-03-24 — Sprint 11 & 12: History + Open Source

### Added
- **Trends API** — `GET /households/:id/trends` returns income, expenses, savings, surplus and per-category expense breakdown for every non-simulation budget year, ordered by year (HIST-002)
- **Dashboard summary `?budgetYearId=`** — optional query param lets any budget year (including retired ones) be loaded as a read-only summary (HIST-001)
- **History page** (`/households/:id/history`) — year-over-year grouped bar chart (recharts) with an expense category filter; collapsible timeline showing each year's totals and category breakdown with a link to its expenses (HIST-001, HIST-002)
- **Test suite** — Vitest set up for API; unit tests for `calcMonthlyEquivalent` (all 6 frequencies) and `deriveBudgetStatus` (`npm test` in `apps/api/`) (OSS-002)
- **Demo seed data** (`SEED_DEMO_DATA=true`) — 4 users, 2 households, 3 budget years (retired, active, simulation), sample expenses, savings, and income allocations (OSS-003)
- **API versioning** — version read from `npm_package_version` at runtime; returned in `GET /health`; displayed in app footer (OSS-004)
- **`CONTRIBUTING.md`** — setup guide (Docker + bare metal), architecture decisions table, branching & PR guidelines, endpoint authoring conventions, environment variable reference (OSS-001)
- History link added to dashboard manage section; `AppFooter` component added to dashboard

---

## [0.10.0] - 2026-03-24 — Sprint 10: Savings

### Added
- **Savings API** — full CRUD on `/budget-years/:id/savings`; monthly equivalent calculated on every save; read-only enforcement on RETIRED years (SAV-001)
- **Savings history API** — `GET /households/:id/savings-history` returns savings rate per non-simulation budget year (SAV-002)
- **Savings page** (`/households/:id/savings`) — add/edit/delete savings entries with label, amount, frequency, optional notes; budget year selector; running total footer; read-only view for retired years (SAV-001)
- **Savings rate on dashboard** — savings card shows percentage of income; historical savings rate bar chart appears when multiple years have data (SAV-002)
- **Affordability calculator on dashboard** — slider to model "what if I saved X more?"; shows adjusted remaining surplus and projected total savings rate; resets to zero on dismiss (SAV-003)
- Savings link added to household dashboard manage section

---

## [0.9.0] - 2026-03-24 — Sprint 9: Budget Comparison

### Added
- **Comparison API** — `GET /households/:id/compare?a=yearIdA&b=yearIdB` returns summary totals (income, expenses, savings, surplus) with deltas, and a merged expense list with change status (new/removed/changed/unchanged) for both years (COMP-001, COMP-002, COMP-003)
- **Compare page** (`/households/:id/compare`) — select any two budget years or simulations for side-by-side analysis:
  - Summary cards showing A vs B totals with signed deltas (green/red) (COMP-003)
  - Expense table with colour-coded rows: green = new, red = removed, amber = changed, neutral = unchanged (COMP-002)
  - Category multi-select filter chips (COMP-004)
  - Frequency filter chips (COMP-005)
  - Monthly / quarterly / annual time period toggle — all amounts scale accordingly (COMP-006)
  - Filtered totals footer with aggregate delta
- Compare link added to dashboard manage section and Budget Years page

---

## [0.8.0] - 2026-03-24 — Sprint 8: Budget Years

### Added
- **Budget year lifecycle API** — full CRUD on `/households/:id/budget-years`:
  - `POST /:yearId/copy` — copies all expenses and savings to a new calendar year or a named simulation (income allocations not copied) (BY-002)
  - `PATCH /:yearId` — rename a simulation (BY-003)
  - `PATCH /:yearId/retire` — manually retire an active or future budget year; sets to read-only (BY-005)
  - `PATCH /:yearId/promote` — promote a simulation to active; current active year is automatically retired (BY-004)
  - `DELETE /:yearId` — delete a simulation (BY-003)
- `GET /households/:id/budget-years` now includes simulations with `simulationName` field
- **Budget Years page** (`/households/:id/budget-years`) — lists regular years and simulations in separate sections; create, copy, rename, retire, promote, and delete actions with confirmation dialogs (BY-001 – BY-005)
- **Budget year selector** on Expenses page — dropdown to switch between all years and simulations; respects `?budgetYearId=` query param for direct linking from Budget Years page (BY-003)
- Budget Years link added to household dashboard manage section

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
