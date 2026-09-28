# Code review — 2026-09-28

Whole-codebase review (API, receipts/OCR, web, schema/infra/docs). Findings marked ✅ were re-verified by hand against the code; the rest were traced by a reviewer with file:line evidence. Line numbers refer to commit `7f74fd1`.

## Progress

| Phase | Branch | Status |
|---|---|---|
| 0 — Safety net | `chore/REF-000-safety-net` | Done |
| 3 — Frontend quick fixes | `fix/REF-003-frontend-quick-fixes` | Done |
| 1 — Data integrity (budget/transfers + income) | `fix/REF-001-data-integrity` | Done |
| 2 — Security | `fix/REF-002-security` | Done (deferred: tokens in localStorage → httpOnly cookies; avatar auth; upload magic bytes → phase 5) |
| 4 — Structure + soft delete/trash | `refactor/REF-004-structure` | Done (open: float money math in dashboard/compare/profile; client-computed payslip net submitted by IncomePage) |
| 5 — Receipts | — | Not started |
| 6 — Docs & deploy | — | Not started |

Branches are stacked in the order above (each builds on the previous).

Baseline at review time: API `tsc` ✅, 65/65 Vitest tests ✅, web build ✅ (1.1 MB main chunk), web lint ❌ (eslint not installed, no config).

---

## 1. Critical — data integrity

| # | Finding | Where |
|---|---|---|
| C1 ✅ | **PAY_NO_PAY carry-over grows forever.** No code path ever marks an `ExpenseOccurrence`/`SavingsOccurrence` as PAID; rollover treats everything as unpaid. 1000/mo expense → transfers 1000, 2000, 3000 … | `lib/budgetTransfer.ts:216-287` |
| C2 | **Rollover not idempotent.** A second run in the same month (manual trigger, second replica) finds no PENDING rows and upserts `carriedAmount = 0`, wiping carries. | `lib/budgetTransfer.ts:286`, `routes/automations.ts:48` |
| C3 | **Budget-year status never advances with the calendar.** Nothing moves FUTURE→ACTIVE→RETIRED. On Jan 1 the old year stays ACTIVE; rollover uses `currentYear` instead of the previous year for the December close and creates next-year occurrences inside the old year. | `lib/automations.ts:46-64`, `lib/budgetTransfer.ts:13` |
| C4 ✅ | **Daily FX sync corrupts data.** `recalcFutureExpenses` omits `calcAnnualAverage` (partial-year entries become ~4× too large), has no status filter (rewrites RETIRED years), uses float math, and never recalculates transfers. | `lib/currency.ts:78-121` |
| C5 | **Past FX rates aren't locked at payment date.** Writes always use the latest rate; `lockPastExpenseRates` runs *after* recalculation; savings can't set `frequencyPeriod` so they're never locked. | `lib/currency.ts:60,139`, `routes/expenses.ts:120` |
| C6 | **Copy budget year drops** `currencyCode`, `originalAmount`, `rateUsed`, `rateDate`, `accountId`, `forwardMonthlyEquivalent` (and savings `frequencyPeriod`). Copied EUR expenses become DKK on next edit. | `routes/budgetYears.ts:67-111` |
| C7 ✅ | **Enum ordering bug.** `BudgetStatus` is declared `FUTURE, ACTIVE, …`, so `orderBy: status asc` picks FUTURE before ACTIVE. Budget-model change recalculates the wrong year; income summary shows the future year. | `routes/households.ts:155`, `routes/jobs.ts:1040` |
| C8 | **`DELETE /households/:id` always fails** (FK Restrict on members/budget years/automations) with a raw 500. `Category.householdId` has no relation → orphans. | `routes/households.ts:300`, `schema.prisma:175,187,578,311` |
| C9 ✅ | **No baseline migration.** First migration `ALTER`s tables that no migration creates; several models/columns were never migrated. `db:migrate` / `SCHEMA_SYNC_MODE=migrate` fail on a fresh DB; the runtime image doesn't ship `prisma/migrations`. Production actually relies on `db push`. | `prisma/migrations/`, `docker/Dockerfile.api:45` |

## 2. High — correctness

- **Bonuses never reach budget income**; `SPREAD_ANNUALLY` branch identical to `ONE_OFF` (no ÷12). `lib/incomeCalc.ts`, `routes/jobs.ts:988-998`
- **Income history/trend ignore FX** (raw `grossAmount`), while dashboard converts. `routes/jobs.ts:969`, `routes/profile.ts:134-162,497`
- **Over-allocation double counts across years** (ACTIVE + FUTURE summed → 200%). `routes/profile.ts:53-67,236,466`
- **Deleting an allocation deletes it in every year, incl. RETIRED.** `routes/jobs.ts:874`
- **Tax card resolved by today's date, not the salary's `effectiveFrom`.** `routes/jobs.ts:183`
- **Editing a PAY_NO_PAY expense doesn't update pending occurrences.** `lib/budgetTransfer.ts:181`
- **Promoting a future-year simulation retires the live current year.** `routes/budgetYears.ts:327-339`
- **Changing currency on a locked entry reuses the old currency's rate.** `routes/expenses.ts:221`, `routes/savings.ts:189`
- **Fire-and-forget `recalculateTransfer`** after every write: races, stale refetch, `createMany` without `skipDuplicates` → P2002 swallowed.
- **Dashboard member split** multiplies by a `toFixed(1)` percentage (33.3×3 = 99.9%) and disagrees with `/transfers/breakdown`. `routes/dashboard.ts:299`
- **Hard deletes of financial data** (expenses, savings, salary records, overrides, bonuses, tax cards, categories) contrary to conventions.
- **Float math on money** throughout dashboard/compare/ownership via `toNum`.
- **N+1 queries** in income calc (`getJobMonthlyIncome` ≈ 4 queries per allocation, per year, per household).

