# User Stories & Requirements
 
Stories follow the format: **As a [role], I want to [action], so that [outcome].**
Acceptance criteria are listed per story. Stories are grouped into Releases and Sprints.
 
---
 
## Release 1 — Foundation
 
**Goal:** Working app with auth, households, and basic expense tracking. Deployable via Docker.
 
---
 
### Sprint 1 — Project Setup & Auth
 
**DEV-001: Project scaffolding**
As a developer, I want a monorepo project structure with frontend, backend, and shared packages set up, so that contributors have a clean starting point.
- Vite + React + TypeScript frontend boots
- Fastify + TypeScript API boots
- Shared package importable from both
- ESLint + Prettier configured
- README with setup instructions
 
**DEV-002: Docker setup**
As a self-hoster, I want to run the entire application with `docker-compose up`, so that I don't need to install Node or PostgreSQL manually.
- `docker-compose.yml` includes web, api, and postgres services
- `.env.example` documents all required environment variables
- Data persists in a named Docker volume
- App is accessible on a configurable port (default: 3000)
 
**DEV-003: Bare metal setup**
As a developer, I want a setup script that installs and configures the app without Docker, so that I can run it directly on a server.
- `scripts/setup.sh` installs dependencies, runs migrations, and seeds initial data
- Works on Ubuntu 22.04+
 
**AUTH-001: User login**
As a user, I want to log in with email and password, so that my data is private.
- JWT access token (15min) + refresh token (7 days) issued on login
- Refresh token rotated on use
- Invalid credentials return 401 with no detail leak
- Account lockout after 10 failed attempts
 
**AUTH-002: Session refresh**
As a logged-in user, I want my session to stay active while I'm using the app, so that I'm not logged out unexpectedly.
- Frontend transparently refreshes access token before expiry
- Expired refresh token redirects to login
 
**AUTH-003: Logout**
As a user, I want to log out, so that my account is secure on shared devices.
- Refresh token is invalidated on logout
- Frontend clears all local tokens
 
---
 
### Sprint 2 — System Admin & User Management
 
**ADMIN-001: First-run setup**
As the person installing the app, I want an initial admin account created during setup, so that I can access the system immediately.
- First run creates a default admin user with configurable credentials via env vars
- Prompted to change password on first login
 
**ADMIN-002: Create users**
As a system admin, I want to create user accounts, so that household members can access the app.
- Admin can create users with name, email, and temporary password
- User is prompted to change password on first login
- No self-registration (self-hosted, admin-controlled)
 
**ADMIN-003: Edit and deactivate users**
As a system admin, I want to edit or deactivate user accounts, so that I can manage access when people leave.
- Admin can edit name and email
- Admin can deactivate (not delete) accounts — deactivated users cannot log in
- Deactivated users' data is preserved
 
**ADMIN-004: View all households**
As a system admin, I want to see all households in the system, so that I can manage the installation.
- Admin dashboard lists all households with member count and status
- Regular users only see their own households
 
---
 
### Sprint 3 — Households
 
**HH-001: Create a household**
As a user, I want to create a household, so that I can set up a shared budget space.
- Household requires a name
- Creator automatically becomes household admin
- A user can create multiple households
 
**HH-002: Invite members to a household**
As a household admin, I want to add existing users to my household, so that we can share a budget.
- Admin selects from existing system users
- Added member gets member role by default
- Admin can assign admin role on addition or promote later
 
**HH-003: Remove a member**
As a household admin, I want to remove a member from a household, so that I can manage access.
- Household admin can remove any member
- Removed user's historical income allocations are preserved for reporting
- A household must always have at least one admin
 
**HH-004: User in multiple households**
As a user, I want to be a member of more than one household, so that I can manage different budget groups (e.g. personal and family).
- User sees all their households on their dashboard
- Switching household is a top-level navigation action
- Roles are independent per household
 
---
 
### Sprint 4 — Expense Categories
 
**CAT-001: View system categories**
As a user, I want to see a list of expense categories, so that I can organise my expenses.
- System-wide categories are available to all households
- Initial seed data includes sensible defaults (Housing, Transport, Utilities, Food & Groceries, Insurance, Subscriptions, Healthcare, Savings, Other)
 
**CAT-002: Create custom category**
As a household member, I want to create a category specific to my household, so that I can track niche expenses.
- Custom categories are scoped to the household
- Name must be unique within the household (can duplicate system names — the system warns but allows)
 
**CAT-003: Promote custom category to system-wide**
As a system admin, I want to promote a household's custom category to a system-wide category, so that other households can benefit from it.
- Admin sees a list of all custom categories with a promote action
- On promotion, the category becomes system-wide and is removed from the household scope
- All existing expenses using that category are updated
 
**CAT-004: Delete category**
As a household admin, I want to delete a custom category, so that I can keep things tidy.
- Custom categories can be deleted if no expenses are currently using them
- If expenses use the category, the admin is prompted to reassign before deletion
- System-wide categories can only be deleted by a system admin
 
