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
- **@anthropic-ai/sdk** — AI-assisted payslip parsing (optional; requires `ANTHROPIC_API_KEY`)
- **Local OCR** — server-side receipt OCR uses Tesseract for images and Poppler `pdftoppm` for scanned PDFs inside the API container
- **Local AI HTTP provider** — optional receipt cleanup and opt-in line categorization enhancement (requires `LOCAL_AI_BASE_URL` + `LOCAL_AI_MODEL`; categorization also requires `RECEIPT_AI_CATEGORIZE=true`; receipt data must not be sent to hosted AI services)

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
- Uploaded receipt files are stored locally on the API server under `UPLOAD_DIR/receipts/<householdId>/` and served only through authenticated household-scoped endpoints
- Deleted receipts are soft-deleted with `deletedAt` so consumption history can be preserved

**receipt_line_items** — individual purchases extracted from a receipt
- receiptId, categoryId (nullable), subcategoryId (nullable), originalText, label, normalizedLabel, quantity, amount, currencyCode, confidence, sortOrder, isIgnored
- Category mappings point to active `EXPENSE` categories visible to the household, with optional receipt subcategories for lower-level consumption classification
- Ignored line items are retained but excluded from consumption summaries

**receipt_subcategories** — lower-level receipt classifications under expense categories
- categoryId, householdId (nullable), name, isSystemWide, isActive
- System defaults are seeded under top-level expense categories, for example Food & Groceries → Food, Alcohol, Beer, Wine, Vegetables, Meat, Candy, Toys
- Household members can add household-specific subcategories under any expense category visible to the household

**receipt_category_mappings** — learned household-specific categorization hints
- householdId, normalizedLabel, merchantKey, categoryId, subcategoryId (nullable), confidence, hitCount, lastUsedAt
- Reused during future receipt parsing before falling back to rule-based category suggestions

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

Receipt upload and parsing run server-side. The browser sends the original image/PDF file to the API, the API stores it locally, runs local OCR, and the receipt review UI loads the protected file beside extracted line items for validation. Pasted OCR text remains supported for manual imports.

Receipt OCR is local-first and server-side. Images are read through Tesseract. PDFs are rendered to temporary page images with Poppler `pdftoppm`, then OCR runs locally on those images. OCR tuning is controlled by `RECEIPT_OCR_LANG`, `RECEIPT_OCR_PSM`, `RECEIPT_OCR_PDF_DPI`, and `RECEIPT_OCR_MAX_PDF_PAGES`.

Receipt line classification runs after extraction in a hybrid order: exact household-learned mappings for the same merchant, exact mappings from other merchants, fuzzy historical matches, deterministic keyword rules, and then optional local AI suggestions for any remaining unclassified lines. Learned mappings are written only when a user confirms a receipt.

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
GET    /households/:id/receipts/summary
GET    /households/:id/receipts/:receiptId
GET    /households/:id/receipts/:receiptId/file
PUT    /households/:id/receipts/:receiptId
POST   /households/:id/receipts/:receiptId/confirm
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
