import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { requireAdmin } from '../plugins/authenticate'
import { syncRates, BASE_CURRENCY } from '../lib/currency'

const CreateCurrencySchema = z.object({
  code: z.string().min(2).max(4).toUpperCase(),
  name: z.string().min(1).max(100),
  rate: z.number().positive(),
})

const UpdateCurrencySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isEnabled: z.boolean().optional(),
  rate: z.number().positive().optional(),
})

export async function currencyRoutes(fastify: FastifyInstance) {
  // GET /currencies — enabled currencies with latest rates (user-facing)
  // Returns currencies that have isEnabled = true in the Currency table,
  // or any currency from CurrencyRate that has no Currency row (backward compat).
  fastify.get('/currencies', { preHandler: authenticate }, async (_request, reply) => {
    // Start from the Currency table so enabled currencies are always returned,
    // even when CurrencyRate records don't exist yet (e.g. before the first sync).
    const latest = await prisma.$queryRaw<{
      currencyCode: string
      rate: string | null
      fetchedDate: Date | null
      name: string
    }[]>`
      SELECT DISTINCT ON (c.code)
        c.code          AS "currencyCode",
        cr.rate::text   AS rate,
        cr."fetchedDate",
        c.name
      FROM "Currency" c
      LEFT JOIN "CurrencyRate" cr
        ON cr."currencyCode" = c.code
       AND cr."baseCurrency" = ${BASE_CURRENCY}
      WHERE c."isEnabled" = true
      ORDER BY c.code, cr."fetchedDate" DESC NULLS LAST
    `

    return reply.send(
      latest.map((r) => ({
        code: r.currencyCode,
        name: r.name,
        rate: r.rate !== null ? parseFloat(r.rate) : null,
        baseCurrency: BASE_CURRENCY,
        fetchedDate: r.fetchedDate ?? null,
      }))
    )
  })

  // GET /currencies/:code/history — full rate history for a currency
  fastify.get('/currencies/:code/history', { preHandler: authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string }

    const rows = await prisma.currencyRate.findMany({
      where: { currencyCode: code.toUpperCase(), baseCurrency: BASE_CURRENCY },
      orderBy: { fetchedDate: 'desc' },
      select: { currencyCode: true, rate: true, baseCurrency: true, fetchedDate: true },
    })

    return reply.send(rows.map((r) => ({ ...r, rate: parseFloat(r.rate.toString()) })))
  })

  // GET /admin/currencies — all managed currencies with latest rate (admin only)
  fastify.get('/admin/currencies', { preHandler: requireAdmin }, async (_request, reply) => {
    const currencies = await prisma.currency.findMany({ orderBy: { code: 'asc' } })

    // Get latest rate for each currency
    const latestRates = await prisma.$queryRaw<{ currencyCode: string; rate: string; fetchedDate: Date }[]>`
      SELECT DISTINCT ON ("currencyCode") "currencyCode", rate::text, "fetchedDate"
      FROM "CurrencyRate"
      WHERE "baseCurrency" = ${BASE_CURRENCY}
      ORDER BY "currencyCode", "fetchedDate" DESC
    `
    const rateMap = new Map(latestRates.map((r) => [r.currencyCode, r]))

    return reply.send(
      currencies.map((c) => {
        const rateRow = rateMap.get(c.code)
        return {
          code: c.code,
          name: c.name,
          isEnabled: c.isEnabled,
          isBase: c.code === BASE_CURRENCY,
          rate: rateRow ? parseFloat(rateRow.rate) : null,
          lastUpdated: rateRow?.fetchedDate ?? null,
          createdAt: c.createdAt,
        }
      })
    )
  })

  // POST /admin/currencies — create a new managed currency (admin only)
  fastify.post('/admin/currencies', { preHandler: requireAdmin }, async (request, reply) => {
    const result = CreateCurrencySchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }
    const { code, name, rate } = result.data

    const existing = await prisma.currency.findUnique({ where: { code } })
    if (existing) {
      return reply.status(409).send({ error: 'Currency already exists' })
    }

    const [currency] = await prisma.$transaction([
      prisma.currency.create({ data: { code, name } }),
      prisma.currencyRate.create({
        data: { currencyCode: code, rate, baseCurrency: BASE_CURRENCY, fetchedDate: new Date() },
      }),
    ])

    const rateRow = await prisma.currencyRate.findFirst({
      where: { currencyCode: code, baseCurrency: BASE_CURRENCY },
      orderBy: { fetchedDate: 'desc' },
    })

    return reply.status(201).send({
      code: currency.code,
      name: currency.name,
      isEnabled: currency.isEnabled,
      isBase: currency.code === BASE_CURRENCY,
      rate: rateRow ? parseFloat(rateRow.rate.toString()) : rate,
      lastUpdated: rateRow?.fetchedDate ?? new Date(),
    })
  })

  // PATCH /admin/currencies/:code — update name, isEnabled, or rate (admin only)
  fastify.patch('/admin/currencies/:code', { preHandler: requireAdmin }, async (request, reply) => {
    const { code } = request.params as { code: string }
    const upper = code.toUpperCase()

    const result = UpdateCurrencySchema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: result.error.flatten() })
    }
    const { name, isEnabled, rate } = result.data

    const currency = await prisma.currency.findUnique({ where: { code: upper } })
    if (!currency) return reply.status(404).send({ error: 'Currency not found' })

    // Base currency cannot be disabled
    if (isEnabled === false && upper === BASE_CURRENCY) {
      return reply.status(400).send({ error: 'The base currency cannot be disabled' })
    }

    const updates: { name?: string; isEnabled?: boolean } = {}
    if (name !== undefined) updates.name = name
    if (isEnabled !== undefined) updates.isEnabled = isEnabled

    if (Object.keys(updates).length > 0) {
      await prisma.currency.update({ where: { code: upper }, data: updates })
    }

    if (rate !== undefined) {
      await prisma.currencyRate.create({
        data: { currencyCode: upper, rate, baseCurrency: BASE_CURRENCY, fetchedDate: new Date() },
      })
    }

    const updated = await prisma.currency.findUnique({ where: { code: upper } })
    const rateRow = await prisma.currencyRate.findFirst({
      where: { currencyCode: upper, baseCurrency: BASE_CURRENCY },
      orderBy: { fetchedDate: 'desc' },
    })

    return reply.send({
      code: updated!.code,
      name: updated!.name,
      isEnabled: updated!.isEnabled,
      isBase: updated!.code === BASE_CURRENCY,
      rate: rateRow ? parseFloat(rateRow.rate.toString()) : null,
      lastUpdated: rateRow?.fetchedDate ?? null,
    })
  })

  // POST /admin/currencies/refresh — manual rate sync (admin only)
  fastify.post('/admin/currencies/refresh', { preHandler: requireAdmin }, async (_request, reply) => {
    const count = await syncRates()
    return reply.send({ updated: count, fetchedAt: new Date().toISOString() })
  })
}
