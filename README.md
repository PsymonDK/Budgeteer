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

### Reverse proxy

If you're running behind Nginx Proxy Manager, Traefik, or similar, set `PUBLIC_URL` in your `.env` to the public URL (e.g. `https://budget.yourdomain.com`) and proxy your reverse proxy to port `7272`.

See [deploy/README.md](deploy/README.md) for backup/restore instructions and more configuration options.

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
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Recharts |
| Backend | Node.js, TypeScript, Fastify, Prisma ORM |
| Database | PostgreSQL 16 |
| Auth | JWT + refresh tokens |
| Infrastructure | Docker, nginx |

---

## License

MIT
