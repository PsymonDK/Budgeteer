// Outbound POSTs to URLs members and households enter (ntfy topics, webhooks). They must not be
// able to reach the server's own network: private, loopback, link-local and other special
// addresses are refused unless the admin allows private networks. The check runs on the address
// actually connected to (a custom DNS lookup), so DNS rebinding can't slip past it. Redirects
// aren't followed, and requests time out.
import dns from 'dns'
import http from 'http'
import https from 'https'
import net from 'net'

// Addresses a webhook may not reach without "Allow private-network addresses"
const blocked = new net.BlockList()
for (const [prefix, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(prefix, bits, 'ipv4')
for (const [prefix, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) {
  blocked.addSubnet(prefix, bits, 'ipv6')
}

/** Whether an IP address is private, loopback or otherwise not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4) return blocked.check(address, 'ipv4')
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:10.0.0.1) is judged by the IPv4 address
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return blocked.check(mapped[1], 'ipv4')
    return blocked.check(address, 'ipv6')
  }
  return true // not an IP address at all
}

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`${host} is a private-network address; the admin hasn't allowed webhooks to reach those`)
    this.name = 'BlockedAddressError'
  }
}

/**
 * Quick check when a URL is saved: http(s), and not an obviously private host (an IP literal or
 * localhost) unless private networks are allowed. Returns an error message, or null when fine.
 * Sending checks the resolved address again.
 */
export function checkWebhookUrl(raw: string, allowPrivate: boolean): string | null {
  let url: URL
  try { url = new URL(raw) } catch { return 'Enter a valid URL' }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Use an http:// or https:// URL'
  if (url.username || url.password) return 'Put credentials in the secret field, not the URL'
  if (allowPrivate) return null
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return new BlockedAddressError(host).message
  if (net.isIP(host) && isPrivateAddress(host)) return new BlockedAddressError(host).message
  return null
}

export interface PostResult { status: number; body: string }

/**
 * POSTs a body to an http(s) URL. Refuses private addresses (unless `allowPrivate`), doesn't
 * follow redirects, and treats anything but a 2xx answer as a failure.
 */
export function safePost(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  opts: { allowPrivate: boolean; timeoutMs?: number },
): Promise<PostResult> {
  const url = new URL(rawUrl)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!opts.allowPrivate && net.isIP(host) && isPrivateAddress(host)) return Promise.reject(new BlockedAddressError(host))

  // Every address the name resolves to must be public; the connection only uses checked ones
  const lookup: net.LookupFunction = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0)
      const list = addresses as dns.LookupAddress[]
      if (!opts.allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
        return callback(new BlockedAddressError(hostname), '', 0)
      }
      if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list)
      callback(null, list[0].address, list[0].family)
    })
  }

  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(body).toString(), 'User-Agent': 'Budgeteer', ...headers },
      lookup,
      timeout: opts.timeoutMs ?? 10_000,
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { if (data.length < 2000) data += chunk })
      res.on('end', () => {
        const status = res.statusCode ?? 0
        if (status >= 200 && status < 300) resolve({ status, body: data })
        else if (status >= 300 && status < 400) reject(new Error(`The server answered with a redirect (${status}); use the final URL`))
        else reject(new Error(`The server answered ${status}${data ? `: ${data.slice(0, 200)}` : ''}`))
      })
    })
    req.on('timeout', () => req.destroy(new Error('The server did not answer in time')))
    req.on('error', reject)
    req.end(body)
  })
}
