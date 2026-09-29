// Maps thrown errors to the project's `{ error, code }` response shape.
// Anything not recognised becomes a generic 500 so internals (Prisma queries,
// file paths, stack details) never reach the client.

export interface ErrorResponse {
  statusCode: number
  body: { error: string; code: string }
}

interface ErrorLike {
  name?: string
  code?: unknown
  statusCode?: unknown
  message?: string
  validation?: unknown
}

const PRISMA_KNOWN_ERRORS: Record<string, ErrorResponse> = {
  P2002: { statusCode: 409, body: { error: 'A record with these values already exists', code: 'CONFLICT' } },
  P2003: { statusCode: 409, body: { error: 'Related records prevent this operation', code: 'FOREIGN_KEY_CONSTRAINT' } },
  P2025: { statusCode: 404, body: { error: 'Not found', code: 'NOT_FOUND' } },
}

export function toErrorResponse(err: unknown): ErrorResponse {
  const e = (err ?? {}) as ErrorLike

  if (e.name === 'PrismaClientKnownRequestError' && typeof e.code === 'string') {
    const known = PRISMA_KNOWN_ERRORS[e.code]
    if (known) return known
  }

  // Invalid query arguments, e.g. a repeated query param arriving as an array
  if (e.name === 'PrismaClientValidationError') {
    return { statusCode: 400, body: { error: 'Invalid request', code: 'BAD_REQUEST' } }
  }

  // Fastify and plugin errors (body parsing, rate limiting, JWT, multipart
  // limits) carry a client-error status and a safe message.
  const statusCode = typeof e.statusCode === 'number' ? e.statusCode : undefined
  if (e.validation || (statusCode !== undefined && statusCode >= 400 && statusCode < 500)) {
    return {
      statusCode: statusCode ?? 400,
      body: {
        error: e.message || 'Bad request',
        code: typeof e.code === 'string' ? e.code : 'BAD_REQUEST',
      },
    }
  }

  return { statusCode: 500, body: { error: 'Internal server error', code: 'INTERNAL_ERROR' } }
}
