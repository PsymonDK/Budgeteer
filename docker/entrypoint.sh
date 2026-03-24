#!/bin/sh
set -e

echo "→ Pushing database schema..."
./node_modules/.bin/prisma db push --schema=./prisma/schema.prisma

echo "→ Seeding database..."
./node_modules/.bin/ts-node prisma/seed.ts

echo "→ Starting API..."
exec node apps/api/dist/index.js
