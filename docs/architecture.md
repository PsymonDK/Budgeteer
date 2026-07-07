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
- **D3 / Sankey** — income and receipt consumption flow diagrams

### Backend
- **Node.js + TypeScript** — runtime
- **Fastify** — API framework
- **Prisma ORM** — type-safe database access and migrations
- **PostgreSQL** — primary database
- **Zod** — runtime validation and shared types
- **JWT + Refresh Tokens** — stateless auth
- **node-cron** — daily currency rate sync (06:00)
- **@anthropic-ai/sdk** — AI-assisted payslip parsing (optional; requires `ANTHROPIC_API_KEY`)
- **Local OCR** — server-side receipt OCR uses Tesseract for images and Poppler `pdftoppm` for scanned PDFs inside the API container
- **Local AI HTTP provider** — optional receipt cleanup and opt-in line categorization enhancement (requires `LOCAL_AI_BASE_URL` + `LOCAL_AI_MODEL`; categorization also requires `RECEIPT_AI_CATEGORIZE=true`; receipt data must not be sent to hosted AI services)

### Infrastructure
- **Docker + Docker Compose** — single-command self-hosted setup; the API image uses a multi-stage build so TypeScript compilation, Prisma generation, and build-only dependencies stay out of the runtime image.
- **Bare metal** — setup script for direct server installs

### Runtime Configuration
- **API rate limiting** — Fastify global rate limiting is enabled by default and controlled by `API_RATE_LIMIT_ENABLED`, `API_RATE_LIMIT_MAX`, and `API_RATE_LIMIT_WINDOW`. The Docker development stack sets `API_RATE_LIMIT_ENABLED=false` because local browser traffic can produce many same-origin API calls through one proxy/client address.
- **Container schema sync** — the API entrypoint uses `SCHEMA_SYNC_MODE` on startup. `push` runs non-destructive Prisma schema sync, `migrate` runs committed migrations, `skip` leaves the database untouched, and `force-push` is the explicit opt-in for Prisma `--accept-data-loss`. The Docker image runs the precompiled seed script at startup instead of keeping `ts-node` and TypeScript in the runtime layer.

---

## Project Structure

```
budgeteer/
├── apps/
│   ├── web/          # React frontend (Vite)
│   └── api/          # Fastify backend
├── docker/
│   ├── Dockerfile.web
│   ├── Dockerfile.api
│   ├── nginx.conf
│   └── docker-compose.yml
├── prisma/
│   └── schema.prisma
├── scripts/
└── docs/
```

---

## Data Model

### Entities

**users** — system accounts
- id, email, name, passwordHash, role (`SYSTEM_ADMIN` | `BOOKKEEPER` | `USER`), isActive, isProxy, mustChangePassword, avatarUrl, failedLoginAttempts, lockedUntil

**user_preferences** — per-user settings (1:1 with user)
- userId, defaultHouseholdId, preferredCurrency, notifyOverAllocation, notifyExpensesExceedIncome, notifyNoSavings, notifyUncategorised, showDashboardSparklines

**households** — shared budget spaces
- id, name, isActive, autoMarkTransferPaid, budgetModel (`AVERAGE` | `FORWARD_LOOKING` | `PAY_NO_PAY`)

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
- ownership (`SHARED` | `INDIVIDUAL` | `CUSTOM`), ownedByUserId (nullable), accountId (nullable)
- currencyCode (nullable), originalAmount (nullable), rateUsed (nullable), rateDate (nullable)

**expense_custom_splits** — per-member percentage splits for CUSTOM ownership expenses
- expenseId, userId, pct (must sum to 100%)

**expense_occurrences** — individual occurrence tracking for a recurring expense
- expenseId, year, month, scheduledAmount, carriedAmount, status (`PENDING` | `PAID` | `SKIPPED`)
- paidAt (nullable), actualAmount (nullable), note (nullable)

