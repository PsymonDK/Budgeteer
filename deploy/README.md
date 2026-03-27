# Budgeteer — Self-hosted deployment

> Three commands and you're done.

## Prerequisites

- Docker + Docker Compose v2 installed
- A machine with a spare port (default: **7272**)

---

## Quick start

**1. Download the two files**

```bash
mkdir budgeteer && cd budgeteer
curl -O https://raw.githubusercontent.com/PsymonDK/Budgeteer/main/deploy/docker-compose.yml
curl -O https://raw.githubusercontent.com/PsymonDK/Budgeteer/main/deploy/.env.example
cp .env.example .env
```

**2. Fill in the three required secrets**

Open `.env` in any text editor and set:

| Variable | What it is | How to generate |
|---|---|---|
| `JWT_SECRET` | Auth signing key | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | Database password | Any strong password |
| `ADMIN_PASSWORD` | Your login password | Any strong password |

Everything else has a sensible default and is optional.

**3. Start**

```bash
docker compose up -d
```

Open **http://localhost:7272** and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

On first boot, Budgeteer automatically:
- Runs database schema setup
- Creates your admin account
- Seeds default expense categories, savings categories, and currencies

---

## Updating

```bash
docker compose pull
docker compose up -d
```

Schema changes are applied automatically on startup.

---

## Behind a reverse proxy (Nginx Proxy Manager, Traefik, etc.)

1. Set `APP_URL` in your `.env` to the public URL, e.g. `https://budget.yourdomain.com`
2. Point your reverse proxy at port `7272` (or whatever `APP_PORT` you set)
3. The API is not exposed outside Docker — only the web UI port needs to be proxied

---

## Data

All data lives in the `postgres_data` Docker volume. To back up:

```bash
docker exec budgeteer-postgres-1 pg_dump -U budgeteer budgeteer > backup.sql
```

To restore:

```bash
cat backup.sql | docker exec -i budgeteer-postgres-1 psql -U budgeteer budgeteer
```
