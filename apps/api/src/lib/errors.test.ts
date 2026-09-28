import { describe, it, expect } from 'vitest'
import { toErrorResponse } from './errors'

function prismaKnown(code: string) {
  return Object.assign(new Error('\nInvalid `prisma.x.update()` invocation in /app/src/routes/x.ts:12'), {
    name: 'PrismaClientKnownRequestError',
    code,
  })
}

describe('toErrorResponse', () => {
  it('maps Prisma record-not-found to 404', () => {
    expect(toErrorResponse(prismaKnown('P2025'))).toEqual({
      statusCode: 404,
      body: { error: 'Not found', code: 'NOT_FOUND' },
    })
  })

  it('maps Prisma unique and foreign key violations to 409', () => {
    expect(toErrorResponse(prismaKnown('P2002')).statusCode).toBe(409)
    expect(toErrorResponse(prismaKnown('P2003')).body.code).toBe('FOREIGN_KEY_CONSTRAINT')
  })

  it('does not leak unknown Prisma error messages', () => {
    const res = toErrorResponse(prismaKnown('P9999'))
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })

  it('maps Prisma validation errors to 400 without the query text', () => {
    const err = Object.assign(new Error('Argument `id`: Invalid value provided. Expected String, provided (String, String).'), {
      name: 'PrismaClientValidationError',
    })
    expect(toErrorResponse(err)).toEqual({ statusCode: 400, body: { error: 'Invalid request', code: 'BAD_REQUEST' } })
  })

  it('passes through Fastify client errors', () => {
    const err = Object.assign(new Error('Rate limit exceeded, retry in 15 minutes'), {
      statusCode: 429,
      code: 'FST_ERR_RATE_LIMIT',
    })
    expect(toErrorResponse(err)).toEqual({
      statusCode: 429,
      body: { error: 'Rate limit exceeded, retry in 15 minutes', code: 'FST_ERR_RATE_LIMIT' },
    })
  })

  it('treats schema validation errors as 400', () => {
    const err = Object.assign(new Error('body must be object'), { validation: [{}] })
    expect(toErrorResponse(err).statusCode).toBe(400)
  })

  it('hides details of unexpected errors', () => {
    expect(toErrorResponse(new Error('ENOENT: /var/secret/path'))).toEqual({
      statusCode: 500,
      body: { error: 'Internal server error', code: 'INTERNAL_ERROR' },
    })
    expect(toErrorResponse(Object.assign(new Error('boom'), { statusCode: 503 })).statusCode).toBe(500)
    expect(toErrorResponse(undefined).statusCode).toBe(500)
  })
})
