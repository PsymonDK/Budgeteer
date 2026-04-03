# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.44.0] - 2026-04-03 — Bug fixes: calendar view, automations backfill, transfer history

### Fixed
- **Calendar view respects startMonth/endMonth** — `getMonthValues` was filling all 12 months with the annual-average `monthlyEquivalent`; it now shows the true per-period cash amount only in the months the expense is active; QUARTERLY/BIANNUAL/ANNUAL payment placement is also clipped to the active range
- **Automations backfill for existing households** — households created before the BudgetTransfer system was introduced had no `monthly_transfer_snapshot` Automation record; a migration now inserts the missing rows so the monthly cron and manual triggers work for all households
- **Transfer history shows all 12 months** — `recalculateTransfer` was only writing a single record for the current month; past months were blank and the current month amount was inflated (`annualNeed / remainingMonths` instead of `annualNeed / 12`); the function now loops all 12 months: past months get the equal-split plan amount, current and future months use the forward-looking formula; PAID/ADJUSTED months are never overwritten
- **Transfer grid seeded on budget year creation/promotion** — creating an ACTIVE budget year or promoting a simulation now immediately fires `recalculateTransfer` so the full 12-month transfer grid exists from the start

---

## [0.43.0] - 2026-04-03 — Forward-looking monthly budget calculation (Sprint 23)

