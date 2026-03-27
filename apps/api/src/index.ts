import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import fastifyStatic from '@fastify/static'
import fastifyMultipart from '@fastify/multipart'
import fs from 'fs'
import path from 'path'
import cron from 'node-cron'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/users'
import { householdRoutes } from './routes/households'
import { categoryRoutes } from './routes/categories'
import { budgetYearRoutes } from './routes/budgetYears'
import { expenseRoutes } from './routes/expenses'
import { jobRoutes } from './routes/jobs'
import { dashboardRoutes } from './routes/dashboard'
import { compareRoutes } from './routes/compare'
import { savingsRoutes } from './routes/savings'
import { currencyRoutes } from './routes/currencies'
import { profileRoutes } from './routes/profile'
import { syncRates, BASE_CURRENCY } from './lib/currency'
import { prisma } from './lib/prisma'

const VERSION = process.env.npm_package_version ?? '0.14.0'

const app = Fastify({ logger: true })

// Plugins
app.register(cors, {
  origin: process.env.PUBLIC_URL ?? process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  credentials: true,
})

app.register(jwt, {
  secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
})

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads'
fs.mkdirSync(path.resolve(UPLOAD_DIR, 'avatars'), { recursive: true })

app.register(fastifyMultipart, { limits: { fileSize: 2 * 1024 * 1024 } })
app.register(fastifyStatic, {
  root: path.resolve(UPLOAD_DIR),
  prefix: '/uploads/',
  decorateReply: false,
})

// Routes
app.register(authRoutes)
app.register(userRoutes)
app.register(householdRoutes)
app.register(categoryRoutes)
app.register(budgetYearRoutes)
app.register(expenseRoutes)
app.register(jobRoutes)
app.register(dashboardRoutes)
app.register(compareRoutes)
app.register(savingsRoutes)
app.register(currencyRoutes)
app.register(profileRoutes)

// Health check
app.get('/health', async () => {
  return { status: 'ok', version: VERSION }
})

// App config (public, no auth required)
app.get('/config', async () => {
  return { baseCurrency: BASE_CURRENCY }
})

// Start
const start = async () => {
  try {
    const port = Number(process.env.API_PORT) || 3001
    await app.listen({ port, host: '0.0.0.0' })
    console.log(`API v${VERSION} running on port ${port}`)

    // Seed currency rates on first boot if table is empty
    const rateCount = await prisma.currencyRate.count()
    if (rateCount === 0) {
      try {
        const count = await syncRates()
        app.log.info(`Initial currency rate sync: ${count} currencies loaded`)
      } catch (err) {
        app.log.warn({ err }, 'Initial currency sync failed — rates will load on next daily sync')
      }
    }

    // Daily currency rate sync at 06:00
    cron.schedule('0 6 * * *', async () => {
      try {
        const count = await syncRates()
        app.log.info(`Currency rates synced: ${count} currencies updated`)
      } catch (err) {
        app.log.error({ err }, 'Failed to sync currency rates')
      }
    })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
