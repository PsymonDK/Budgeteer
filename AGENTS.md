# Agent Instructions

Budgeteer is a self-hosted household budget tracker with a React/Vite frontend, a Fastify API, Prisma, and PostgreSQL. It is pirate-themed in product copy and branding, but code and documentation should stay direct and practical.

For the full architecture, data model, and API reference, read `docs/architecture.md`. Keep `CLAUDE.md` and this file aligned when changing project-wide conventions.

## Repo Map

- `apps/api/` - Fastify API, auth, business logic, Prisma access, cron jobs, and tests.
- `apps/api/src/routes/` - REST route modules. Request validation belongs here with Zod.
- `apps/api/src/lib/` - shared backend domain logic such as calculations, currency handling, income, ownership, tax, automations, and budget transfers.
- `apps/api/src/plugins/` - Fastify plugins such as authentication.
- `apps/web/` - React 18 + TypeScript + Vite app.
- `apps/web/src/pages/` - route-level screens.
- `apps/web/src/components/` - reusable UI components.
- `apps/web/src/contexts/` - auth and household context providers.
- `apps/web/src/api/client.ts` - configured Axios client and refresh-token flow.
- `apps/web/src/lib/` - frontend constants, formatting helpers, styles, and preview-only utilities.
- `prisma/schema.prisma` - source of truth for database models.
- `prisma/migrations/` - committed schema migrations.
- `prisma/seed.ts` - development and first-boot seed data.
- `docker/` and `deploy/` - container builds, nginx config, entrypoint, and deployment docs.
- `docs/architecture.md` - canonical architecture, data model, calculations, and API inventory.

`packages/` currently only contains the placeholder `@budgeteer/shared` package. Do not move shared code there unless the package is wired into the workspace and build flow.

## Commands

Run commands from the repository root unless noted otherwise.

```bash
npm install
npm run dev
npm run build
npm run db:migrate
npm run db:generate
npm run db:seed
npm run db:studio
npm run test --workspace=apps/api
npm run lint --workspace=apps/web
```

The local development API runs on `http://localhost:3001`; the Vite web app runs on `http://localhost:5173`. The full Docker dev stack uses `docker-compose.dev.yml` and serves the app on `http://localhost:7272`.

## Architecture Rules

- Keep business logic and financial calculations on the server. React components may only calculate live form previews where an existing helper already exists for that purpose.
- Persist calculated `monthlyEquivalent` values on save. Do not recalculate persisted monthly equivalents at render time.
- Dashboard totals, income history, comparisons, and transfer summaries should come from pre-aggregated or ready-to-display API responses.
- Use Prisma for database access and migrations. Do not hand-edit generated Prisma client code.
- Use `Decimal`/Prisma decimal handling for money, rates, and percentages. Avoid JavaScript floating point math for persisted financial values.
- Use `cuid()` IDs, `Decimal(10,2)` monetary amounts, and `Decimal(5,2)` allocation percentages.
- Preserve financial history. Use `isActive` or `endDate` for soft deletion, and do not hard-delete user or financial data unless an existing admin-only route explicitly does that.
- Retired budget years are read-only. Simulations are editable.

## Currency And Income

- `BASE_CURRENCY` controls the base currency and defaults to DKK.
- Store all `monthlyEquivalent` values in base currency.
- Past expenses and savings lock their exchange rate at payment date. Future entries use the latest available rate and may be recalculated when rates sync.
- Income is modeled as Jobs -> SalaryRecords, MonthlyOverrides, Bonuses, TaxCardSettings, and HouseholdIncomeAllocations.
- Monthly overrides take precedence over salary records for that month.
- Bonus budgeting depends on user classification: excluded, one-off, or spread annually.
- Household income allocation is percentage-based per job per budget year. Over-allocation is a warning, not a blocking error.

## API Conventions

- API style is REST over JSON.
- Validate request bodies with Zod.
- All routes require authentication except `/auth/login`, `/health`, and public config where already implemented.
- Auth uses short-lived JWT access tokens plus rotated refresh tokens.
- System admin routes are prefixed with `/admin/` or protected with equivalent admin checks in existing route modules.
- Errors should follow the project shape: `{ error: string, code?: string }`. Existing routes sometimes include `details` for validation errors; keep that pattern when extending nearby code.
- Successful creates should return the created object with HTTP 201.
- Keep route modules small enough to follow, and move reusable domain behavior into `apps/api/src/lib/`.
- When a write affects derived budget transfers, summaries, or occurrences, update or trigger the relevant backend recalculation path rather than leaving stale derived data.

## Frontend Conventions

- Use TanStack Query for server state. Avoid ad hoc manual fetch calls in components.
- Use the configured Axios client in `apps/web/src/api/client.ts` so auth headers and refresh handling remain consistent.
- Keep forms controlled. Live previews may use existing preview helpers, but submitted values must be validated and calculated server-side.
- Display amounts in base currency unless the user is explicitly viewing foreign-currency detail.
- Warnings such as over-allocation, expenses greater than income, no savings, or uncategorised expenses are soft warnings and must not block user actions.
- Follow the existing Tailwind/component style. Prefer shared components and `apps/web/src/lib/styles.ts` before inventing new styling patterns.
- Use Lucide React for icons when an icon is needed.
- Keep layout routes aligned with `apps/web/src/App.tsx`: household routes use `HouseholdLayout`, admin routes use `AdminLayout`, and personal routes use `GlobalLayout`.

## Documentation And Deployment Sync

- Update `docs/architecture.md` whenever making architectural changes, including new entities, removed entities, new or removed API endpoints, schema changes, stack changes, or meaningful lifecycle changes.
- Always update `CHANGELOG.md` before committing any user-facing, architectural, schema, API, deployment, or behavior change. Add an entry under the current version, or create the next version section when the change is substantial, explaining what changed and why.
- If directories are added, removed, or moved, update both `docker/Dockerfile.api` and `docker/Dockerfile.web` as needed. These Dockerfiles copy source explicitly and must stay in sync with the repo layout.
- Keep README/deploy docs accurate when setup, environment variables, ports, or self-hosting behavior changes.

## Testing Guidance

- For backend calculation changes, add or update Vitest coverage near `apps/api/src/lib/calculations.test.ts` or the relevant lib test.
- For API behavior changes, prefer focused tests around the route or extracted domain function where possible.
- For frontend changes, run `npm run build --workspace=apps/web` at minimum; run lint when touching broad UI code.
- For schema changes, create a Prisma migration and run `npm run db:generate`.
- Always run the narrowest meaningful verification command before handing work back, and mention anything that could not be run.

## Workflow

- Each feature should map to a GitHub issue when project planning is in scope.
- Commit messages should reference issues, for example `feat: user login (#12)`.
- Branch names follow patterns such as `feature/AUTH-001-user-login` or `fix/EXP-003-delete-expense`.
- Sprints are tracked as GitHub Milestones.
