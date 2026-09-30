#!/bin/sh
set -e

SCHEMA_SYNC_MODE="${SCHEMA_SYNC_MODE:-push}"

# db push doesn't run the data steps in prisma/migrations; db-push-prepare.sql repeats
# them first, so a column whose data moved elsewhere can be dropped without losing it.
prepare_push() {
  echo "→ Preparing database for schema push..."
  ./node_modules/.bin/prisma db execute --file ./db-push-prepare.sql
}

case "$SCHEMA_SYNC_MODE" in
  skip)
    echo "→ Skipping database schema sync."
    ;;
  migrate)
    echo "→ Applying database migrations..."
    ./node_modules/.bin/prisma migrate deploy
    ;;
  force-push)
    prepare_push
    echo "→ Pushing database schema with accept-data-loss enabled..."
    ./node_modules/.bin/prisma db push --accept-data-loss
    ;;
  push)
    prepare_push
    echo "→ Pushing database schema..."
    if ! ./node_modules/.bin/prisma db push; then
      echo "✗ Schema push failed and made no changes. Please report it with the output above at" >&2
      echo "  https://github.com/PsymonDK/Budgeteer/issues. SCHEMA_SYNC_MODE=force-push drops the data" >&2
      echo "  Prisma warned about, so back up the database before using it." >&2
      exit 1
    fi
    ;;
  *)
    echo "Unknown SCHEMA_SYNC_MODE: $SCHEMA_SYNC_MODE" >&2
    exit 1
    ;;
esac

echo "→ Seeding database..."
node dist-seed/prisma/seed.js

echo "→ Starting API..."
exec node apps/api/dist/index.js