---
 
### Sprint 5 — Expenses
 
**EXP-001: Add an expense to a budget year**
As a household member, I want to add a recurring expense, so that it appears in our budget calculations.
- Required fields: label, amount, frequency, category
- Frequency options: weekly, fortnightly, monthly, quarterly, biannual, annual
- Optional: frequency period (e.g. "month 1 of quarter"), notes
- Monthly equivalent is calculated and stored automatically
 
**EXP-002: Edit an expense**
As a household member, I want to edit an expense, so that I can correct mistakes or update amounts.
- All fields editable
- Monthly equivalent recalculated on save
 
**EXP-003: Delete an expense**
As a household member, I want to delete an expense, so that I can remove things that no longer apply.
- Soft confirmation dialog before delete
- Deleted expenses are removed from the budget year
 
**EXP-004: View all expenses for a budget year**
As a household member, I want to see a list of all expenses for the current budget year, so that I have an overview.
- Sortable by category, amount, frequency
- Filterable by category
- Shows both entered amount + frequency and monthly equivalent
- Shows running total monthly equivalent at the bottom
 
---
 
### Sprint 6 — Income
 
**INC-001: Add income entry**
As a user, I want to record my income, so that the household can calculate budget proportions.
- Required fields: label (e.g. "Salary", "Freelance"), amount, frequency
- Frequency: same options as expenses
- Monthly equivalent calculated automatically
 
**INC-002: Allocate income to a household**
As a user, I want to specify what percentage of an income source goes to a household, so that shared budgets reflect reality.
- Each income entry can have one allocation per household the user belongs to
- Allocations are percentages (0–100+, with warning if total > 100%)
- Unallocated income is valid (user keeps some income outside any household)
 
**INC-003: View income summary**
As a household member, I want to see the total income allocated to the household, so that I understand the total budget.
- Summary shows per-member monthly equivalent allocated to the household
- Shows combined household total
- Shows each member's income share % (used for expense splitting)
 
**INC-004: Over-allocation warning**
As a user, I want to be warned if I've allocated more than 100% of my income across households, so that I can catch data entry errors.
- Warning banner shown on income management screen
- Warning shown on household dashboard
- Does not block any actions
 
---
 
### Sprint 7 — Dashboard & Summary
 
**DASH-001: Household dashboard**
As a household member, I want a dashboard showing the current budget year at a glance, so that I can quickly understand our financial situation.
- Total monthly income (combined)
- Total monthly expenses (combined)
- Total monthly savings
- Monthly surplus/deficit (income − expenses − savings)
- Per-member expense split shown as amounts and percentages
 
**DASH-002: Monthly vs actual charge view**
As a household member, I want to see both the monthly equivalent and the actual charge for each expense, so that I know what to expect when bills arrive.
- Toggle between "monthly view" and "actual charge view"
- Actual charge view shows amount and when it occurs (e.g. "€360 every April")
 
**DASH-003: Soft warning banners**
As a household member, I want to see non-blocking warnings about budget issues, so that I can fix problems without being locked out.
- Warnings displayed as dismissible banners on dashboard
- See Notification Rules section for full list
 
---
 
## Release 2 — Budget Lifecycle & Comparisons
 
**Goal:** Full budget year management, simulations, and side-by-side comparison.
 
---
 
### Sprint 8 — Budget Years
 
**BY-001: Create a budget year**
As a household admin, I want to create a budget year, so that we can plan ahead.
- Budget years are created for a specific calendar year
- Status is automatically derived from the year (future / active / retired)
- A household can have multiple budget years
 
**BY-002: Copy a budget year**
As a household admin, I want to copy an existing budget year, so that I have a starting point for next year or a simulation.
- Any budget year can be copied
- Copies all expenses and savings entries
- Income allocations are not copied (they are user-level, not year-level)
- Copy destination: new year number OR simulation
- Simulation requires a name
 
**BY-003: Manage simulations**
As a household admin, I want to create, name, and edit simulations, so that I can model what-if scenarios.
- Multiple simulations allowed per year
- Simulations are fully editable (add/edit/delete expenses and savings)
- Simulation name is required (prompted on creation)
 
**BY-004: Promote a simulation**
As a household admin, I want to promote a simulation to active, so that our planning becomes our real budget.
- Promotes simulation to active status
- Current active budget is automatically retired
- Confirmation dialog explains what will happen
 
**BY-005: Retire a budget year manually**
As a household admin, I want to manually retire a budget year, so that I can archive plans that are no longer relevant.
- Only active or future budget years can be manually retired
- Retired budget years are read-only
 
---
 
### Sprint 9 — Comparison View
 
**COMP-001: Select two budgets to compare**
As a household member, I want to select any two budget years (including simulations) to compare side by side, so that I can understand what has changed.
- Dropdown selection of any budget years within the household
- Comparison loads both sets of data
 
