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
- **React Router v7** — client-side routing
- **Recharts** — budget visualisations
- **D3 / Sankey** — income and receipt consumption flow diagrams

### Visual identity (Chart & Ledger)
- **Colour tokens**: `src/index.css` defines RGB-channel ramps as CSS variables — `sea` (neutrals), `brass` (primary actions, your money), `port` (deficit, destructive), `starboard` (surplus, success), `slate` (savings, info), `plum` (custom splits), `lantern` (warnings, needs attention). `tailwind.config.js` points Tailwind's `gray`, `amber`, `red`, `green`/`emerald`, `blue`, `purple` and `orange` scales at them, so existing classes use the palette and a light theme can redefine the variables.
- **Type**: self-hosted with `@fontsource` (no third-party font requests) — Schibsted Grotesk (`font-sans`, interface), Libre Caslon Display (`font-display`, page titles and headline figures), Libre Caslon Text italic (`font-serif`, the pirate voice, sparingly), IBM Plex Mono (`font-mono`, labels, column heads, currency codes). Latin subsets only.
- **Light and dark themes**: Night watch (dark) is the default; Day chart (light) redefines the same variables. Light ramps keep each step's role (950 page, 900 cards, 800 borders, 400 secondary text, 100 primary text), so they run the other way and components need no `dark:` variants; Tailwind's `white` is a variable too (white in dark, ink in light) because it is used as primary text — use `#fff` literally only where white must stay white (avatar initials, switch knobs). Chart colours (`lib/charts.ts`) are CSS-variable strings (`--series-1..6`, sea steps), so charts follow the theme; don't append hex alpha to them. Profile → Appearance offers System / Day chart / Night watch, stored per browser in `localStorage` (`budgeteer.theme`, `lib/theme.ts`) and applied by a small script in `index.html` before the first paint; System uses `prefers-color-scheme`, a choice sets `data-theme` on `<html>`. Toasts follow the same choice.
- **One meaning per colour**: brass (`amber-*`) is only for primary actions and money you act on (the transfer due, your share); figures and totals use neutral ink; warnings use lantern (`orange-*`); selected filters and toggles use the neutrals.
- **Components** (`lib/styles.ts`): primary (brass, dark text), secondary (outlined), danger (port outline with a faint fill) buttons with a shared keyboard focus ring; inputs on an inset background; segmented toggles as an inset track with the active option raised. `StatusBadge` adds a shape marker per budget-year status (filled dot active, ring future, diamond simulation, square retired) so status reads without colour.
- **Voice**: headlines, labels and buttons say plainly what happens; the pirate voice goes in secondary lines. `components/EmptyState.tsx` renders a plain title, an optional italic Caslon `aside` for the pirate line, and the next action.
- **Brand mark**: `components/BrandMark.tsx` (compass-rose doubloon, `currentColor`) in the header, footer and login page; `public/favicon.svg` is the same mark.
- **Chart colours** (`lib/charts.ts`): one categorical palette of six colours in a fixed order, checked for colour-vision-deficiency separation — assign in order, and anything past the sixth series uses the neutral `SERIES_REST`. `ENTITY` fixes colours per thing (income teal, expenses brass, savings slate, surplus sage, bonuses plum); `chartChrome` gives every Recharts chart the same grid, axis, tooltip and legend styling. No hex colours outside `lib/charts.ts` and the avatar palette.

### App shell and breakpoints
- **`layouts/AppShell.tsx`** is the frame for all signed-in areas. `HouseholdLayout`, `GlobalLayout` (personal pages) and `AdminLayout` only pass it their navigation, header content and phone tab-bar setup.
- **Size classes**: below 640px a bottom tab bar (optional centre quick action, "More" opens the full menu as a drawer); 640–1023px a 64px icon rail; from 1024px a 224px sidebar (248px from 2200px), which users can collapse to the rail (stored per browser in `localStorage`, `budgeteer.sidebarCollapsed`).
- **Tailwind screens**: the defaults plus `wide` (1440px) and `ultra` (2200px), for detail panes and 4K layouts.
- **Page scrolling** happens in the shell's content area, not the window; it resets to the top on every route change. The content area is `relative`, so absolutely positioned page content can't widen the document.
- **Quick add from the tab bar**: Expenses and Savings open their add form for `?add=1` (`hooks/useAddFromQuery.ts`).
- **Page templates**: every page inside the shell renders `<Page template=…>` (`components/Page.tsx`) instead of its own `max-w-* mx-auto px-6 py-8` wrapper. The template sets width and gutters (16 → 24 → 28 → 36px across the size classes):
  - `dashboard`: household and personal dashboards — full width
  - `list`: expenses, savings, receipts, trash, categories, budget years, personal income, admin tables — full width
  - `analysis`: history, compare, household income — full width
  - `form`: profile, household settings, change password, new receipt — 56rem, centred
- **Container queries** (`@tailwindcss/container-queries`): components that sit in variable-width cells style themselves by their own width (`@container` + `@xl:…`), not the viewport.
- **Dashboard widget grid** (`components/WidgetGrid.tsx`): the household and personal dashboards are a `<WidgetGrid>` of `<Widget span={{ 2, 3, 4, 6 }}>` tiles. The grid has 1 column, then 2 from 600px, 3 from 960px, 4 from 1400px and 6 from 2200px of its own width, and packs rows densely; each widget sets how many columns it spans at each count. A widget whose content renders nothing takes no cell. Widget content fills the cell height, so tiles in a row line up; long lists (the dashboard expense list) scroll inside their tile instead of stretching the row.
- **Dashboard month hero** (`pages/dashboard/MonthHero.tsx`): the household dashboard's first widget, spanning the grid, in a graduated chart-frame border (`.chart-frame` in `index.css`). It shows the surplus and the income split bar (`incomeSplit` from the summary), the next pending transfer with Mark as paid, and the income flow Sankey (`buildIncomeSankey` over `incomeFlow` from the summary). `PaymentsTimeline` (the month's payments from `/budget-years/:id/payments` as dots on a 1–N day line, with a "No set day" list and a List view) is no longer rendered on the dashboard; the component, `useMonthPayments` and the endpoint remain.
- **List tables** (`components/DataTable.tsx`): Expenses, Savings, Trash and the admin pages (users, households, currencies, categories) render a `DataTable` from column definitions. Each column has a priority and appears by the table's own width (1 always, 2 from 520px, 3 from 780px, 4 from 1150px, 5 from 1500px); a hidden column's `summary` shows under the row label instead, so tables have no minimum width and phones never scroll sideways. It also handles sorting, row selection for bulk edit, per-column footers and hover-revealed row actions (always visible on touch screens).
- **Detail pane** (`components/DetailPane.tsx`): from 1440px, clicking an expense or savings row opens it in a side pane beside the list (`ListWithDetail` + `DetailPane`); below that, a click opens the edit form. The selection is kept in `?selected=` (`useDetailSelection`). Pane content only displays API values — no calculations.
- **Dialogs** (`components/Modal.tsx`): below 640px every `Modal` (and `ConfirmDialog`, which builds on it) is a bottom sheet — full width, anchored to the bottom edge with the safe-area inset, title bar pinned while the content scrolls; from 640px it is a centred dialog. The dialog is a container, so form grids inside add columns with `@sm:`/`@xl:` only when the dialog is wide enough. It has `role="dialog"`, moves focus inside on open and returns it on close. The two hand-built overlays (Mark as Paid, automation run history) follow the same sheet layout.
- **Save bar** (`components/StickyActions.tsx`): a form's Save / Cancel row stays in view while a long form scrolls. `variant="dialog"` pins it to the bottom edge of a `Modal` at every size (forms inside a Modal must not add their own scroll box); `variant="page"` pins it above the phone tab bar and is a normal row from 640px. The shell's phone scroll padding equals the tab bar's height, so page bars sit directly on top of it.
- **Filter column** (`components/FilterColumn.tsx`): from 2200px, Expenses and Savings show their filters as a column left of the list (`FilteredList` with category/account facets and row counts); below that the filter chips above the list are used instead (`ultra:hidden`).
- **Hidden table headers** (e.g. the Actions column) put the `sr-only` text in a span inside a `relative` `<th>`; an `sr-only` class on the `<th>` itself escapes the table's scroll wrapper and makes phones scroll sideways.