**receipts** — actual consumption imports from scanned receipts/photos
- householdId, uploadedByUserId, accountId (nullable), merchantName, purchaseDate, totalAmount, taxAmount, feeAmount, currencyCode
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
- ownership (`SHARED` | `INDIVIDUAL` | `CUSTOM`), ownedByUserId (nullable), accountId (nullable), categoryId (nullable)
- currencyCode (nullable), originalAmount (nullable), rateUsed (nullable), rateDate (nullable)

**savings_custom_splits** — per-member percentage splits for CUSTOM ownership savings
- savingsEntryId, userId, pct (must sum to 100%)

**savings_occurrences** — individual occurrence tracking for a recurring savings entry
- savingsEntryId, year, month, scheduledAmount, carriedAmount, status (`PENDING` | `PAID` | `SKIPPED`)
- paidAt (nullable), actualAmount (nullable), note (nullable)

**budget_transfers** — monthly inter-member transfer snapshots
- budgetYearId, year, month, calculatedAmount, actualAmount (nullable), status (`PENDING` | `PAID` | `ADJUSTED`)
- calculatedAt, paidAt (nullable), automationRunId (nullable)
- One record per budget year per month; recalculated when income or expenses change

**currencies** — admin-managed catalog of available currencies
- code (PK), name, isEnabled
- Disabled currencies are hidden from user-facing currency selectors

**currency_rates** — time-series exchange rates fetched from Danmarks Nationalbank
- currencyCode, rate (relative to BASE_CURRENCY), baseCurrency, fetchedDate
- New rows appended daily; queries use `DISTINCT ON` to get the latest rate per currency
- Past expense/savings rates are locked at `rateDate`; future ones recalculate on sync

**automations** — scheduled or manually-triggered household jobs
- householdId, key (unique per household), label, description, schedule (cron), isEnabled
- lastRunAt (nullable), lastRunStatus (nullable)

**automation_runs** — execution history for automations
- automationId, triggeredBy (`SCHEDULE` | `MANUAL`), triggeredByUserId (nullable)
- startedAt, finishedAt, status (`SUCCESS` | `ERROR` | `SKIPPED`), message (nullable)

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

### Receipt Consumption
Receipt imports represent actual purchases, not planned budget allocations. Confirmed receipt line items are summarized separately by category/month for consumption insight. They do not affect `monthlyEquivalent`, planned expense totals, occurrence schedules, or budget transfer recalculation.

Receipt category is two-level: top-level category uses the existing Budgeteer `EXPENSE` category; receipt subcategory captures more granular consumption detail within that category.

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

The shared calculation engine (`apps/api/src/lib/taxCalcDK.ts`) is also re-implemented in the frontend (`apps/web/src/pages/IncomePage.tsx`) for live preview before submission.

---

## Budget Lifecycle

```
[FUTURE] → (year arrives or manual promotion) → [ACTIVE]
[ACTIVE] → (new year or manual action) → [RETIRED]
[ACTIVE | FUTURE] → (copy) → [SIMULATION]
[SIMULATION] → (promote) → becomes ACTIVE, previous ACTIVE → RETIRED
[RETIRED current/future regular year] → (restore) → date-derived ACTIVE or FUTURE
```

- New regular-year status is date-derived: year < current = RETIRED, year = current = ACTIVE, year > current = FUTURE
- Manually retired current/future regular years can be restored to their date-derived status or hard-deleted; past retired regular years remain protected history
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
PUT    /users/me/preferences
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
POST   /jobs/:id/payslips/parse

PUT    /income/:id/allocations/:householdId
DELETE /income/:id/allocations/:householdId

GET    /me/summary                                     # cross-household dashboard summary

GET    /households
POST   /households
GET    /households/:id
PUT    /households/:id
PUT    /households/:id/deactivate
PUT    /households/:id/reactivate
DELETE /households/:id                                 # admin only (hard delete)
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
POST   /households/:id/receipts/:receiptId/confirm
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
PATCH  /admin/automations/:id/toggle                   # admin only
GET    /admin/automations/:id/runs                     # admin only
POST   /admin/automations/:id/trigger                  # admin only
POST   /admin/automations/trigger-all                  # admin only

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
