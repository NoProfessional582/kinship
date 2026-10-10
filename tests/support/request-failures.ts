/** A completed destination can supersede an unfinished Next RSC request. */
export function isCompletedRouterCancellation(input: {
  reason: string | undefined
  method: string
  headers: Record<string, string>
  url: string
  destination: string
  status: number | undefined
  contentType: string | undefined
}): boolean {
  if (input.reason !== 'net::ERR_ABORTED' || input.method !== 'GET' || input.status !== 200)
    return false
  if (input.headers.rsc !== '1' || !input.contentType?.startsWith('text/x-component')) return false
  try {
    const tree: unknown = JSON.parse(
      decodeURIComponent(input.headers['next-router-state-tree'] ?? ''),
    )
    if (!Array.isArray(tree) || tree[0] !== '' || typeof tree[1] !== 'object' || tree[1] === null)
      return false
  } catch {
    return false
  }
  const requested = new URL(input.url)
  const destination = new URL(input.destination)
  if (!requested.searchParams.has('_rsc') || requested.pathname.startsWith('/api/')) return false
  requested.searchParams.delete('_rsc')
  return (
    requested.origin === destination.origin &&
    requested.pathname === destination.pathname &&
    requested.searchParams.toString() === destination.searchParams.toString()
  )
}

/** A refusal a browser test causes on purpose: this status, for this request (path and query). */
export interface Refusal {
  status: number
  method: string
  path: string
}

const pathOf = (url: string) => {
  const { pathname, search } = new URL(url)
  return pathname + search
}

/** Which of the expected refusals this error response is, or -1 for none. */
export function refusalIndex(
  refusals: Refusal[],
  response: { status: number; method: string; url: string },
): number {
  const path = pathOf(response.url)
  return refusals.findIndex(
    (r) => r.status === response.status && r.method === response.method && r.path === path,
  )
}

/** Chrome's console line for a refused request, when that refusal is expected. */
export function isExpectedRefusalLog(
  refusals: Refusal[],
  message: { text: string; url: string },
): boolean {
  const status = /^Failed to load resource: the server responded with a status of (\d+) /.exec(
    message.text,
  )?.[1]
  if (!status || !message.url) return false
  const path = pathOf(message.url)
  return refusals.some((r) => r.status === Number(status) && r.path === path)
}
