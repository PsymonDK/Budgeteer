#!/bin/sh
set -e

SCHEMA_SYNC_MODE="${SCHEMA_SYNC_MODE:-push}"

case "$SCHEMA_SYNC_MODE" in
  skip)
    echo "→ Skipping database schema sync."
    ;;
  migrate)
    echo "→ Applying database migrations..."
    ./node_modules/.bin/prisma migrate deploy
    ;;
  force-push)
    echo "→ Pushing database schema with accept-data-loss enabled..."
    ./node_modules/.bin/prisma db push --accept-data-loss
    ;;
  push)
    echo "→ Pushing database schema..."
    ./node_modules/.bin/prisma db push
    ;;
  *)
    echo "Unknown SCHEMA_SYNC_MODE: $SCHEMA_SYNC_MODE" >&2
    exit 1
    ;;
esac

echo "→ Seeding database..."
./node_modules/.bin/ts-node prisma/seed.ts

echo "→ Starting API..."
exec node apps/api/dist/index.js