**COMP-002: Side-by-side expense comparison**
As a household member, I want to see expenses from both budget years side by side, so that I can spot differences.
- New items in B (not in A) highlighted in green
- Removed items (in A but not B) highlighted in red
- Changed amounts highlighted in amber
- Unchanged items shown in neutral
 
**COMP-003: Summary comparison**
As a household member, I want a summary comparison of totals, so that I can see the big-picture financial impact of changes.
- Side-by-side totals: income, expenses, savings, surplus/deficit
- Delta shown (e.g. +€200/month in expenses)
 
**COMP-004: Slice comparison by category**
As a household member, I want to filter the comparison by expense category, so that I can focus on a specific area.
- Category multi-select filter
- Totals update to reflect filtered view
 
**COMP-005: Slice comparison by frequency**
As a household member, I want to filter the comparison by frequency, so that I can focus on specific billing cycles.
- Frequency filter (weekly, monthly, annual, etc.)
- Useful for reviewing only annual charges for example
 
**COMP-006: Slice comparison by time period**
As a household member, I want to view the comparison in different time periods, so that I can see monthly, quarterly, or annual totals.
- Toggle between monthly / quarterly / annual view
- All amounts recalculated accordingly
 
---
 
## Release 3 — Polish, UX & Open Source Readiness
 
**Goal:** App is polished, documented, and ready for public open-source release.
 
---
 
### Sprint 10 — Savings & Surplus
 
**SAV-001: Add savings entries**
As a household member, I want to record planned savings, so that I know how much of our income goes towards saving.
- Savings entries work identically to expenses (label, amount, frequency)
- Shown separately in dashboard with their own total
 
**SAV-002: Savings rate display**
As a household member, I want to see what percentage of income is going to savings, so that I can track our saving habits over time.
- Savings as % of total income shown on dashboard
- Historical savings rates shown if multiple retired budget years exist
 
**SAV-003: Affordability calculator**
As a household member, I want to see how much surplus income exists after expenses and savings, so that I know what I can afford to spend on holidays, luxuries, etc.
- Surplus = income − expenses − savings
- Shown prominently on dashboard
- "What if I saved X more?" simple slider to model ad-hoc
 
---
 
### Sprint 11 — Historical Overview
 
**HIST-001: View historical budget years**
As a household member, I want to see a list of all past budget years, so that I have a record of how our budget has changed.
- Timeline view of all budget years and their status
- Click to view a read-only summary of any retired year
 
**HIST-002: Year-over-year trend**
As a household member, I want to see how our total expenses, income, and savings have changed year over year, so that I can spot long-term trends.
- Line chart showing monthly equivalents across all budget years
- Filterable by category
 
---
 
### Sprint 12 — Open Source Readiness
 
**OSS-001: Contributor documentation**
As an open-source contributor, I want clear documentation, so that I can contribute effectively.
- CONTRIBUTING.md with setup, branching, and PR guidelines
- Architecture decision records (ADRs) for key choices
- API documented with OpenAPI/Swagger auto-generated from Fastify schemas
 
**OSS-002: Test coverage**
As a developer, I want a test suite, so that contributions don't introduce regressions.
- Unit tests for all calculation logic (monthly equivalents, income splits, splitting keys)
- Integration tests for all API endpoints
- Frontend component tests for dashboard and comparison views
 
**OSS-003: Seed data**
As a developer, I want seed data for local development, so that I can see a realistic app state immediately.
- Seed creates 2 households, 4 users, 3 budget years (retired, active, simulation), sample expenses and income
 
**OSS-004: Changelog and versioning**
As a user or self-hoster, I want a changelog and version number, so that I know what's changed between releases.
- CHANGELOG.md maintained
- Semantic versioning applied
- Version shown in app footer and API health endpoint
 
---
 
## Backlog (Future / Parked)
 
| ID | Feature | Notes |
|---|---|---|
| BANK-001 | Bank statement import (CSV) | Map bank transactions to expense categories, compare planned vs actual |
| BANK-002 | Open Banking integration | Direct feed from bank APIs |
| NOTIF-001 | Email notifications | Alert when upcoming large expenses are due |
| MOBILE-001 | Progressive Web App (PWA) | Offline support, installable on phone |
| EXPORT-001 | Export to PDF/Excel | Budget year summary export |
| API-001 | Public API / webhooks | For power users who want to build on top |
 
---
 
## Summary: Release Plan
 
| Release | Focus | Sprints | Outcome |
|---|---|---|---|
| **R1** | Foundation | 1–7 | Working app: auth, households, expenses, income, dashboard |
| **R2** | Lifecycle & Comparison | 8–9 | Budget years, simulations, side-by-side comparisons |
| **R3** | Polish & OSS | 10–12 | Savings, history, tests, docs — ready for public release |