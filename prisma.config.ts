import fs from 'fs'
import { defineConfig } from 'prisma/config'

// Prisma 7 no longer loads .env automatically. Existing env vars win.
if (fs.existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL as string,
  },
  migrate: {
    async adapter(env) {
      const { Pool } = await import('pg')
      const { PrismaPg } = await import('@prisma/adapter-pg')
      return new PrismaPg(new Pool({ connectionString: env.DATABASE_URL }))
    },
  },
})
