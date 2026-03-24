import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/users'
import { householdRoutes } from './routes/households'
import { categoryRoutes } from './routes/categories'

const app = Fastify({ logger: true })

// Plugins
app.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
})

app.register(jwt, {
  secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
})

// Routes
app.register(authRoutes)
app.register(userRoutes)
app.register(householdRoutes)
app.register(categoryRoutes)

// Health check
app.get('/health', async () => {
  return { status: 'ok', version: '0.1.0' }
})

// Start
const start = async () => {
  try {
    const port = Number(process.env.API_PORT) || 3001
    await app.listen({ port, host: '0.0.0.0' })
    console.log(`API running on port ${port}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
