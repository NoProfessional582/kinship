// @vitest-environment jsdom
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBrowserReady, useInitialNow, useModifierKey, useClockNow } from '@/lib/hooks/platform'

function Probe() {
  const clock = useClockNow()
  const ready = useBrowserReady()
  const now = useInitialNow()
  const modifier = useModifierKey()
  return React.createElement(
    'div',
    { 'data-now': clock ?? '' },
    `${modifier}:${ready}:${now ? 'clock' : 'pending'}`,
  )
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('browser snapshots', () => {
  it('uses the server snapshot even when the test browser reports a Mac', () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
    const html = renderToString(React.createElement(Probe))
    expect(html).toContain('Ctrl')
    expect(html).toContain('false')
    expect(html).toContain('pending')
  })
  it.each([
    ['Macintosh', '⌘'],
    ['Windows', 'Ctrl'],
  ])('hydrates without mismatches on %s', async (userAgent, expected) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('navigator', { userAgent })
    const errors: unknown[] = []
    const container = document.createElement('div')
    container.innerHTML = renderToString(React.createElement(Probe))
    let root: ReturnType<typeof hydrateRoot>
    await React.act(async () => {
      root = hydrateRoot(container, React.createElement(Probe), {
        onRecoverableError: (error) => errors.push(error),
      })
    })
    expect(container.textContent).toBe(`${expected}:true:clock`)
    expect(errors).toEqual([])
    await React.act(async () => root!.unmount())
  })
})

it('updates the cached clock outside rendering and releases its timer', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  await React.act(async () => root.render(React.createElement(Probe)))
  const initial = Number(container.firstElementChild?.getAttribute('data-now'))
  await React.act(async () => vi.advanceTimersByTime(1000))
  expect(Number(container.firstElementChild?.getAttribute('data-now'))).toBe(initial + 1000)
  await React.act(async () => root.unmount())
  expect(vi.getTimerCount()).toBe(0)
})
