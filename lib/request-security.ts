import { ConfigurationError } from './errors'

export type RequestRefusal = { status: 403 | 415; error: string }
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const JSON_METHODS = new Set(['POST', 'PUT', 'PATCH'])
const INTERNAL_HEALTH_ORIGIN = 'http://127.0.0.1:3000'
const MCP_PATH = '/api/mcp'

/** Exact origins, not hostname suffixes. Docker preserves the browser's Host/port. */
export function allowedOrigins(): Set<string> {
  const configured = process.env.KINSHIP_ALLOWED_ORIGINS?.trim()
  const port = process.env.KINSHIP_PORT?.trim() || '3000'
  if (!configured && (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    throw new ConfigurationError('KINSHIP_PORT must be a port between 1 and 65535.')
  }
  const values = configured
    ? configured.split(',').map((s) => s.trim())
    : ['http://127.0.0.1:' + port, 'http://localhost:' + port]
  const origins = new Set<string>()
  for (const value of values) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new ConfigurationError('KINSHIP_ALLOWED_ORIGINS must contain exact HTTP origins.')
    }
    if (
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.hostname.includes('*')
    ) {
      throw new ConfigurationError('KINSHIP_ALLOWED_ORIGINS must contain exact HTTP origins.')
    }
    origins.add(url.origin)
  }
  return origins
}

const denied = (error: string): RequestRefusal => ({ status: 403, error })

/** Never use forwarded headers to choose a trusted destination. */
function targetOrigin(req: Request): string | null {
  const host = req.headers.get('host')
  if (!host || /[\s/\\?#@,]/.test(host)) return null
  try {
    const target = new URL('http://' + host)
    if (target.username || target.password || target.pathname !== '/') return null
    return target.origin
  } catch {
    return null
  }
}

function sourceMatches(value: string, target: string, isReferer = false): boolean {
  try {
    const url = new URL(value)
    return (
      url.origin === target &&
      !url.username &&
      !url.password &&
      (isReferer || (value === url.origin && !url.search && !url.hash))
    )
  } catch {
    return false
  }
}

/**
 * Whether a request carries a browser's provenance from a Kinship page: an
 * `Origin` naming this app and `Sec-Fetch-Site: same-origin`. `requestRefusal`
 * checks both only when present, so curl and scripts work; a route that should
 * change only from the app's own pages asks for them to be present as well.
 *
 * A program on this computer can still send both headers on purpose. This keeps
 * an agent from flipping a setting with an ordinary API call; it is not a wall
 * against local code (which can reach the database directly anyway).
 */
export function hasBrowserProvenance(req: Request): boolean {
  const target = targetOrigin(req)
  const origin = req.headers.get('origin')
  return (
    target !== null &&
    origin !== null &&
    allowedOrigins().has(target) &&
    sourceMatches(origin, target) &&
    req.headers.get('sec-fetch-site') === 'same-origin'
  )
}

/**
 * Local-only request gate. Browser provenance is validated before media types
 * or route handlers; a static import confirmation is not an origin check.
 * Originless, provenance-free CLI requests still work on an allowed Host.
 */
export function requestRefusal(req: Request): RequestRefusal | null {
  const origins = allowedOrigins()
  const target = targetOrigin(req)
  const pathname = new URL(req.url).pathname
  const method = req.method.toUpperCase()
  // The health probe runs inside Docker at 3000, even with another public port.
  // This exception cannot expose an archive or authorize any write.
  const internalHealth =
    pathname === '/api/health' &&
    (method === 'GET' || method === 'HEAD') &&
    target === INTERNAL_HEALTH_ORIGIN
  if (!target || (!origins.has(target) && !internalHealth)) {
    return denied('Request host is not allowed.')
  }
  if (SAFE_METHODS.has(method)) return null

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  const site = req.headers.get('sec-fetch-site')
  if (origin !== null && !sourceMatches(origin, target)) {
    return denied('Request origin is not allowed.')
  }
  if (referer !== null && !sourceMatches(referer, target, true)) {
    return denied('Request origin is not allowed.')
  }
  // "same-site" is not "same-origin": another local port is a different origin.
  if (site !== null && site !== 'same-origin') {
    return denied('Request origin is not allowed.')
  }
  const browserHeaders = ['sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user']
  // Node's fetch (undici) sends `Sec-Fetch-Mode: cors` and nothing else of the kind, and
  // MCP clients (Claude Code, the MCP SDK) run on it. On /api/mcp that one header alone is
  // not a browser: a browser's POST always carries an Origin, checked above.
  const nodeFetch =
    pathname === MCP_PATH &&
    req.headers.get('sec-fetch-mode') === 'cors' &&
    !req.headers.has('sec-fetch-dest') &&
    !req.headers.has('sec-fetch-user')
  if (
    origin === null &&
    referer === null &&
    site === null &&
    !nodeFetch &&
    browserHeaders.some((header) => req.headers.has(header))
  ) {
    return denied('Request origin is not allowed.')
  }

  if (pathname.startsWith('/api/') && JSON_METHODS.has(method)) {
    const media = req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
    if (media !== 'application/json')
      return { status: 415, error: 'Content-Type must be application/json.' }
  }
  return null
}