### Installable app (PWA)
- **Manifest** (`public/manifest.webmanifest`, linked from `index.html`): standalone display, night-sea theme and background colours, icons in `public/icons/` (192 and 512 px, a maskable 512 px with the mark inside the 80% safe zone, and a 180 px `apple-touch-icon`). The PNGs are drawn from the `favicon.svg` mark. `screenshots` (phone `narrow` and desktop `wide`, demo data, in `public/screenshots/`) give Chrome its richer install dialog; their `sizes` must match the files.
- **Offering the install** (`lib/install.ts`, imported first in `main.tsx`): keeps Chrome/Edge's `beforeinstallprompt` event (and prevents the mini-infobar) so the app's own button can open the install dialog; `appinstalled` and `display-mode: standalone` tell it the app is installed. `useInstallState()` gives `installed`, `canPrompt`, `showIosSteps` (iPhone/iPad in the browser, where there is no install event, so the Share → Add to Home Screen steps are shown) and `hintDismissed`. UI in `components/InstallApp.tsx`: "Install app" at the bottom of the sidebar and the phone menu (only while `canPrompt`), a one-time dismissible hint above the page on phones (dismissal stored per browser in `localStorage`, `budgeteer.installHintDismissed`), and an "App" row in Profile → Preferences.
- **Service worker** (`public/sw.js`, registered in `main.tsx` in production builds only): precaches the self-contained `offline.html` and serves it when a page navigation can't reach the server. Navigations are always network-first, so a deploy shows up at once. It handles no other requests: `/api/` and `/uploads/` are never cached (no budget data or auth responses on the device), and hashed `/assets/` rely on the browser's HTTP cache. Bump `CACHE` in `sw.js` when the precached page changes. A later Web Push channel adds its `push` / `notificationclick` handlers here.
- **Same origin**: the installed app talks to `/api` through the same nginx as the browser, so the `SameSite=Strict` refresh cookie and the auth flow are unchanged.
- **Requires HTTPS** (or `localhost`): browsers only install and run service workers in a secure context; on plain HTTP the app still works in a tab.
- **nginx**: `manifest.webmanifest` gets `application/manifest+json` (missing from nginx's `mime.types`); it and `sw.js` are `no-store` like the other root files.

### Backend
- **Node.js + TypeScript** — runtime
- **Fastify** — API framework
- **Prisma ORM** — type-safe database access and migrations
- **PostgreSQL** — primary database
- **Zod** — runtime validation and shared types
- **JWT + Refresh Tokens** — stateless auth
- **node-cron** — scheduled jobs: budget-year lifecycle (daily 00:05, and at startup), expired refresh-token purge (daily 00:10), automatic transfer marking (daily 00:15, and at startup), reminder digests (every 15 minutes), notification delivery purge (daily 00:20), monthly transfer automation (1st of the month, 00:00), currency rate sync (daily 06:00)
- **@anthropic-ai/sdk** — AI-assisted payslip parsing (optional; requires `ANTHROPIC_API_KEY`)
- **Local OCR** — server-side receipt OCR uses Tesseract for images and Poppler `pdftoppm` for scanned PDFs inside the API container
- **Local AI HTTP provider** — optional receipt cleanup and opt-in line categorization enhancement (requires `LOCAL_AI_BASE_URL` + `LOCAL_AI_MODEL`; categorization also requires `RECEIPT_AI_CATEGORIZE=true`; receipt data must not be sent to hosted AI services)

### Infrastructure
- **Docker + Docker Compose** — single-command self-hosted setup (`deploy/`) with published images; the API image uses a multi-stage build so TypeScript compilation, Prisma generation, and build-only dependencies stay out of the runtime image, and has a `/health` healthcheck the web container waits for.
- **CI** (`.github/workflows/ci.yml`) — typecheck, lint, tests, builds, and migrations against an empty Postgres on every PR; `docker-publish.yml` runs it before building, pushing and Trivy-scanning the images.
- **Versioning** — the product version is the `version` in the repo-root `package.json`; the API's `/health` and the web footer read it. Bump it (and the `CHANGELOG.md` heading) when releasing.

### Runtime Configuration
- **API rate limiting** — Fastify global rate limiting is enabled by default and controlled by `API_RATE_LIMIT_ENABLED`, `API_RATE_LIMIT_MAX`, and `API_RATE_LIMIT_WINDOW`. The Docker development stack sets `API_RATE_LIMIT_ENABLED=false` because local browser traffic can produce many same-origin API calls through one proxy/client address.
- **Container schema sync** — the API entrypoint uses `SCHEMA_SYNC_MODE` on startup. `push` runs non-destructive Prisma schema sync, `migrate` runs committed migrations (the image ships `prisma/migrations`), `skip` leaves the database untouched, and `force-push` is the explicit opt-in for Prisma `--accept-data-loss`. The Docker image runs the precompiled seed script at startup instead of keeping `ts-node` and TypeScript in the runtime layer.
- **Migration history** — `prisma/migrations/` starts from a single `20260928000000_baseline` migration generated from the full schema (earlier incremental migrations could not build a fresh database). CI applies all migrations to an empty Postgres and fails if they drift from `schema.prisma`. An existing database that was kept in sync with `push` can switch to `migrate` by marking the baseline as applied once: `npx prisma migrate resolve --applied 20260928000000_baseline`.
- **Client IP / proxies** — Fastify trusts `X-Forwarded-For` from `TRUST_PROXY` (default `loopback,uniquelocal`: loopback and private networks, i.e. the nginx container and any LAN reverse proxy in front of it). nginx forwards `X-Forwarded-For`/`X-Real-IP`, so rate limits apply per real client instead of to the whole instance. Clients on private networks can set the header themselves; set `TRUST_PROXY` to the proxy's exact address (or `false`) to rule that out.
- **Image builds behind TLS-intercepting proxies** — both Dockerfiles accept an optional BuildKit secret `extra_ca` (a PEM root CA) used only during `npm ci`, `apk add` and Prisma engine downloads; it is never written to an image layer. Certificate verification is never disabled. The API image fetches Prisma's schema engine at build time, so container start needs no network access.
- **API error responses** — a global Fastify error handler (`apps/api/src/lib/errors.ts`) maps Prisma not-found/unique/foreign-key errors to 404/409, keeps 4xx framework errors (validation, rate limit, body parsing), and returns a generic `{ error, code: "INTERNAL_ERROR" }` for anything else so internals never reach the client.

---

## Project Structure

```
budgeteer/
├── apps/
│   ├── web/                 # React frontend (Vite)
│   │   ├── public/          # favicon, PWA manifest, icons/, screenshots/, service worker, offline page
│   │   └── src/
│   │       ├── api/         # Axios client, shared API types, query keys and query hooks
│   │       ├── pages/       # route screens, larger ones as folders (income/, expenses/, receipts/, …)
│   │       ├── components/  # shared UI (Modal, ConfirmDialog, AccountSelect, …)
│   │       ├── contexts/ hooks/ layouts/ lib/
│   └── api/                 # Fastify backend
│       ├── src/routes/      # REST route modules
│       ├── src/lib/         # domain logic (calculations, income, transfers, receipts, sessions, …)
│       ├── src/plugins/     # authenticate / requireAdmin
│       └── scripts/         # receipt image preprocessing (Python/Pillow)
├── prisma/                  # schema.prisma, migrations/, seed.ts, receipt training CSV
├── docker/                  # Dockerfile.api, Dockerfile.web, nginx.conf, entrypoint.sh
├── deploy/                  # docker-compose.yml, docker-compose.omv.yml (published images)
├── docs/                    # this file, review notes
└── docker-compose.dev.yml   # full stack from source
```

---

## Data Model

### Entities

**users** — system accounts
- id, email, name, passwordHash, role (`SYSTEM_ADMIN` | `BOOKKEEPER` | `USER`), isActive, isProxy, mustChangePassword, avatarUrl, failedLoginAttempts, lockedUntil, sessionsValidAfter

**user_preferences** — per-user settings (1:1 with user)
- userId, defaultHouseholdId, preferredCurrency, notifyOverAllocation, notifyExpensesExceedIncome, notifyNoSavings, notifyUncategorised, showDashboardSparklines
- Payment reminders: reminderInApp, reminderEmail, reminderEmailAddress (nullable; null = login email), reminderWebhook, reminderWebhookUrl (nullable), reminderWebhookFormat (`NTFY` | `JSON`), reminderWebhookSecretEncrypted (nullable), reminderLeadDays (nullable; null = household default), reminderDigestTime (HH:MM, default 08:00)

**households** — shared budget spaces
- id, name, isActive, budgetModel (`AVERAGE` | `FORWARD_LOOKING` | `PAY_NO_PAY`)
- transferPaymentMethod (`AUTOMATIC` | `MANUAL`, default MANUAL), transferDueDay (1–31, default 1) — how and when the monthly transfer into the budget account is made

**household_members** — many-to-many users ↔ households
- householdId, userId, role (`ADMIN` | `MEMBER`)

**budget_years** — one budget per year per household; multiple simulations allowed
- householdId, year (int), status (`ACTIVE` | `FUTURE` | `RETIRED` | `SIMULATION`)
- simulationName (nullable), copiedFromId (self-referencing, nullable)

**jobs** — a user's employment record; income is modelled per job
- userId, name, employer (nullable), country (default: DK), startDate, endDate (nullable)

**salary_records** — salary history for a job
- jobId, grossAmount, netAmount, effectiveFrom, currencyCode (nullable), rateUsed (nullable)
- payslipLines (JSON, nullable), pensionEmployerMonthly (nullable), deductionsSource (nullable)
- Active salary for any month = most recent record where `effectiveFrom <= that month`

**monthly_income_overrides** — one-off overrides for a specific month
- jobId, year, month, grossAmount, netAmount, note
- payslipLines (JSON, nullable), pensionEmployerMonthly (nullable), deductionsSource (nullable)
- Takes precedence over the default salary record for that month

**bonuses** — additional payments on a job
- jobId, label, grossAmount, netAmount, paymentDate, includeInBudget, budgetMode (`ONE_OFF` | `SPREAD_ANNUALLY`), currencyCode (nullable)

**tax_card_settings** — Danish tax card configuration per job
- jobId, effectiveFrom, traekprocent, personfradragMonthly, municipality (nullable)
- pensionEmployeePct (nullable), pensionEmployerPct (nullable), atpAmount (nullable), bruttoItems (JSON, nullable)
- Active settings for any month = most recent record where `effectiveFrom <= that month`

**household_income_allocations** — user allocates % of a job's income to a budget year
- jobId, budgetYearId, allocationPct
- Warning (not block) if total allocation across households exceeds 100%

**categories** — expense or savings classification; system-wide or household-custom
- name, icon, categoryType (`EXPENSE` | `SAVINGS`), isSystemWide, isActive, householdId (null if system-wide), createdByUserId
- Household members can create custom categories; system admins can promote them system-wide
- Inactive categories are hidden from new entries but remain on historical records

**accounts** — bank, credit card, or mobile pay accounts
- name, type (`BANK` | `CREDIT_CARD` | `MOBILE_PAY`), isActive
- ownedByUserId (nullable) — personal account linked to a user
- householdId (nullable) — household-level account shared across members
- Expenses and savings entries can be linked to an account

**expenses** — recurring expenses on a budget year
- budgetYearId, categoryId, label, amount, frequency, frequencyPeriod, startMonth, endMonth, monthlyEquivalent, forwardMonthlyEquivalent, notes
- dueDay (nullable, 1–31) — day of the month it's paid, for the dashboard's payments timeline; days past a month's end fall on its last day; ignored for WEEKLY/FORTNIGHTLY
- paymentMethod (`AUTOMATIC` | `MANUAL`, default AUTOMATIC) — how it's paid; in PAY_NO_PAY households only MANUAL items are listed to tick off, AUTOMATIC ones are marked paid at month close
- ownership (`SHARED` | `INDIVIDUAL` | `CUSTOM`), ownedByUserId (nullable), accountId (nullable)
- currencyCode (nullable), originalAmount (nullable), rateUsed (nullable), rateDate (nullable)

**expense_custom_splits** — per-member percentage splits for CUSTOM ownership expenses
- expenseId, userId, pct (must sum to 100%)

**expense_occurrences** — individual occurrence tracking for a recurring expense
- expenseId, year, month, scheduledAmount, carriedAmount, status (`PENDING` | `PAID` | `SKIPPED` | `DISMISSED`), dismissReason (`PAID_ELSEWHERE` | `SKIPPED`, nullable)
- paidAt (nullable), actualAmount (nullable), note (nullable)

**receipts** — actual consumption imports from scanned receipts/photos
- householdId, uploadedByUserId, accountId (nullable), merchantName, purchaseDate, totalAmount (sum of line items), printedTotal (TOTAL printed on the receipt), taxAmount, feeAmount, currencyCode
- sourceMimeType, sourceFileName, sourceStoragePath, sourceFileSize, rawText, status (`DRAFT` | `CONFIRMED` | `FAILED`), confidence (`LOW` | `MEDIUM` | `HIGH`), notes, confirmedAt, deletedAt
- Receipts are actual consumption data and must not create or update planned `expenses`
- Receipt parsing uses the currency found in OCR/AI output when present and falls back to the configured household/base currency
- Receipt totals are derived from the sum of non-ignored receipt line items, including lines added manually during review
- Receipt summaries can be filtered by all time, current/previous month, current/previous quarter, current/previous year, last 12 calendar months, or custom date range; dashboard and receipt-page totals convert receipt line amounts to `BASE_CURRENCY` with the latest enabled currency rates
- Uploaded receipt files are stored locally on the API server under `UPLOAD_DIR/receipts/<householdId>/` and served only through authenticated household-scoped endpoints
- Deleted receipts are soft-deleted with `deletedAt` so consumption history can be preserved

**receipt_line_items** — individual purchases extracted from a receipt
- receiptId, categoryId (nullable), subcategoryId (nullable), originalText, label, normalizedLabel, quantity, amount, currencyCode, confidence, sortOrder, isIgnored
- Category mappings point to active `EXPENSE` categories visible to the household, with optional receipt subcategories for lower-level consumption classification
- Ignored line items are retained but excluded from consumption summaries

**receipt_subcategories** — lower-level receipt classifications under expense categories
- categoryId, householdId (nullable), name, isSystemWide, isActive
- System defaults are seeded under top-level expense categories. Day-to-day receipt shopping defaults to `Shared Household Spending`, with lower-level subcategories such as Groceries, Dairy, Bread & Bakery, Meat, Fish & Seafood, Vegetables, Fruit, Pantry, Condiments, Paper goods, Cleaning, Personal care, Baby care, Pets, Clothing, Gifts, and Pharmacy. More specific high-level categories such as Transport, Utilities, Healthcare, and Subscriptions remain available for expenses that are not shared shopping.
- Household members can add household-specific subcategories under any expense category visible to the household

**receipt_category_mappings** — system defaults and learned household-specific categorization hints
- scopeKey (`system` or household id), householdId (nullable), normalizedLabel, merchantKey, categoryId, subcategoryId (nullable), confidence, hitCount, lastUsedAt
- System mappings ship as global defaults and may only target system-wide expense categories/subcategories
- Household mappings are learned on confirmation or household CSV import, may target household-visible categories/subcategories, and override matching system mappings
- Can be trained in bulk through a household-scoped CSV workflow that exports the category catalog, global/household mapping context, and an LLM-ready prompt, then previews and confirms validated CSV rows without creating categories

**receipt_classifier_terms** — configurable receipt parsing and matching vocabulary
- scopeKey (`system` or household id), householdId (nullable), termType (`NOISE_TOKEN` | `LOW_VALUE_WORD` | `OCR_ALIAS`), term, isActive, source, hitCount, lastSeenAt
- System terms seed default package/OCR noise, low-value receipt words, and OCR spelling aliases such as `totlet=>toilet`; household terms can extend or override them through CSV import
- Future confirmed receipt reviews update learned household term observations; repeated learned terms become active only after recurring evidence to avoid trusting one-off OCR mistakes

**savings_entries** — planned savings on a budget year
- budgetYearId, label, amount, frequency, frequencyPeriod, monthlyEquivalent, forwardMonthlyEquivalent, notes
- dueDay (nullable, 1–31), paymentMethod — as on expenses
- ownership (`SHARED` | `INDIVIDUAL` | `CUSTOM`), ownedByUserId (nullable), accountId (nullable), categoryId (nullable)
- currencyCode (nullable), originalAmount (nullable), rateUsed (nullable), rateDate (nullable)

**savings_custom_splits** — per-member percentage splits for CUSTOM ownership savings
- savingsEntryId, userId, pct (must sum to 100%)

**savings_occurrences** — individual occurrence tracking for a recurring savings entry
- savingsEntryId, year, month, scheduledAmount, carriedAmount, status (`PENDING` | `PAID` | `SKIPPED` | `DISMISSED`), dismissReason (`PAID_ELSEWHERE` | `SKIPPED`, nullable)
- paidAt (nullable), actualAmount (nullable), note (nullable)

**budget_transfers** — monthly inter-member transfer snapshots
- budgetYearId, year, month, calculatedAmount, actualAmount (nullable), status (`PENDING` | `PAID` | `ADJUSTED`)
- calculatedAt, paidAt (nullable), automationRunId (nullable)
- One record per budget year per month; recalculated (awaited) when income, expenses, savings or FX rates change
- PAY_NO_PAY: a month's amount is everything due that month (scheduled + carried) across PENDING and PAID occurrences, so paying items doesn't shrink it; closed months keep their recorded amount
- AUTOMATIC transfers (a standing order) are marked PAID at `calculatedAmount` once their due day comes (`runTransferAutoPay`, planned by `planTransferAutoPay`): daily, at startup, and when a household switches to automatic or changes the due day, catching up on earlier PENDING months. MANUAL transfers are listed on the to-pay list (this month's, plus unpaid earlier months) and ticked off with mark-paid / mark-pending

**Occurrences and the to-pay list** (`expense_occurrences`, `savings_occurrences`)
- Seeded from the current month through December on every recalculation (`syncOccurrences`); PENDING rows follow schedule changes (an edited expense updates its remaining months), PAID/SKIPPED/DISMISSED rows are history
- PAY_NO_PAY: a row for every entry, each month's share of it (`calcOccurrenceScheduledAmount`); the rows drive the transfer and carry unpaid balances
- AVERAGE / FORWARD_LOOKING: rows only for MANUAL entries, the bill as charged that month (`trackingScheduledAmount`: a quarterly bill in full in its months). Tracking only — their transfer calculation never reads occurrences. Unpaid rows are never closed; they stay on the list as overdue until ticked off or dismissed
- The to-pay list (`GET /budget-years/:id/occurrences`) shows MANUAL items in every model; for the current month it also lists overdue PENDING items from earlier months of the budget year. PENDING rows with nothing due are placeholders and aren't listed (`isListable`)
- Members mark MANUAL items PAID one by one or all at once (`actualAmount` = amount due; "mark all" for the current month includes overdue items), or DISMISS them as paid elsewhere or skipped; dismissed items count as done, are never carried over, and still count in a PAY_NO_PAY month's transfer. AUTOMATIC items aren't listed and can't be toggled (409 `OCCURRENCE_AUTOMATIC`)
- Switching budget model rewrites no history: PAY_NO_PAY adopts existing rows (re-syncing PENDING amounts), and the other models keep their manual rows
- Month rollover (1st of the month automation) closes the previous month (`closePayNoPayMonth`, planned by `planMonthClose`): PENDING AUTOMATIC → PAID with the full amount due, PENDING MANUAL → SKIPPED, and each closed item's unpaid balance becomes `carriedAmount` on next month's row. Carry is derived from the closed rows, so re-running is idempotent. Switching an entry's payment method rewrites no rows; the next close applies it
- At the year boundary December is closed without carry — the new year's expenses are separate rows

**currencies** — admin-managed catalog of available currencies
- code (PK), name, isEnabled
- Disabled currencies are hidden from user-facing currency selectors

**currency_rates** — time-series exchange rates fetched from Danmarks Nationalbank
- currencyCode, rate (relative to BASE_CURRENCY), baseCurrency, fetchedDate
- New rows appended daily; queries use `DISTINCT ON` to get the latest rate per currency
- Past expense/savings rates are locked at `rateDate` using the stored rate on or before the payment period (`frequencyPeriod`); unlocked ones are re-priced at the latest rate on each daily sync, using the same `calcMonthlyInBase` as save-time (partial-year average included). RETIRED years are never rewritten
- A locked rate is kept on edit only while the currency is unchanged; switching currency unlocks and uses the latest rate

**Reminders for manual payments** (`lib/reminders.ts` rules, `lib/reminderItems.ts` loader, `lib/reminderDigests.ts` sending)
- Items: PENDING manual expense/savings occurrences and PENDING manual household transfers of each ACTIVE budget year, up to next month. Due date = the entry's due day in that month, clamped (weekly/fortnightly and no due day → the 1st); a transfer uses the household's transfer due day
- Stages: DUE_SOON within the lead time (the member's reminderLeadDays, else the household's leadDays), DUE_TODAY, OVERDUE. In-app (`GET /me/reminders`) anything past due is overdue; a digest sends OVERDUE once, 3 days after the due date
- Recipients: INDIVIDUAL → its owner; CUSTOM → members with a share above 0; SHARED (or an owner no longer a member) → every member; transfers → every member
- Digests: once a member's digest time (server time) has come, each channel sends at most one digest per member per day with only the stages not delivered before (`planDigest` against the delivery log), and only items of households whose settings let that channel reach the member. Failed deliveries are retried on later runs the same day, up to 5 attempts. Channels register in `activeChannels()`: email (`lib/channels/email.ts`, nodemailer, whenever an SMTP server is configured; the digest from `lib/digestEmail.ts` as plain text + HTML with links to the to-pay list and Profile) and ntfy/webhook (`lib/channels/webhook.ts`, whenever the install allows webhooks). Besides members, each household with a shared URL gets a digest of all its items (`remindersForHousehold`, recipient `household:<id>`, 08:00)
- In-app: the navigation badge (red when something is overdue) and the to-pay list's summary line come from `GET /me/reminders`

**Notification settings** (`lib/notificationSettings.ts`) — three levels, each narrowing the one above (`resolveChannels`): a channel reaches a member for a household's items only when the install, the household and the member all allow it and there's a destination (email: reminderEmailAddress or the login email; webhook: the member's URL). The household channel (`resolveHouseholdChannel`) is the household's shared webhook URL. Missing rows mean the defaults

**notification_settings** — install-wide, one row (`id` = "default"), system admins
- inAppEnabled (default true), emailEnabled (default false), webhookEnabled (default false), webhookAllowPrivateNetwork (default false)
- SMTP: smtpHost, smtpPort (default by security: 25 / 587 / 465), smtpSecurity (`NONE` | `STARTTLS` | `TLS`), smtpUsername, smtpPasswordEncrypted, smtpFromAddress, smtpFromName. Email can only be switched on once a host and sender are set (400 `SMTP_NOT_CONFIGURED`)
- The SMTP password is encrypted with AES-256-GCM (`lib/secretBox.ts`) under `SETTINGS_ENCRYPTION_KEY`, or a key derived from `JWT_SECRET` when that's unset; the API never returns it (`passwordSet` only)

**household_notification_settings** — per household (PK householdId), household admins
- inAppEnabled, emailEnabled, webhookEnabled (default true), webhookUrl (nullable; the household channel), webhookFormat (`NTFY` | `JSON`), webhookSecretEncrypted (nullable), leadDays (0–14, default 2)

**ntfy and webhooks** (`lib/channels/webhook.ts`, `lib/safeHttp.ts`)
- Guard: http(s) only, no credentials in the URL. Private, loopback, link-local and other special addresses are refused unless `webhookAllowPrivateNetwork`: checked when a URL is saved (IP literals, localhost; 400 `WEBHOOK_URL_NOT_ALLOWED`) and on every send against each address DNS returns, inside the connection's lookup (no rebinding). Redirects aren't followed; 10 s timeout; non-2xx is a failure
- Secrets (ntfy access token / signing secret) are encrypted like the SMTP password and never returned (`…SecretSet` only)
- ntfy: the topic URL `https://server/[path/]topic` is published as JSON to `https://server/[path]`: `{ topic, title, message, priority (4 when something is overdue, else 3), tags, click }`; a token goes in `Authorization: Bearer …`
- JSON webhook: `POST` with `Content-Type: application/json`, `X-Budgeteer-Timestamp: <unix seconds>` and, with a secret, `X-Budgeteer-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`. Receivers should recompute the HMAC over the raw body and reject old timestamps. Body:
  ```json
  {
    "type": "budgeteer.reminder_digest",
    "version": 1,
    "date": "2026-09-30",
    "recipient": { "kind": "member", "id": "…", "name": "Alice" },
    "summary": "2 payments to make by hand: 1 due today",
    "reminders": [
      {
        "key": "expense:…", "kind": "expense", "label": "Electricity", "amount": "270.00", "currency": "DKK",
        "dueDate": "2026-10-01", "stage": "DUE_SOON", "daysUntilDue": 1,
        "household": { "id": "…", "name": "The Smith Family" }, "url": "https://budget.example.com/households/…"
      }
    ]
  }
  ```
  Each reminder also has `markPaidUrl` (POST with no body marks it paid, once, within 14 days) and `markPaidPage` (the confirm page); null in test messages. `recipient.kind` is `household` for a household's shared URL; `stage` is `DUE_SOON` | `DUE_TODAY` | `OVERDUE`; `kind` is `expense` | `savings` | `transfer`. Test messages are `{ "type": "budgeteer.test", "version": 1, "message": "…" }`

**reminder_action_tokens** — Mark-as-paid links in reminders (`lib/reminderActions.ts`)
- tokenHash (SHA-256 of a 256-bit random token; the token itself is never stored), userId (nullable; null for a household's shared channel), itemKey (`expense:<occurrence id>` | `savings:<occurrence id>` | `transfer:<transfer id>`), householdId, expiresAt (14 days), usedAt
- One per reminder per digest. Emails link to the web page `/r/<token>`, which shows the item (`GET`, changes nothing, so link scanners are harmless) and marks it on confirm (`POST`); ntfy action buttons (up to 3) and the JSON webhook's `markPaidUrl` `POST` directly to `/api/reminder-actions/<token>`
- Redeeming claims the token first (`usedAt`, conditional update) so it works once, then applies the app's rules (`markItemPaid`): RETIRED years are read-only, automatic items are refused, closed (SKIPPED) months can't be marked, already paid or dismissed succeeds without change. A refused action releases the token. Rate-limited (GET 30, POST 20 per 15 minutes); expired tokens are purged a week after expiry

**notification_deliveries** — log of reminder digests sent or attempted
- recipientKey (`user:<id>` or `household:<id>`), userId / householdId (nullable), channel (`EMAIL` | `WEBHOOK`), date (YYYY-MM-DD), itemKeys (`<stage>:<item key>`), status (`SENT` | `FAILED`), attempts, error
- Unique per recipient, channel and date; rows older than 90 days are purged daily

**automations** — scheduled or manually-triggered household jobs
- householdId, key (unique per household), label, description, schedule (cron), isEnabled
- lastRunAt (nullable), lastRunStatus (nullable)

**automation_runs** — execution history for automations
- automationId, triggeredBy (`SCHEDULE` | `MANUAL`), triggeredByUserId (nullable)
- startedAt, finishedAt, status (`SUCCESS` | `ERROR` | `SKIPPED`), message (nullable)

**refresh_tokens** — refresh token store
- token (SHA-256 of the client's token; rows from before hashing may hold the raw value until rotated), userId, expiresAt, revokedAt
- Rotated tokens are marked `revokedAt` instead of deleted. Presenting one again after a 30-second grace window (concurrent tabs) is treated as theft and revokes all of the user's sessions. Expired tokens are purged daily

**Sessions**
- `users.sessionsValidAfter`: access tokens issued before it are rejected. Set (and all refresh tokens deleted) on password change, admin password reset, role change, deactivation, and conversion to a proxy user. `POST /users/me/change-password` returns a fresh `accessToken` and sets a new refresh cookie so the current client stays signed in
- `authenticate` reads the user on every request: role comes from the database (demotions apply immediately), deactivated users are rejected, and `mustChangePassword` blocks everything except `GET /users/me` and `POST /users/me/change-password` (403 `PASSWORD_CHANGE_REQUIRED`)
- Login answers unknown, inactive and proxy accounts exactly like a wrong password (including timing)

**Trash (soft delete)**
- Expenses, savings entries, salary records, monthly overrides, bonuses and tax cards have `deletedAt` / `deletedByUserId`. Their DELETE routes set these instead of removing the row; the item then appears in the household trash (expenses, savings) or the user's income trash, and can be restored. There is no "empty trash" — financial data is never hard-deleted by users
- Trashed rows are invisible to every calculation: the Prisma client extension filters top-level reads/`updateMany`, and nested includes, `_count` and occurrence relation filters use `notDeleted`
- Items in RETIRED years can't be restored (read-only). A new override for a month whose override is in the trash replaces it (one override per job and month)
- Hard deletes remain only for admin/system cascades: deleting a budget year (simulations, current/future retired years) or a household

**Household access**
- `getActiveMembership` (`lib/ownership.ts`) is the membership check for household data: deactivated households are closed to members (system admins excepted). The household settings routes keep working so an admin can reactivate
- Expense/savings categories must be system-wide or the household's own, active, and of the right type (`findUsableCategory`); an entry may keep a category deactivated after it was assigned
- Income can only be allocated to a household the job's owner belongs to

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

- Shares come from `lib/incomeShare.ts`: unrounded, over current members only, equal split when nobody has allocated income. Shared amounts are split with the largest-remainder method so the cents add up
- Monthly job income comes from one pure implementation, `lib/jobIncome.ts` (salary record or month override, FX via `rateUsed`, job start/end months, bonuses). Budget-year income adds budget-included bonuses paid that year as amount ÷ 12; month views put ONE_OFF bonuses in their payment month and spread SPREAD_ANNUALLY ÷ 12 across the year. RETIRED years use the average of their twelve months
- Tax cards are picked by the salary record's `effectiveFrom` (or the override's month), not today's date
- Over-allocation is evaluated per job per calendar year (summed across households)

Informational only — system calculates and displays, never enforces.

### Receipt Consumption
Receipt imports represent actual purchases, not planned budget allocations. Confirmed receipt line items are summarized separately by category/month for consumption insight. They do not affect `monthlyEquivalent`, planned expense totals, occurrence schedules, or budget transfer recalculation.

Receipt category is two-level: top-level category uses the existing Budgeteer `EXPENSE` category; receipt subcategory captures more granular consumption detail within that category.

Receipt text handling:
- All stored keys (line-item `normalizedLabel`, mapping `normalizedLabel`/`merchantKey`, classifier terms) come from `apps/api/src/lib/receiptText.ts`, which the classifier, CSV import, admin training routes and seed share. Folding lowercases and strips accents (é → e) but keeps å/æ/ø
- Amounts need two decimals and respect thousands separators (1.234,50 / 1,234.50; "1 234,50" only on TOTAL/MOMS-style summary lines, where quantities don't appear). Summary keywords (total, moms, gebyr, …) match whole words
- `totalAmount` is the sum of non-ignored line items; `printedTotal` is the TOTAL read from the receipt (editable), and `totalMismatch` flags a difference so missed or misread lines are noticed
- Confirming saves the review's edits and confirms in one transaction and happens once per receipt; it teaches the classifier: category mappings, and noise words only from labels the user trimmed (not renamed)
- A local AI model (optional) enhances the deterministic parse; its values win only where usable
- Uploads are checked by their bytes (PDF/PNG/JPEG magic numbers). OCR has a per-receipt time budget and refuses images above `RECEIPT_OCR_MAX_PIXELS`

Receipt upload and parsing run server-side. The browser sends the original image/PDF file to the API, the API stores it locally, runs local OCR, and the receipt review UI loads the protected file beside extracted line items for validation. Pasted OCR text remains supported for manual imports, and failed or empty OCR still leaves a draft where line items can be added manually.

Receipt OCR is local-first and server-side. Images are preprocessed locally to apply camera EXIF orientation, grayscale, and contrast normalization before Tesseract runs; Tesseract then tries multiple page segmentation modes and keeps the strongest receipt-like result. The Docker API image installs Danish and English Tesseract language data, and OCR defaults to `dan+eng` with an English fallback for local installs where Danish data is missing. PDFs are rendered to temporary page images with Poppler `pdftoppm`, then OCR runs locally on those images. OCR tuning is controlled by `RECEIPT_OCR_LANG`, `RECEIPT_OCR_PSM`, `RECEIPT_OCR_TIMEOUT_MS`, `RECEIPT_OCR_PDF_DPI`, `RECEIPT_OCR_MAX_PDF_PAGES`, and `RECEIPT_OCR_PREPROCESS`.

Receipt line classification runs after extraction in a hybrid order: exact same-merchant mappings with household rows preferred over system rows, exact any-merchant mappings with the same precedence, fuzzy household mappings, fuzzy system mappings, deterministic keyword rules, and then optional local AI suggestions for any remaining unclassified lines. Before text parsing, active `OCR_ALIAS` terms are applied to a temporary OCR text copy so common spelling errors can help merchant, total, and line extraction while the stored raw OCR text and visible line labels remain unchanged. Fuzzy matching normalizes common OCR and package noise such as quantities, weights, volumes, receipt codes, trailing prices, punctuation, and repeated whitespace before token-aware scoring. It also applies active `OCR_ALIAS` terms to the internal matching key and uses OCR-confusion-aware token similarity for common substitutions such as `1/l/i`, `0/o`, `@/ø`, and Danish `æ/ø/å` ASCII variants. Noise tokens, low-value words, and OCR aliases are loaded from `receipt_classifier_terms` rather than hard-coded as the primary source. Household mappings are written when a user confirms a receipt or explicitly imports validated mapping CSV rows, even when the original suggestion came from a system mapping.

Receipt mapping import/export is user-driven and household-scoped. Budgeteer exports a category catalog, global and household mapping context, classifier terms, CSV template, and prompt that can be used with an external or local LLM; it does not call hosted LLM services for this workflow. Import preview validates category IDs, subcategory/category relationships, duplicate mapping keys, classifier term rows, `OCR_ALIAS` `source=>target` format, confidence values, and required labels. Supplied category/subcategory IDs are authoritative; when IDs are blank, imports may resolve category/subcategory names as a portable fallback. Confirming an import upserts only valid create/update rows into household-scoped `receipt_category_mappings` and household-scoped `receipt_classifier_terms`; invalid, skipped, and unchanged rows are left untouched.

System administrators maintain receipt training data through `/admin/receipt-training`. The admin UI exposes classifier terms, receipt mappings, and receipt subcategories in separate tabs, with system/household scope controls where relevant and create/edit/toggle/delete actions as appropriate. Regular household receipt review can still learn mappings through confirmation, but direct maintenance of the underlying training tables is system-admin-only.

`prisma/receipt-training-seed.csv` contains anonymized reusable receipt labels and classifier terms only; it excludes source photos, dates, addresses, payment identifiers, receipt totals, and raw OCR text. It includes a reusable Danish supermarket vocabulary and common OCR variants so fuzzy matching has baseline mappings before user-specific learning. Shared-account style shopping labels map to `Shared Household Spending` and then into lower-level receipt subcategories. `prisma/seed.ts` reads this portable CSV and resolves category/subcategory names against the install's own IDs, seeding system classifier terms and global system receipt mappings while removing old household mapping copies that exactly duplicate those system defaults.

Optional AI enhancement may call only a local/self-hosted HTTP model endpoint configured through `LOCAL_AI_BASE_URL` and `LOCAL_AI_MODEL`; receipt data must never be sent to hosted AI services. AI extraction can improve receipt JSON cleanup when those variables are set. AI categorization requires the additional `RECEIPT_AI_CATEGORIZE=true` opt-in and may only choose from active household-visible expense category/subcategory IDs; invalid or low-confidence suggestions remain unclassified for review. Without local AI, uploaded receipts still use server-side OCR and deterministic parsing/category matching.

### Danish Tax Calculation
`tax_card_settings` stores the active tax card per job. The API calculates deductions in this order:
1. Pre-AM deductions: brutto items + pension employee % + ATP
2. AM-bidrag: 8% of AM-indkomst (truncated to whole DKK)
3. A-skat: bottom tax + top-skat (both truncated to whole DKK)
4. Net = gross − preAmTotal − amBidrag − aSkat

The shared calculation engine (`apps/api/src/lib/taxCalcDK.ts`) is also re-implemented in the frontend (`apps/web/src/lib/danishTaxPreview.ts`) for live preview before submission.

---

## Budget Lifecycle

```
[FUTURE] → (its year arrives — automatic) → [ACTIVE]
[ACTIVE] → (year ends — automatic, or manual action) → [RETIRED]
[ACTIVE | FUTURE] → (copy) → [SIMULATION]
[SIMULATION] → (promote) → takes the place of the regular year for its own year (date-derived ACTIVE or FUTURE; that year's existing regular year → RETIRED). Past-year simulations can't be promoted
[RETIRED current/future regular year] → (restore) → date-derived ACTIVE or FUTURE
```

- Calendar transitions run in `lib/budgetYearLifecycle.ts` at API startup, daily at 00:05, and before the monthly automations. RETIRED years are never auto-restored
- Copying a year carries currency, account and period fields; foreign-currency entries are re-priced (unlocked) at today's rate

- New regular-year status is date-derived: year < current = RETIRED, year = current = ACTIVE, year > current = FUTURE
- Manually retired current/future regular years can be restored to their date-derived status or hard-deleted; past retired regular years remain protected history
- Simulations override date logic — always editable
- Multiple simulations per year allowed, each with a unique name
- Retired budget years are read-only
- Default household and user dashboards select the active regular budget year first; if no active year exists, they fall back to the earliest future regular year

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
POST   /users                                          # admin only
PUT    /users/:id                                      # admin only
POST   /users/:id/reset-password                       # admin only
GET    /users/:id/jobs
POST   /users/:id/jobs
PUT    /users/:id/jobs/:jobId
DELETE /users/:id/jobs/:jobId
GET    /users/:id/income/history
GET    /users/me
PUT    /users/me
PUT    /users/me/preferences                          # includes the reminder* settings
GET    /me/notification-settings                      # the member's reminder settings, login email, and channels the install allows
POST   /me/notification-settings/test-webhook         # sends a test to the member's saved ntfy topic / webhook (400 WEBHOOK_ERROR with the reason)
POST   /users/me/change-password
POST   /users/me/avatar
DELETE /users/me/avatar
GET    /users/me/income/summary
GET    /users/me/income/trend
GET    /users/me/income/sankey
GET    /users/me/dashboard

GET    /users/me/accounts
POST   /users/me/accounts
PUT    /users/me/accounts/:id
DELETE /users/me/accounts/:id

GET    /jobs/:id/salary
POST   /jobs/:id/salary
PUT    /jobs/:id/salary/:salaryId
DELETE /jobs/:id/salary/:salaryId
GET    /jobs/:id/overrides
POST   /jobs/:id/overrides
DELETE /jobs/:id/overrides/:overrideId
GET    /jobs/:id/taxcard
POST   /jobs/:id/taxcard
PUT    /jobs/:id/taxcard/:settingsId
DELETE /jobs/:id/taxcard/:settingsId
GET    /jobs/:id/bonuses
POST   /jobs/:id/bonuses
PUT    /jobs/:id/bonuses/:bonusId
DELETE /jobs/:id/bonuses/:bonusId
GET    /users/:id/income/trash                          # trashed salary records, overrides, bonuses, tax cards
POST   /users/:id/income/trash/:kind/:itemId/restore    # kind = salary | override | bonus | taxcard
POST   /jobs/:id/payslips/parse

PUT    /income/:id/allocations/:householdId
DELETE /income/:id/allocations/:householdId

GET    /me/summary                                     # cross-household dashboard summary
GET    /me/reminders                                   # manual payments due soon / today / overdue across the member's households, with counts
GET    /reminder-actions/:token                        # no auth; { state: VALID | DONE | USED | EXPIRED | INVALID, item }
POST   /reminder-actions/:token                        # no auth; marks the item paid once (410 LINK_USED / LINK_EXPIRED, 404 LINK_INVALID)

GET    /households
POST   /households
GET    /households/:id
PUT    /households/:id                                  # { name, budgetModel?, transferPaymentMethod?, transferDueDay? } — household admin
GET    /households/:id/notification-settings          # members; { settings, allowed }
PUT    /households/:id/notification-settings          # household admin; { inAppEnabled?, emailEnabled?, webhookEnabled?, webhookUrl?, webhookFormat?, webhookSecret?, leadDays? }
POST   /households/:id/notification-settings/test-webhook # household admin; tests the shared ntfy topic / webhook
PUT    /households/:id/deactivate
PUT    /households/:id/reactivate
DELETE /households/:id                                 # admin only (hard delete)
POST   /households/:id/members
PUT    /households/:id/members/:memberId
DELETE /households/:id/members/:memberId
GET    /households/:id/budget-years
POST   /households/:id/budget-years
GET    /households/:id/summary                          # totals, surplus, savingsRate, incomeSplit (% of income), flows, member splits
GET    /households/:id/trash                            # trashed expenses and savings entries
POST   /households/:id/trash/:kind/:itemId/restore      # kind = expense | savings (not in RETIRED years)
GET    /households/:id/income-summary
GET    /households/:id/savings-history
GET    /households/:id/trends
GET    /households/:id/compare
GET    /households/:id/accounts
POST   /households/:id/accounts
PUT    /households/:id/accounts/:accountId
DELETE /households/:id/accounts/:accountId
GET    /households/:id/receipt-subcategories
POST   /households/:id/receipts/parse
POST   /households/:id/receipts/upload
GET    /households/:id/receipts
GET    /households/:id/receipts/summary?period=allTime|currentMonth|previousMonth|currentQuarter|previousQuarter|currentYear|previousYear|last12Months|custom
GET    /households/:id/receipt-mappings/export-kit
POST   /households/:id/receipt-mappings/import-preview
POST   /households/:id/receipt-mappings/import-confirm
GET    /households/:id/receipts/:receiptId
GET    /households/:id/receipts/:receiptId/file
PUT    /households/:id/receipts/:receiptId
POST   /households/:id/receipts/:receiptId/confirm      # optional { receipt, lineItems } saved in the same transaction; 409 when already confirmed
POST   /households/:id/receipts/:receiptId/line-items
PUT    /households/:id/receipts/:receiptId/line-items/:lineItemId
DELETE /households/:id/receipts/:receiptId
GET    /categories/:id/subcategories
POST   /categories/:id/subcategories

PATCH  /households/:id/budget-years/:yearId
POST   /households/:id/budget-years/:yearId/copy
PATCH  /households/:id/budget-years/:yearId/promote
PATCH  /households/:id/budget-years/:yearId/retire
DELETE /households/:id/budget-years/:yearId

GET    /budget-years/:id/expenses
POST   /budget-years/:id/expenses
PUT    /budget-years/:id/expenses/:expenseId
PATCH  /budget-years/:id/expenses/bulk
DELETE /budget-years/:id/expenses/:expenseId

GET    /budget-years/:id/savings
POST   /budget-years/:id/savings
PUT    /budget-years/:id/savings/:entryId
PATCH  /budget-years/:id/savings/bulk
DELETE /budget-years/:id/savings/:entryId

GET    /budget-years/:id/accounts
GET    /budget-years/:id/transfers
PATCH  /budget-years/:id/transfers/:transferId/mark-paid
PATCH  /budget-years/:id/transfers/:transferId/mark-pending
GET    /budget-years/:id/transfers/breakdown
GET    /budget-years/:id/occurrences?month=M             # any model: the month's manual items (default: current), overdue items from earlier months, totals, carriesOver, automaticCount (PAY_NO_PAY), manualEntryCount
GET    /budget-years/:id/payments?month=M                # any model: the month's expense/savings payments with due day, payment method and occurrence status, sorted by day; manualCount, doneCount (paid or dismissed) and unpaid for manual items
PATCH  /budget-years/:id/occurrences/:kind/:occurrenceId # kind = expense | savings; { status: PAID | PENDING } or { status: DISMISSED, reason: PAID_ELSEWHERE | SKIPPED }
POST   /budget-years/:id/occurrences/mark-all-paid       # { month } — pending manual items only; for the current month, overdue ones too

GET    /categories
POST   /categories
DELETE /categories/:id
POST   /categories/:id/promote                         # admin only
POST   /admin/categories                               # admin only
PATCH  /admin/categories/:id                           # admin only

GET    /currencies
GET    /currencies/:code/history
GET    /admin/currencies                               # admin only
POST   /admin/currencies                               # admin only
PATCH  /admin/currencies/:code                         # admin only
POST   /admin/currencies/refresh                       # admin only

GET    /admin/receipt-training                         # admin only
POST   /admin/receipt-training/terms                   # admin only
PATCH  /admin/receipt-training/terms/:id               # admin only
DELETE /admin/receipt-training/terms/:id               # admin only
POST   /admin/receipt-training/subcategories           # admin only
PATCH  /admin/receipt-training/subcategories/:id       # admin only
POST   /admin/receipt-training/mappings                # admin only
PATCH  /admin/receipt-training/mappings/:id            # admin only
DELETE /admin/receipt-training/mappings/:id            # admin only

GET    /admin/automations                              # admin only
GET    /admin/notification-settings                    # admin only
PUT    /admin/notification-settings                    # admin only; channel switches and smtp* (smtpPassword: string to set, null to clear, omit to keep)
POST   /admin/notification-settings/test-email         # admin only; { to } — sends a test with the saved SMTP settings (400 SMTP_ERROR with the reason)
GET    /admin/notification-deliveries?limit=N          # admin only; latest reminder digests with status and error
PATCH  /admin/automations/:id/toggle                   # admin only
GET    /admin/automations/:id/runs                     # admin only
POST   /admin/automations/:id/trigger                  # admin only
POST   /admin/automations/trigger-all                  # admin only

GET    /health
GET    /config
```

---

## Auth Flow

- Login returns a JWT access token (15 min) in the body and sets the refresh token (7 days) as the `budgeteer_refresh` cookie: `httpOnly`, `SameSite=Strict`, `Path=/`, and `Secure` when the request arrived over HTTPS (`request.protocol`, which honours `X-Forwarded-Proto` from a `TRUST_PROXY` proxy; nginx forwards it). The refresh token never appears in a response body
- The web client keeps the access token in memory only (`apps/web/src/api/client.ts`); after a reload it calls `POST /auth/refresh`, which reads the cookie. `localStorage` holds only a `user` hint, not a secret
- Refresh token rotated on use; the response sets the new cookie. Concurrent refreshes in one tab share a request, and a tab that loses a rotation race retries once with the cookie the other tab received
- `POST /auth/refresh` and `/auth/logout` still accept `{ refreshToken }` in the body so sessions from before the cookie switch (token in `localStorage`) are exchanged for a cookie once; the client deletes the old keys when it does
- Frontend silently refreshes on a 401 and only returns to /login when the refresh itself is rejected
- Logout deletes the refresh token in the database and clears the cookie
- Account locked after 10 failed login attempts for 15 minutes
- First login (and admin-triggered reset) forces password change
- Proxy accounts (`isProxy = true`) cannot log in directly — used for income entry on behalf of others