## 3. Security

| Sev | Finding | Where |
|---|---|---|
| High ✅ | **Rate limits are global behind nginx** — no `trustProxy`, no `X-Forwarded-For`. 10 bad logins lock *everyone* out for 15 min. | `index.ts:35`, `docker/nginx.conf` |
| High | **Password change/reset doesn't revoke refresh tokens** — stolen sessions survive. | `routes/users.ts:160,262` |
| Med | Deactivated households remain fully writable (access helpers don't check `isActive`). | `lib/ownership.ts:15,57` |
| Med | Retired years writable via transfers mark-paid/pending, category delete w/ replacement, allocation delete. | `routes/budgetTransfers.ts:36,72`, `routes/categories.ts:380` |
| Med | `mustChangePassword` enforced only in the frontend. | `plugins/authenticate.ts` |
| Med | No global error handler — Prisma errors (paths, queries) leak in 500s; `err.message` echoed in several routes. | — |
| Med | Expenses/savings can reference another household's category (unscoped `findUnique`). | `routes/expenses.ts:106,193,299`, `routes/savings.ts:123,219` |
| Low | Admin role taken from JWT (15-min lag on demotion); login enumeration; refresh tokens stored plaintext, never purged, no reuse detection, stored in `localStorage`; params/queries not Zod-validated; inconsistent role matrix (MEMBER can bulk-delete expenses but not edit budget years). | various |
| Low | OCR DoS: `pdftoppm` has no timeout; up to 10×45 s tesseract runs synchronously per request. | `lib/receiptOcr.ts:71,138` |
| Low | Docker build disables TLS verification (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `strict-ssl=false`, apk `--no-check-certificate`) in the published image pipeline. | `docker/Dockerfile.api:9,18,27,31,42` |

Verified OK: nested child-ID scoping (expenses, savings, transfers, salary, receipts, accounts), `execFile` without shell, path-traversal guards, bcrypt cost 12, Zod stripping unknown keys.

## 4. Receipts / OCR

- ✅ **Substring keyword match**: "Coffee 35,00" → `feeAmount=35`; "Taxi" → tax; "Sumatra" → sum. `lib/receiptParser.ts:233`
- **Thousands separators misparsed**: "1.234,50" → 4.50; "1 234,50" → 234.50. `lib/receiptParser.ts:466`
- **Learned noise tokens delete real products** after a user renames a line 3× (or confirms the same receipt 3×; `/confirm` isn't idempotent). `lib/receiptClassifier.ts:734-780`, `routes/receipts.ts:561`
- **NFKD breaks "å"**: "Håndsæbe" → "ha ndsæbe"; category rules containing å never match. `lib/receiptClassifier.ts:167,173`
- Mappings capped at `take: 2000` combined system+household, so household mappings silently drop.
- Printed TOTAL discarded; `totalAmount` edit accepted and ignored; no sum-vs-total sanity check.
- Invalid dates roll over (31.02 → 02.03); ISO dates not detected.
- Consumption summary converts at *latest* FX rate with float sums.
- CSV-imported mapping keys stored un-normalized → never match.
- OCR error text (with absolute server paths) stored in `receipt.notes`.
- Classifier config loaded 3–4× per parse; fuzzy Levenshtein over 2000 mappings per line.
- No route tests for receipts.

## 5. Frontend

**Bugs**
- ✅ **Page state survives a household switch** (`<Outlet />` isn't keyed): wrong-year state, offer to create a duplicate budget year, bulk-edit IDs from household A sent to B, and *renaming household B to A's name* if the edit form was open. Fix: `<Outlet key={householdId} />` in `layouts/HouseholdLayout.tsx:154`.
- ✅ **Logout doesn't clear the TanStack cache** or the stored active household — next user in the tab briefly sees previous user's data. `contexts/AuthContext.tsx:77`
- Any `/users/me` failure (network, 500) logs the user out. `contexts/AuthContext.tsx:47`
- ✅ Profile preferred-currency dropdown reads `c.currencyCode`; API returns `code` → empty options. `pages/ProfilePage.tsx:295`
- IncomePage allocation save: per-row loop, first `onSuccess` clears all pending edits; over-allocation check only sums changed rows *and* blocks saving (should be a soft warning).
- Deduction overrides of `0` ignored (`parseFloat(x) || calc`), and the client-computed payslip lines are persisted.
- Double currency suffix ("1,000.00 DKK DKK"); SavingsPage totals row `colSpan` off by one.
- Local-date → `toISOString()` off-by-one in Denmark (Dashboard, IncomePage).
- ~15 mutations/actions without `onError` (silent failures); stale `['income-history']`; dead `['overrides']` invalidations.

**Convention violations**: client-side business math (expense calendar schedule & totals, filtered totals, Sankey member split, savings rate, allocated net); client-computed net submitted to the API; manual API calls outside mutations; `lib/styles.ts` ignored (~65 inlined button strings); hand-rolled modal.

**Duplication**: `Household` type ×9, `Category` ×5, `Currency` ×4 (one wrong), `BudgetYear` ×4; `['households']` query ×6; `/users/me` cached under 3 keys; API-error extraction ×46; ExpensesPage ≈70% copy of SavingsPage. IncomePage is 2,585 lines.

**Dead code**: `pages/HouseholdsPage.tsx` (unrouted), `selectClass`, `clsx` dependency, `packages/` placeholder.

## 6. Infra, tooling, docs

- **CI runs no tests/typecheck/lint**; pushes `:latest` on every main push; Trivy scans stale `:latest` on tag builds; `trivy-action@master` unpinned.
- Deploy compose doesn't pass `ANTHROPIC_API_KEY`, `SCHEMA_SYNC_MODE`, `API_RATE_LIMIT_*`, `RECEIPT_*`, `LOCAL_AI_*` → documented features can't be enabled.
- OMV compose defaults `SEED_DEMO_DATA=true` (demo users with `demo1234` in production) and has no required-secret guards.
- No `.dockerignore` (host `node_modules` with Windows binaries copied into web image); web image on Node 20 vs API on Node 22; `npm install` instead of `npm ci`; no API healthcheck.
- Local non-Docker dev never loads `.env` (no dotenv); Vite proxy `/api` prefix not stripped.
- Seed logs admin password in plaintext; runs receipt training seed twice; reverts admin edits to seeded mappings on every boot.
- Missing FK indexes on most hot columns (`Expense.budgetYearId`, `SavingsEntry.budgetYearId`, `BudgetYear.householdId`, `Job.userId`, `RefreshToken.userId`, …). `CurrencyRate` grows unbounded; expired refresh tokens never purged.
- API tests excluded from `tsc`; API tsconfig less strict than web.
- Version drift: API 0.14.1, CHANGELOG 0.58.1, root/web 0.1.0.
- Docs contradict each other and code: CONTRIBUTING (`db push`, nonexistent root compose, swagger, `packages/shared`), CLAUDE.md vs AGENTS.md (error shape, public routes, "never hard delete"), architecture.md lists a nonexistent `GET /households/:id/members`, `.env.example` missing several vars.

---

## Proposed refactor plan

Each phase is a separate branch/PR; later phases depend on the safety net from phase 0.

**Phase 0 — Safety net**
CI workflow on PRs (`npm ci`, `tsc --noEmit` both apps incl. tests, vitest, eslint) gating image publish; working ESLint config; baseline Prisma migration + ship migrations in image; global Fastify error handler (P2002→409, P2025→404, generic 500); `.dockerignore`; dotenv for local dev.

**Phase 1 — Data-integrity fixes** (need product decisions, see below)
Occurrence paid-marking, idempotent rollover, budget-year lifecycle cron, FX sync fixes (shared `computeMonthlyInBase`), copy-year fields, enum ordering (`pickDefaultBudgetYear` everywhere), household delete cascade, bonuses in income, FX in history. Each with Vitest coverage.

**Phase 2 — Security**
`trustProxy` + nginx headers, revoke tokens on password change, `requireHouseholdMember/Admin` preHandlers (check `isActive`, attach membership), `assertWritableBudgetYear`, server-side `mustChangePassword`, category scoping, OCR timeouts, Docker TLS flags.

**Phase 3 — Frontend quick fixes**
Keyed `<Outlet>`, cache clear on logout, currency `code`, `onError` via shared `getApiError`, allocation save, `??` for overrides, double currency, date helpers.

**Phase 4 — Structural refactor**
API: consolidate duplicated lib logic (salary-for-month ×5, Danish deductions mapping ×4, income share ×3, ownership partition ×3, custom-split transaction ×8), move hard deletes to soft deletes, add indexes.
Web: `api/types.ts`, query-key factory + shared query hooks, shared components (ConfirmDialog, BudgetYearSelector, OwnershipFields, AccountSelect…), split IncomePage/ExpensesPage/SavingsPage/DashboardPage, share Expenses/Savings form, move remaining calculations server-side, delete dead code, code-split routes.

**Phase 5 — Receipts**
Parser fixes (word-boundary keywords, thousands separators, dates, å), idempotent/transactional confirm, noise-learning guard, mapping normalization, store printed total, config caching, route tests.

**Phase 6 — Docs & deploy**
Reconcile CLAUDE.md/AGENTS.md/CONTRIBUTING/architecture.md, compose env passthrough, OMV defaults, versioning, CHANGELOG.
