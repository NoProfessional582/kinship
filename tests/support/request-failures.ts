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
