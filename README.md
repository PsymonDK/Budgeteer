# ☠️ Budgeteer

**Self-hosted household budget tracker.** Track recurring income and expenses across multiple households, split costs between members by income proportion, and spot patterns with visual dashboards — all on your own infrastructure.

---

## Features

- **Multi-household support** — manage budgets for separate households from one account
- **Income splitting** — costs divided between household members proportionally to their income contribution
- **Flexible expense frequencies** — weekly, fortnightly, monthly, quarterly, biannual, and annual expenses all normalised to a monthly equivalent
- **Budget years & simulations** — create future budgets or what-if simulations alongside your active year
- **Savings tracking** — planned savings with per-member ownership splits and custom categories
- **Income flow diagram** — Sankey chart showing how each member's income flows into expense categories, savings, and surplus
- **Expense calendar** — yearly grid view showing exactly which months each charge hits
- **Year-over-year comparison** — side-by-side view of any two budget years or simulations
- **Multi-currency** — exchange rates synced daily from Danmarks Nationalbank; historical expenses lock their rate
- **Personal income management** — track jobs, salary history, monthly overrides, bonuses, and payslip import (CSV template or AI-assisted)
- **Admin panel** — manage users, households, currencies, and categories

---

## Self-hosting

### Requirements

- Docker and Docker Compose v2

### Install

**1. Download the deployment files**

```bash
mkdir budgeteer && cd budgeteer
curl -O https://raw.githubusercontent.com/PsymonDK/Budgeteer/main/deploy/docker-compose.yml
curl -O https://raw.githubusercontent.com/PsymonDK/Budgeteer/main/deploy/.env.example
cp .env.example .env
```

**2. Set your secrets**

Open `.env` and fill in the three required values:

```dotenv
# Generate with: openssl rand -hex 32
JWT_SECRET=

# Internal database password (never exposed outside Docker)
POSTGRES_PASSWORD=

# Your admin login password
ADMIN_PASSWORD=
```

Everything else is optional — the defaults work out of the box.

**3. Start**

```bash
docker compose up -d
```

Open **http://localhost:7272** and log in with your admin credentials.

On first boot Budgeteer automatically sets up the database, creates your admin account, and seeds default categories and currencies. No manual setup required.

### Updating

```bash
docker compose pull && docker compose up -d
```

Schema changes are applied automatically on startup.

### Configuration

All configuration is via environment variables in `.env`. Required variables will prevent startup if missing.

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | Yes | — | Auth signing key. Generate with `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | Yes | — | Internal database password |
| `ADMIN_PASSWORD` | Yes | — | Password for the initial admin account |
| `ADMIN_EMAIL` | No | `admin@budgeteer.local` | Email for the initial admin account |
| `ADMIN_NAME` | No | `Admin` | Display name for the initial admin account |
| `APP_PORT` | No | `7272` | Host port the web UI is served on |
| `PUBLIC_URL` | No | `http://localhost:7272` | The URL your browser uses to reach the app. Change this when accessing via a hostname, IP, or reverse proxy (e.g. `https://budget.yourdomain.com`) |
| `BASE_CURRENCY` | No | `DKK` | Base currency for all calculations and display. Must be a currency Danmarks Nationalbank publishes rates for |
| `SEED_DEMO_DATA` | No | `false` | Set to `true` to populate demo households on first boot |
| `ANTHROPIC_API_KEY` | No | — | Enables AI-assisted payslip parsing. See [AI payslip parsing](#ai-payslip-parsing) below |

### Reverse proxy

If you're running behind Nginx Proxy Manager, Traefik, or similar, set `PUBLIC_URL` in your `.env` to the public URL (e.g. `https://budget.yourdomain.com`) and proxy your reverse proxy to port `7272`.
If you're running behind Nginx Proxy Manager, Traefik, or similar, set `PUBLIC_URL` in your `.env` to the public URL (e.g. `https://budget.yourdomain.com`) and point your reverse proxy to port `7272`.

See [deploy/README.md](deploy/README.md) for backup/restore instructions.

### AI payslip parsing

Budgeteer can use Claude to extract salary and deduction data from a payslip image, PDF, or pasted text. This is entirely opt-in — users must explicitly consent before any payslip data leaves the system.

To enable it, add your Anthropic API key to `.env`:

```dotenv
ANTHROPIC_API_KEY=sk-ant-...
```

If the key is not set, the AI import tab is hidden and the endpoint returns `503 AI_NOT_CONFIGURED`. The CSV template and manual entry import paths always work without it.

---

## Development

### Requirements

- Node.js 20+
- PostgreSQL (or use the Docker Compose dev setup: `docker-compose.dev.yml`)

### Setup

```bash
git clone https://github.com/PsymonDK/Budgeteer.git
cd Budgeteer
cp .env.example .env   # edit DATABASE_URL and other vars as needed
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

To spin up a local Postgres instance instead of installing it bare-metal:

```bash
docker compose -f docker-compose.dev.yml up postgres -d
```

The API runs on `http://localhost:3001` and the web app on `http://localhost:5173`.

### Docker dev environment (full stack in containers)

`docker-compose.dev.yml` builds and runs the entire stack — Postgres, API, and web — from source, without needing Node.js installed locally.

**1. Build and start**

```bash
docker compose -f docker-compose.dev.yml up --build
```

The app is available at **http://localhost:7272**. Default credentials: `admin@budgeteer.local` / `changeme123`.

**2. Override settings (optional)**

The dev compose file reads from a `.env` file in the project root. The defaults work out of the box, but you can override any of these:

```dotenv
JWT_SECRET=dev-secret-change-in-production
ADMIN_EMAIL=admin@budgeteer.local
ADMIN_PASSWORD=changeme123
ADMIN_NAME=Admin
SEED_DEMO_DATA=false
BASE_CURRENCY=DKK
APP_PORT=7272
```

**3. Rebuild after code changes**

```bash
docker compose -f docker-compose.dev.yml up --build
```

**4. Stop and clean up**

```bash
docker compose -f docker-compose.dev.yml down        # stop, keep data
docker compose -f docker-compose.dev.yml down -v     # stop and delete database volume
```
To enable AI payslip parsing locally, add `ANTHROPIC_API_KEY` to your `.env`. It is optional — all other features work without it.

### Commands

| Command | Description |
|---|---|
| `npm run dev` | Start API + web concurrently |
| `npm run build` | Build both apps |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:seed` | Seed admin account, categories, and currencies |
| `npm run db:studio` | Open Prisma Studio |

See [docs/architecture.md](docs/architecture.md) for the full data model and API reference.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router v6, Recharts, D3/Sankey, Lucide React, Sonner |
| Backend | Node.js, TypeScript, Fastify, Prisma ORM, Zod, node-cron, @anthropic-ai/sdk |
| Database | PostgreSQL 16 |
| Auth | JWT + refresh tokens |
| Infrastructure | Docker, nginx |

---

## License

MIT
