import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../plugins/authenticate'
import { parsePayslipWithAI } from '../lib/payslipParser'

const ParseBodySchema = z.object({
  fileBase64: z.string().optional(),
  mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']).optional(),
  rawText: z.string().min(1).max(100_000).optional(),
}).refine(
  (d) => (d.fileBase64 && d.mimeType) || d.rawText,
  { message: 'Either fileBase64+mimeType or rawText is required' },
)

export async function payslipRoutes(fastify: FastifyInstance) {
  /**
   * POST /jobs/:id/payslips/parse
   *
   * AI-assisted payslip parsing (opt-in only).
   * Requires ANTHROPIC_API_KEY env var and explicit user consent (enforced in frontend).
   * No data is persisted — returns extraction result for user review.
   */
  fastify.post('/jobs/:id/payslips/parse', {
    onRequest: [authenticate],
  }, async (request, reply) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(503).send({ error: 'AI parsing is not enabled on this server', code: 'AI_NOT_CONFIGURED' })
    }

    const { id: jobId } = request.params as { id: string }
    const { sub: userId } = request.user

    // Verify job belongs to authenticated user
    const job = await prisma.job.findFirst({
      where: { id: jobId, userId },
    })
    if (!job) {
      return reply.status(404).send({ error: 'Job not found', code: 'NOT_FOUND' })
    }

    const body = ParseBodySchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: body.error.errors[0].message, code: 'VALIDATION_ERROR' })
    }

    try {
      const extraction = await parsePayslipWithAI(body.data)
      return reply.status(200).send(extraction)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Parsing failed'
      return reply.status(422).send({ error: message, code: 'PARSE_ERROR' })
    }
  })
}
