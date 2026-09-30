import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import http from 'http'
import type { AddressInfo } from 'net'
import { BlockedAddressError, checkWebhookUrl, isPrivateAddress, safePost } from './safeHttp'
import {
  createWebhookChannel, postToWebhook, renderJsonPayload, renderNtfyMessage, signPayload, splitNtfyUrl,
} from './channels/webhook'
import type { Reminder } from './reminders'

const reminder = (key: string, stage: Reminder['stage'], dueDate: string, householdId = 'h1'): Reminder => ({
  stage, daysUntilDue: 0,
  item: { key, kind: 'expense', label: key === 'expense:power' ? 'Elværk' : key, amount: '270', dueDate, householdId, householdName: 'Hjem', budgetYearId: 'by', recipientIds: ['a'] },
})
const digest = { date: '2026-09-30', reminders: [reminder('expense:power', 'OVERDUE', '2026-08-20'), reminder('expense:tv', 'DUE_SOON', '2026-10-01')] }
const opts = { appUrl: 'https://budget.example.com', currency: 'DKK' }

describe('private addresses', () => {
  it('blocks loopback, private, link-local and special ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })

  it('lets public addresses through', () => {
    for (const ip of ['1.1.1.1', '159.203.148.75', '2606:4700:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false)
  })

  it('checks a URL when it is saved', () => {
    expect(checkWebhookUrl('https://ntfy.sh/our-bills', false)).toBeNull()
    expect(checkWebhookUrl('http://192.168.1.10/topic', false)).toMatch(/private-network/)
    expect(checkWebhookUrl('http://localhost:8080/x', false)).toMatch(/private-network/)
    expect(checkWebhookUrl('http://192.168.1.10/topic', true)).toBeNull()
    expect(checkWebhookUrl('ftp://ntfy.sh/x', false)).toMatch(/http/)
    expect(checkWebhookUrl('https://user:pw@ntfy.sh/x', false)).toMatch(/secret field/)
  })
})

describe('safePost', () => {
  let server: http.Server
  let base: string
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = []
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        received.push({ headers: req.headers, body })
        if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://169.254.169.254/' }); return res.end() }
        if (req.url === '/fail') { res.writeHead(500); return res.end('boom') }
        res.writeHead(200); res.end('ok')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('refuses private addresses unless allowed', async () => {
    await expect(safePost(`${base}/hook`, '{}', {}, { allowPrivate: false })).rejects.toBeInstanceOf(BlockedAddressError)
    const port = (server.address() as AddressInfo).port
    await expect(safePost(`http://localhost:${port}/hook`, '{}', {}, { allowPrivate: false })).rejects.toBeInstanceOf(BlockedAddressError)
    await expect(safePost(`${base}/hook`, '{"a":1}', { 'Content-Type': 'application/json' }, { allowPrivate: true })).resolves.toMatchObject({ status: 200 })
    expect(received.at(-1)?.body).toBe('{"a":1}')
  })

  it('does not follow redirects and reports errors', async () => {
    await expect(safePost(`${base}/redirect`, '{}', {}, { allowPrivate: true })).rejects.toThrow(/redirect/)
    await expect(safePost(`${base}/fail`, '{}', {}, { allowPrivate: true })).rejects.toThrow(/500: boom/)
  })
})

describe('ntfy', () => {
  it('splits a topic URL into server and topic, also on a sub-path', () => {
    expect(splitNtfyUrl('https://ntfy.sh/our-bills')).toEqual({ server: 'https://ntfy.sh', topic: 'our-bills' })
    expect(splitNtfyUrl('https://home.example/ntfy/bills/')).toEqual({ server: 'https://home.example/ntfy', topic: 'bills' })
    expect(() => splitNtfyUrl('https://ntfy.sh/')).toThrow(/topic/)
  })

  it('renders the digest as a message with urgency and a link', () => {
    const m = renderNtfyMessage(digest, opts, 'our-bills')
    expect(m).toMatchObject({ topic: 'our-bills', title: '2 payments to make by hand: 1 overdue', priority: 4, click: 'https://budget.example.com/households/h1' })
    expect(m.message).toContain('• Elværk — 270.00 DKK — Overdue since Thu 20 Aug')
  })

  it('posts JSON to the server with the access token', async () => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = []
    await postToWebhook({ url: 'https://ntfy.sh/our-bills', format: 'NTFY', secret: 'tk_abc' }, { ntfy: (topic) => ({ topic }), json: () => ({}) },
      { allowPrivate: false }, async (url, body, headers) => { calls.push({ url, body, headers }); return { status: 200, body: '' } })
    expect(calls[0]).toMatchObject({ url: 'https://ntfy.sh', body: '{"topic":"our-bills"}', headers: { Authorization: 'Bearer tk_abc' } })
  })
})

describe('JSON webhook', () => {
  it('has a documented payload', () => {
    const p = renderJsonPayload({ userId: 'anna', name: 'Anna' }, digest, opts)
    expect(p).toMatchObject({ type: 'budgeteer.reminder_digest', version: 1, date: '2026-09-30', recipient: { kind: 'member', id: 'anna' } })
    expect(p.reminders[0]).toEqual({
      key: 'expense:power', kind: 'expense', label: 'Elværk', amount: '270', currency: 'DKK', dueDate: '2026-08-20', stage: 'OVERDUE',
      daysUntilDue: 0, household: { id: 'h1', name: 'Hjem' }, url: 'https://budget.example.com/households/h1',
      markPaidUrl: null, markPaidPage: null,
    })
    expect(renderJsonPayload({ userId: null, householdId: 'h1', name: 'Hjem' }, digest, opts).recipient).toEqual({ kind: 'household', id: 'h1', name: 'Hjem' })
  })

  it('signs the body so a receiver can verify it', async () => {
    const calls: { body: string; headers: Record<string, string> }[] = []
    const channel = createWebhookChannel({ ...opts, allowPrivate: false }, async (_u, body, headers) => { calls.push({ body, headers }); return { status: 200, body: '' } })
    await channel.send({ userId: 'anna', name: 'Anna', destination: 'https://hooks.example/x', webhook: { url: 'https://hooks.example/x', format: 'JSON', secret: 's3cret' } }, digest)
    const { body, headers } = calls[0]
    const expected = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(`${headers['X-Budgeteer-Timestamp']}.${body}`).digest('hex')
    expect(headers['X-Budgeteer-Signature']).toBe(expected)
    expect(signPayload('s3cret', headers['X-Budgeteer-Timestamp'], body)).toBe(expected)
  })

  it('sends no signature without a secret', async () => {
    const calls: Record<string, string>[] = []
    await postToWebhook({ url: 'https://hooks.example/x', format: 'JSON', secret: null }, { ntfy: () => ({}), json: () => ({ a: 1 }) },
      { allowPrivate: false }, async (_u, _b, headers) => { calls.push(headers); return { status: 200, body: '' } })
    expect(calls[0]['X-Budgeteer-Signature']).toBeUndefined()
  })
})

describe('Mark-as-paid links in webhooks', () => {
  const links = new Map([
    ['OVERDUE:expense:power', { page: 'https://b.example/r/tok1', post: 'https://b.example/api/reminder-actions/tok1' }],
    ['DUE_SOON:expense:tv', { page: 'https://b.example/r/tok2', post: 'https://b.example/api/reminder-actions/tok2' }],
  ])
  const withLinks = { ...digest, actionLinks: links }

  it('adds ntfy action buttons that POST to mark each one paid', () => {
    const m = renderNtfyMessage(withLinks, opts, 't')
    expect(m.actions).toEqual([
      { action: 'http', label: 'Paid: Elværk', url: 'https://b.example/api/reminder-actions/tok1', method: 'POST', clear: false },
      { action: 'http', label: 'Paid: expense:tv', url: 'https://b.example/api/reminder-actions/tok2', method: 'POST', clear: false },
    ])
    expect(renderNtfyMessage(digest, opts, 't').actions).toBeUndefined()
  })

  it('includes the links in the JSON payload', () => {
    const p = renderJsonPayload({ userId: 'a', name: 'A' }, withLinks, opts)
    expect(p.reminders[0]).toMatchObject({ markPaidUrl: 'https://b.example/api/reminder-actions/tok1', markPaidPage: 'https://b.example/r/tok1' })
  })
})
