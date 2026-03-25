import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { requireAdmin } from '../plugins/authenticate'
import { syncRates, BASE_CURRENCY } from '../lib/currency'

export async function currencyRoutes(fastify: FastifyInstance) {
  // GET /currencies — latest rate for every known currency
  fastify.get('/currencies', { preHandler: authenticate }, async (_request, reply) => {
    const latest = await prisma.$queryRaw<{ currencyCode: string; rate: string; fetchedDate: Date }[]>`
      SELECT DISTINCT ON ("currencyCode") "currencyCode", rate::text, "fetchedDate"
      FROM "CurrencyRate"
      WHERE "baseCurrency" = ${BASE_CURRENCY}
      ORDER BY "currencyCode", "fetchedDate" DESC
    `

    return reply.send(
      latest.map((r) => ({
        code: r.currencyCode,
        rate: parseFloat(r.rate),
        baseCurrency: BASE_CURRENCY,
        fetchedDate: r.fetchedDate,
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

  // POST /admin/currencies/refresh — manual rate sync (admin only)
  fastify.post('/admin/currencies/refresh', { preHandler: requireAdmin }, async (_request, reply) => {
    const count = await syncRates()
    return reply.send({ updated: count, fetchedAt: new Date().toISOString() })
  })
}
