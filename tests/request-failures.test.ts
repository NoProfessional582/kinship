import { describe, it, expect } from 'vitest'
import { isCompletedRouterCancellation } from './support/request-failures'
const completed = {
  reason: 'net::ERR_ABORTED',
  method: 'GET',
  status: 200,
  contentType: 'text/x-component',
  headers: { rsc: '1', 'next-router-state-tree': encodeURIComponent('["",{},null,"refetch"]') },
  url: 'http://web:3000/notes/example?_rsc=token',
  destination: 'http://web:3000/notes/example',
}
describe('completed Next route cancellation', () => {
  it('recognizes only the successful route response of the loaded destination', () => {
    expect(isCompletedRouterCancellation(completed)).toBe(true)
  })
  it.each([
    { reason: 'net::ERR_CONNECTION_RESET' },
    { method: 'POST' },
    { status: undefined },
    { status: 404 },
    { status: 500 },
    { contentType: 'application/json' },
    {
      headers: { rsc: '0', 'next-router-state-tree': completed.headers['next-router-state-tree'] },
    },
    { headers: { rsc: '1', 'next-router-state-tree': '' } },
    { headers: { rsc: '1', 'next-router-state-tree': '%' } },
    {
      headers: { rsc: '1', 'next-router-state-tree': encodeURIComponent('["",{},null,null,4608]') },
      status: 200,
      contentType: 'text/x-component',
      destination: 'http://web:3000/notes/other',
    },
    { url: 'http://web:3000/notes/example' },
    { destination: 'http://web:3000/notes/other' },
    { destination: 'http://other:3000/notes/example' },
    { destination: 'http://web:3000/notes/example?q=other' },
    { url: 'http://web:3000/api/search?_rsc=token', destination: 'http://web:3000/api/search' },
  ])('keeps a real or unclassified failure fatal: %j', (patch) => {
    expect(isCompletedRouterCancellation({ ...completed, ...patch })).toBe(false)
  })
})