### Added
- **BudgetTransfer system (#133–140)** — expense and savings changes no longer affect past months; a `BudgetTransfer` record per month stores the recommended transfer amount using the formula `max(0, (annualNeed − alreadyPaid) / remainingMonths)`
- **Automation runner + monthly cron (#136)** — `Automation` and `AutomationRun` models; `runAutomation()` / `runAllEnabledAutomations()`; cron fires on the 1st of each month (`0 0 1 * *`); `monthly_transfer_snapshot` automation seeded on household creation
- **Budget transfers REST API (#137)** — `GET /budget-years/:id/transfers`; `PATCH .../mark-paid`; `PATCH .../mark-pending`
- **Admin automations REST API (#138)** — list, toggle, trigger, trigger-all, run history; all routes require `SYSTEM_ADMIN`
- **Transfer tile on dashboard (#139–140)** — transfer amount tile with mark-as-paid modal and collapsible month history table

### Changed
- `calcForwardMonthlyNeed()` added to `calculations.ts` with 8 unit tests (Jan/Jul/Dec, paid transfers, edge cases)
- `recalculateTransfer()` wired fire-and-forget into expenses and savings `POST`/`PUT`/`DELETE` routes

---

## [0.42.0] - 2026-04-02 — Accounts

### Added
- **#107 Account tracking** — `Account` model (`BANK`, `CREDIT_CARD`, `MOBILE_PAY`) with personal accounts per user and household-level shared accounts; expenses and savings entries gain an optional account tag
- **Account CRUD API** — `GET/POST/PATCH/DELETE /users/me/accounts` (personal) and `/households/:id/accounts` (household); combined dropdown endpoint at `/budget-years/:id/accounts`; 409 safeguard blocks deletion of accounts still in use
- **Account UI** — Accounts tab on Profile page (personal); Accounts section on Household page (admin write, member read); account dropdown in expense and savings forms grouped by personal/household; account badge on list rows; account filter pills; by-account breakdown on household dashboard

---

## [0.41.0] - 2026-04-01 — Header navigation consolidation

### Changed
- **Consolidated header nav into dropdowns** — removed loose links (Dashboard, Personal Income, Admin) from the header bar; reorganised into `HeaderSettingsMenu` (gear icon: Household Settings, Admin Panel) and `HeaderUserMenu` (avatar: Personal Income, Profile, Change Password, Sign out)

---

## [0.40.0] - 2026-04-01 — Personal dashboard refocus (#127)

### Added
- **New `/users/me/dashboard` endpoint** — income, expenses, savings, and surplus all scoped to the requesting user; household cards retain full household totals
- **4-tile layout with monthly/annual toggle** — Income, Expenses, Savings, Surplus tiles; the toggle scales all monetary values across tiles and household cards simultaneously
- **Sparkline charts on dashboard tiles** — optional per-tile sparklines controlled by a new `showDashboardSparklines` user preference (default: on)
- **Surplus as a full tile** — promoted from a banner to a first-class tile alongside Income, Expenses, Savings

### Fixed
- **Household card income and surplus** use full household totals (not the viewing user's share)
- **Sankey nodes show formatted amounts** below each node name; removed unused `DeltaBadge` component

### Changed
- **`+ New household` button** restricted to `SYSTEM_ADMIN` users
- Footer version bumped to `0.40.0`

---

## [0.39.0] - 2026-03-31 — Compare dashboard income fallback

### Fixed
- **Compare dashboard income tiles show 0** — when comparing budget years that have no `HouseholdIncomeAllocation` records (e.g. older/retired years), the compare endpoint now falls back to the most recent budget year in the same household that does have allocations; the salary reference date remains tied to the actual compared year so salary snapshots stay correct

---

## [0.38.0] - 2026-03-28 — Personal income on user dashboard

### Fixed
- **User dashboard income tile shows personal income** — the `/me/summary` endpoint was using total household income instead of the current user's allocated share; now filters `calcIncomeForYear` results to the requesting user's `memberIncome` entry for both the active and previous budget year

---

## [0.37.0] - 2026-03-27 — Currency markers throughout; expense date ranges

### Added
- **#124 Currency code next to all monetary amounts** — a shared `useFmt()` hook (and `useBaseCurrency()`) fetches the base currency from `/config` once (stale-time: Infinity) and formats every monetary value as `1,234.56 DKK`; replaces bare number formatting across all pages (Expenses, Savings, Dashboard, User Dashboard, Compare, Income, History, Household Income)
- **#106 Expense date ranges (partial)** — expenses can now have an optional start month and end month; the `monthlyEquivalent` stored in the database is adjusted to the annual average for partial-year expenses (e.g. a quarterly €900 expense active only May–Aug counts as €225/mo averaged over 12 months); the expense form has month picker dropdowns; the expense list shows a `May–Aug` badge on partial-year rows and dims rows whose `endMonth` has already passed in the current year
- **Month range validation** — API rejects payloads where `startMonth > endMonth`; `copyBudgetYear` copies `startMonth`/`endMonth` to new years and simulations

### Changed
- **`SankeyChart`** now accepts a `currency` prop instead of capturing the base currency itself; callers pass `useBaseCurrency()` so the chart stays a pure presentational component
- **`ComparePage`** period-aware formatter refactored to a `makeFmt(currency)` factory so the period-multiplier logic stays local while currency comes from the shared hook
- Footer version bumped to `0.37.0`

---

## [0.36.0] - 2026-03-27 — Gross/net toggle on income charts; bonus history fix

### Added
- **Gross/Net toggle on 12-month income trend** — personal dashboard now has a Gross/Net segmented control above the trend chart; defaults to Gross; per-job lines and totals switch accordingly
- **Gross/Net toggle on income history chart** — the Income History chart on the Personal Income page now defaults to Gross (was Net); toggle behaviour unchanged

### Fixed
- **Income history bonus spikes** — `SPREAD_ANNUALLY` bonuses now show their full amount in the payment month on the history chart instead of being divided by 12 and spread across every month; matches `ONE_OFF` behaviour

### Changed
- **Income trend API** (`/users/me/income/trend`) now returns `monthlyNet[]` alongside `monthly[]` per job, `totalNet[]` alongside `total[]`, and `amountNet` on each bonus entry so the frontend can toggle between gross and net without a second request

---

## [0.35.0] - 2026-03-27 — Gross income splits, Sankey fix, navigation, refactoring

### Added
- **My Income link always visible** (#117) — "My Income" link added to the main header navigation (visible on all pages); user avatar dropdown now also includes My Income and Change Password entries for quick access without going through the household page

### Fixed
- **#105 Personal Sankey proportional share** — the personal dashboard Sankey now shows each user's proportional share of household expenses and savings (based on gross income share) rather than the full household totals; a surplus node appears when the user's allocated income exceeds their share of spending
- **Gross income as split basis** (#104) — member share percentages across all dashboards and income summaries are now calculated from gross income rather than net; displayed income figures remain net; the income trend chart and Sankey source values switched to gross

### Changed
- **Household income summary** (`/households/:id/income-summary`) now returns `monthlyAllocatedGross` per member alongside the existing net figure, plus `sharePct` derived from gross
- **Household dashboard** member income cards show gross income with share % and net income below it
- **Personal income trend** endpoint switched to gross amounts for salary records, overrides, and bonuses
- Footer version bumped to `0.35.0`

### Refactored (internal, no behaviour change)
- **#119 `toNum()` helper** — `apps/api/src/lib/decimal.ts` centralises all Prisma Decimal-to-number conversions; replaced 50+ `parseFloat(x.toString())` calls across routes and `incomeCalc.ts`
- **#120 `partitionByOwnership()`** — shared utility in `lib/ownership.ts` replaces duplicated SHARED/INDIVIDUAL/CUSTOM split blocks in `dashboard.ts`
- **#121 `assertHouseholdAccess()`** — shared auth guard in `lib/ownership.ts` replaces inline `prisma.householdMember.findUnique` checks across `dashboard.ts`, `compare.ts`, `jobs.ts`, `budgetYears.ts`
- **#122 `copyBudgetYearContent()`** — helper in `budgetYears.ts` removes ~60 lines of duplicated expense/savings copy logic between the copy-to-year and copy-to-simulation branches
- **#123 Frontend constants** — `apps/web/src/lib/constants.ts` exports `FREQ_LABELS` and `FREQUENCIES`; removed local definitions from `DashboardPage`, `HouseholdIncomePage`, `ComparePage`, `ExpensesPage`, `SavingsPage`

---

## [0.33.0] - 2026-03-27 — Bug fixes, security hardening, household lifecycle

### Added
- **Household deactivate / reactivate** (#101) — household admins can deactivate a household from the Settings page; deactivated households are hidden from the dashboard; system admins can hard-delete a household (blocked if an active budget year exists)
- **System admin household list** now shows inactive households (dimmed) and includes a Delete button with confirmation

### Fixed
- **#96 Display name** — user data is now refreshed from `/users/me` on every app load so the header always shows the current name from the database rather than a stale localStorage value
- **#97 Currency dropdown empty** — the `/currencies` endpoint now returns all enabled currencies from the Currency table even when no rate records exist yet (e.g. before the first Nationalbank sync); rates are `null` until the sync completes
- **#98 Session persists after data wipe** — all three auth guards (`authenticate`, `requireAdmin`, `requireBookkeeperOrAdmin`) now verify the user still exists and is active in the database after validating the JWT signature; deleted users are rejected with 401

### Changed
- **#100 ENV variable naming** — `APP_URL` renamed to `PUBLIC_URL` across all compose files and the API; old name still accepted as a fallback; `VITE_API_URL` removed from the deploy `.env.example` (it is a build-time variable that always defaults to `/api` in Docker and does not need to be set); inline comments added to compose files explaining every variable
- **#103 Docker Compose** — `docker-compose.yml` renamed to `docker-compose.dev.yml` to clearly separate the contributor build-from-source setup from the end-user `deploy/docker-compose.yml`
- Footer version bumped to `0.33.0`

---

## [0.32.0] - 2026-03-27 — Wider layouts for larger screens

### Changed
- **Dashboards** (`DashboardPage`, `UserDashboardPage`) expanded from `max-w-5xl` to `max-w-7xl` to make better use of wider screens
- **Compare page** expanded from `max-w-6xl` to `max-w-7xl`
- **Tables & lists** (`ExpensesPage`, `HistoryPage`, `IncomePage`, `HouseholdIncomePage`) expanded from `max-w-4xl/5xl` to `max-w-6xl`
- **Admin pages** (`UsersPage`, `HouseholdsAdminPage`, `CurrenciesAdminPage`, `CategoriesAdminPage`) expanded from `max-w-4xl/5xl` to `max-w-6xl`
- **Expense calendar view** uses full available width (`w-full`) with no cap, since the 13-column grid benefits from every available pixel
- Settings and form pages remain at `max-w-4xl` (no change)
- Footer version bumped to `0.32.0`

---

## [0.31.0] - 2026-03-27 — Monthly expense calendar (EXP-005)

### Added
- **Calendar view** on the Expenses page — toggle between "List" and "Calendar" using the new view switcher in the controls bar
- **Yearly expense grid**: one row per expense, 12 month columns (Jan–Dec) + row total, with a footer row showing monthly totals and a grand total
- **Heatmap colouring**: cells are tinted amber proportionally to the column's maximum value, making high-spend months immediately visible
- **Frequency-aware month logic**: MONTHLY/WEEKLY/FORTNIGHTLY expenses show the monthly equivalent in every column; QUARTERLY fills Mar/Jun/Sep/Dec with the actual charge; BIANNUAL fills Jun/Dec; ANNUAL fills Dec only — empty months show "—"
- **Recurring indicator**: a `↻` glyph marks monthly/weekly/fortnightly expenses so periodic ones stand out

### Changed
- Footer version bumped to `0.31.0`

---

## [0.30.0] - 2026-03-27 — Per-member expense breakdown (HH-005)

### Changed
- **Member expense splits section** redesigned from a dense table into per-member cards, each showing shared expenses, personal expenses, and a prominent "Amount to transfer / mo" total; the current user's card is highlighted in amber
- Footer version bumped to `0.30.0`

---

## [0.29.0] - 2026-03-27 — Household income flow diagram (VIZ-001)

### Added
- **Income flow Sankey diagram** on the household dashboard — shows each income member's contribution flowing proportionally into expense categories, savings, and surplus; member nodes are colour-coded on the left, target nodes on the right
- **Shared `SankeyChart` component** (`components/SankeyChart.tsx`) extracted from personal dashboard so both the household and personal dashboards use the same rendering logic

### Changed
- `UserDashboardPage` now imports `SankeyChart` from the shared component instead of defining it inline
- Footer version bumped to `0.29.0`

---

## [0.28.0] - 2026-03-27 — Personal dashboard income overview (DASH-004)

### Added
- **Income overview on personal dashboard** — the dashboard at `/` now shows personal income summary cards (monthly total, allocated, unallocated, allocation %), an income flow (Sankey) diagram, and a 12-month income trend chart, placed below the household cards
- **"Manage jobs & salary →" link** on the dashboard for quick access to income management

### Changed
- **Footer version** updated to `0.28.0`
- **Profile page** Income tab removed — the income overview is now on the dashboard; the Profile page retains Profile and Households tabs

### Fixed
- **Double footer bug** — `AppFooter` was rendered inside both `UserDashboardPage` and `GlobalLayout`, causing a duplicate footer; removed the redundant render from the page component

---

## [0.27.0] - 2026-03-27 — Admin panel: currency & category management (ADMIN-005)

### Added
- **Currency management page** (`/admin/currencies`) — admin can view all managed currencies showing code, name, conversion rate, last-updated date, and enabled/disabled status; add new currencies with code, name, and initial rate; edit name or rate; enable/disable (base currency cannot be disabled); "Sync rates" button triggers a manual pull from Danmarks Nationalbank
- **`Currency` model** — new table stores admin-managed currency catalog (`code`, `name`, `isEnabled`); `GET /currencies` now filters out disabled currencies via a LEFT JOIN; backward-compatible (currencies with no catalog row continue to appear)
- **`GET /admin/currencies`** — lists all currencies in the catalog joined with their latest rate and last-updated date
- **`POST /admin/currencies`** — creates a currency catalog entry and an initial `CurrencyRate` row
- **`PATCH /admin/currencies/:code`** — updates name, isEnabled, or inserts a new rate row; base currency cannot be disabled
- **Category management overhaul** (`/admin/categories`) — admin can now view all system-wide categories (name, type, active status, usage count), add new system-wide categories, rename existing categories, and toggle active/inactive; custom household categories are shown in a separate tab with the existing promote action
- **`isActive` field on `Category`** — soft-deactivation; inactive categories are hidden from new entries but remain on historical records; `GET /categories` filters to `isActive: true` for non-admin users
- **`POST /admin/categories`** — creates a system-wide category (name, type, optional icon)
- **`PATCH /admin/categories/:id`** — renames a category or toggles `isActive`
- **Forbidden page** (`/403`) — pirate-themed 403 page shown when a non-admin navigates to any `/admin/*` route
- **"Admin" navigation link** — visible only to system admin users in the household sidebar header and global layout header
- **15 default currencies seeded** — DKK, EUR, USD, GBP, SEK, NOK, CHF, JPY, CAD, AUD, PLN, CZK, HUF, RON, BGN pre-populated on first seed

### Changed
- Admin sub-navigation now includes a **Currencies** tab alongside Users, Households, and Categories
- Non-admin access to `/admin/*` routes now redirects to `/403` instead of `/`
- "Users" shortcut link in the household header renamed to "Admin"

---

## [0.26.0] - 2026-03-26 — User dashboard overview (DASH-004)

### Added
- **User dashboard** — new landing page at `/` replaces the plain household list; shows four summary cards (Monthly Income, Monthly Expenses, Monthly Savings, Household count) with ↑/↓ % delta vs the previous budget year
- **`GET /me/summary` API** — aggregates income, expenses and savings across all of the user's active household budget years; includes `previousTotals` for period comparison and a per-household breakdown
- **Household overview cards** — each household is shown as a rich card with role badge (Admin/Member), budget year status badge, a mini stats grid (income/expenses/savings/surplus), warning indicators (expenses exceed income, no savings) and member count

### Changed
- Default landing page after login is now the user dashboard instead of the plain households list; the "New household" button and create modal are embedded in the dashboard

---

## [0.25.0] - 2026-03-26 — Savings ownership, custom splits & savings categories

### Added
- **Custom percentage split for expenses** — expenses now support a third ownership mode ("Custom split") where each household member is assigned an explicit percentage; the split inputs show a live sum indicator that turns green when the total reaches 100 %
- **Custom percentage split for savings** — savings entries have the same three ownership modes: Shared (income-% pool), Individual (single member), and Custom split (per-member %)
- **Savings ownership** — savings entries now carry an `ownership` field (`SHARED` / `INDIVIDUAL` / `CUSTOM`) with the same semantics as expenses; individual savings show the owner's name as a blue chip in the table
- **Savings categories** — savings entries can be assigned an optional category (Vacation, Renovation, Rainy Day Fund, General) displayed as an icon + name badge in the table
- **Unified Category model** — `ExpenseCategory` is generalised into a single `Category` table with a `categoryType` discriminator (`EXPENSE` | `SAVINGS`); new category types can be added in future without a new table
- **Default savings categories** — four system-wide savings categories seeded on first boot: Vacation (Plane), Renovation (Hammer), Rainy Day Fund (Umbrella), General (PiggyBank)
- **CategoriesPage split by type** — the household categories page now renders two sections (Expense categories / Savings categories); the "New category" button in each section defaults to the correct type
- **Dashboard savings splits** — `memberSplits` in the summary API now includes `monthlySavingsSharedOwed`, `monthlySavingsIndividualOwed`, `monthlySavingsCustomOwed`, and `monthlySavingsTotalOwed`
- **"Custom split" badge on expense and savings rows** — purple pill shown in the table for entries using custom % split

### Changed
- `Expense` schema: added `ownership ExpenseOwnership @default(SHARED)` and `customSplits ExpenseCustomSplit[]`
- `SavingsEntry` schema: added `ownership`, `ownedByUserId`, `categoryId`, and `customSplits SavingsCustomSplit[]`
- Dashboard `memberSplits`: added `monthlyCustomOwed` for expenses alongside existing `monthlySharedOwed` / `monthlyIndividualOwed` / `monthlyTotalOwed`
- Budget-year copy preserves custom splits for both expense and savings entries
- Categories API: `GET /categories` accepts optional `?type=EXPENSE|SAVINGS` query parameter; `_count` now covers both `expenses` and `savingsEntries`

---

## [0.24.0] - 2026-03-26 — Individual expenses

### Added
- **Individual expense ownership** — expenses can now be assigned to a specific household member via an optional "Assigned to" dropdown in the add/edit form; unassigned expenses remain shared (split by income %)
- **Owner badge on expense rows** — individual expenses display the owner's name as a blue chip in the expenses table
- **Per-member split breakdown on dashboard** — the member expense splits table now shows three columns: Shared owed (proportional split of shared pool), Individual (expenses assigned solely to that member), and Total owed

### Changed
- `Expense` schema: added `ownedByUserId String?` with a `SetNull` foreign key to `User`; all existing expenses default to `null` (shared)
- Dashboard API `memberSplits` response shape: replaced `monthlyExpensesOwed` with `monthlySharedOwed`, `monthlyIndividualOwed`, and `monthlyTotalOwed`
- Expense API (`POST`/`PUT`) validates that `ownedByUserId`, when provided, is an actual member of the household; returns 400 otherwise

---

## [0.23.0] - 2026-03-26 — Currency selection for expenses, salary & bonuses

### Added
- **Currency selector for salary records** — salary form now has a currency dropdown; gross/net amounts are stored in the chosen currency alongside the exchange rate; `getJobMonthlyIncome` converts to base currency for all income calculations
- **Currency selector for bonuses** — bonus form has the same currency dropdown with a live base-currency preview
- **Auto-sync currencies on first boot** — API syncs 31 currencies from Danmarks Nationalbank on startup if the `CurrencyRate` table is empty, so the expense/savings/income currency dropdowns have options without requiring a manual admin trigger
- **Edit & delete salary records** — each salary record in the history modal now has Edit and Delete buttons; editing pre-fills the form inline with a Cancel action

### Changed
- `SalaryRecord` schema: added `currencyCode String?` and `rateUsed Decimal?(18,6)`
- `Bonus` schema: added `currencyCode String?` and `rateUsed Decimal?(18,6)`
- Salary history table shows a Currency column
- Both salary and bonus forms show a "≈ X {base} " live preview when a foreign currency is selected

---

## [0.22.0] - 2026-03-26 — Sprint 22: Visual Identity & Polish

### Added
- **Design tokens in `tailwind.config.js`** — registered semantic color tokens (`brand.primary`, `brand.primary-hover`, `surface.base`, `surface.raised`, `surface.overlay`) with inline comments; existing Tailwind class names remain valid, tokens can be adopted incrementally (UX-018)
- **Favicon** — SVG skull-and-crossbones favicon at `apps/web/public/favicon.svg` displayed in the browser tab (UX-019)
- **Open Graph meta tags** — `og:title` and `og:description` added to `index.html` for link previews (UX-019)

### Changed
- **Browser tab title** — changed from "Personal Budgeteer" to "Budgeteer" in `index.html` (UX-019)
- **On-brand empty state copy** — replaced generic placeholder text across 10+ locations with pirate-flavored alternatives (UX-020):
  - "No households yet" → "No crews assembled yet"
  - "No savings entries yet" → "No gold stashed yet"
  - "No budget years yet" → "Your treasure chest is empty — no budget years yet"
  - "No simulations." → "No simulations charted."
  - "No custom categories yet" → "Uncharted territory — no custom categories yet" (CategoriesPage & CategoriesAdminPage)
  - "No expenses yet." → "No plunder recorded yet." (ExpensesPage & DashboardPage)
  - "No expenses match the filter" → "No plunder matches the filter" (ExpensesPage & ComparePage)
  - "No budget years recorded yet" → "No voyages logged yet" (HistoryPage)
  - "No jobs yet" → "No work on the horizon yet" (IncomePage)
  - "No households yet." → "No crews on the seas yet." (HouseholdsAdminPage)

---

## [0.21.0] - 2026-03-26 — Sprint 21: Consistency Pass

### Added
- **`CategoryFilter` component** — reusable pill-based multi-select for category filtering (`apps/web/src/components/CategoryFilter.tsx`); replaces the single `<select>` dropdown on ExpensesPage and extracts the inline pill filter from ComparePage (UX-017)
- **`PageHeader` in-page title component** — repurposed from nav bar to a title section with `title`, `subtitle`, and `action` slot; applied to all feature pages: Expenses, Categories, Budget Years, Savings, Household Income, Compare, History, Personal Income, Profile, and Households (UX-014)

### Changed
- **`Modal` size prop** — replaced freeform `maxWidth` string with typed `size` enum (`sm | md | lg`); confirmation dialogs use `sm`, standard forms use `md`, complex forms use `lg`; all modal usages across 7 pages updated (UX-016)
- **`inputClass` consolidated** — added `text-sm` to shared definition in `lib/styles.ts`; removed local redeclarations from LoginPage, ProfilePage, ChangePasswordPage, IncomePage, UsersPage (UX-015)
- `HouseholdsPage` (root `/`) now wrapped in `GlobalLayout` for a consistent header with logo and user menu
- ExpensesPage category filter upgraded from single-select dropdown to multi-select `CategoryFilter` pills

---

## [0.20.0] - 2026-03-26 — Sprint 20: Navigation Clarity & Routing

### Added
- **`GlobalLayout`** — shared header (logo + "← Back to household" link using `HouseholdContext` + user menu) wrapping `/`, `/income`, `/profile`, `/change-password`; replaces per-page `<PageHeader />` nav bars (UX-011)
- **`AdminLayout`** — shared admin header (logo + nav: Users / Households / Categories with active states) wrapping all 3 admin pages; consolidates the 3 different inline headers that existed before (UX-012)
- **`NotFoundPage`** — pirate-themed 404 page replacing the silent `<Navigate to="/" replace />` catch-all; includes a link back to home (UX-013)

### Changed
- Sidebar nav label: `Income` → `Household Income`; header link: `My income` → `Personal Income` to distinguish the two income pages (UX-010)
- Admin pages (`UsersPage`, `HouseholdsAdminPage`, `CategoriesAdminPage`) — inline headers removed; now rendered by `AdminLayout`
- Standalone personal pages — `<PageHeader />` nav bar removed from `IncomePage`, `ProfilePage`, `ChangePasswordPage`; header provided by `GlobalLayout`

---

## [0.19.0] - 2026-03-26 — Sprint 19: UX/UI Polish & Consistency

### Added
- **Shared style primitives** — `lib/styles.ts` exports `inputClass`, `selectClass`, `primaryBtn`, `secondaryBtn`, `dangerBtn` for consistent form and button styling across pages (UX-002)
- **`LoadingSpinner` / `PageLoader`** — shared spinner component; replaces all inline "Loading…" text across the app (UX-004)
- **`Modal` portal component** — shared `<Modal>` with Escape-to-close and click-outside-to-close; all inline modals replaced (UX-003)
- **`PageHeader` component** (later evolved in Sprint 21) — initial extraction for standalone pages (UX-006)
- **Sonner toast notifications** — `<Toaster>` wired in `App.tsx`; `toast.success` added to all create/update/delete mutations (UX-002)
- **Mobile sidebar hamburger** — `HouseholdLayout` gains a `<Menu>` button and overlay drawer on small screens (UX-008)

### Changed
- All destructive actions in HouseholdPage and IncomePage (close job, delete bonus/override, remove member) now show a confirmation dialog before proceeding (UX-001)
- Hover-only action buttons (ExpensesPage, SavingsPage) fixed to use `opacity-0 md:group-hover:opacity-100` (UX-005)
- Sort icons in HistoryPage and ExpensesPage replaced from `▲▼` characters to Lucide `ChevronUp`/`ChevronDown` (UX-007)
- Allocation dirty-state tracking, Save button, and 100% cap validation added to IncomePage allocation grid (UX-009)

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
