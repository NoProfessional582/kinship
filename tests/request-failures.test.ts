import { describe, it, expect } from 'vitest'
import {
  isCompletedRouterCancellation,
  isExpectedRefusalLog,
  refusalIndex,
} from './support/request-failures'
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

describe('refusals a browser test expects', () => {
  const refusals = [{ status: 404, method: 'GET', path: '/api/contacts/no-such-record' }]
  const response = {
    status: 404,
    method: 'GET',
    url: 'http://web:3000/api/contacts/no-such-record',
  }
  const log = {
    text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
    url: 'http://web:3000/api/contacts/no-such-record',
  }

  it('matches exactly that status, method and path', () => {
    expect(refusalIndex(refusals, response)).toBe(0)
    expect(isExpectedRefusalLog(refusals, log)).toBe(true)
  })

  it.each([
    { status: 500 },
    { method: 'DELETE' },
    { url: 'http://web:3000/api/contacts/other' },
    { url: 'http://web:3000/api/contacts/no-such-record?x=1' },
  ])('keeps any other error response fatal: %j', (patch) => {
    expect(refusalIndex(refusals, { ...response, ...patch })).toBe(-1)
  })

  it.each([
    { text: 'Failed to load resource: the server responded with a status of 500 (Server Error)' },
    { text: 'Uncaught Error: Not found' },
    { url: 'http://web:3000/api/contacts/other' },
    { url: '' },
  ])('keeps any other console error fatal: %j', (patch) => {
    expect(isExpectedRefusalLog(refusals, { ...log, ...patch })).toBe(false)
  })

  it('excuses nothing when no refusal is expected', () => {
    expect(refusalIndex([], response)).toBe(-1)
    expect(isExpectedRefusalLog([], log)).toBe(false)
  })
})
