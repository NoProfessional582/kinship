/** What the map's browser tests (map.spec.ts, mini-map.spec.ts) share. */
import type { Page } from '@playwright/test'

/** The page as a browser without WebGL sees it: no WebGL context can be made. */
export async function withoutWebgl(page: Page) {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      if (/webgl/.test(kind)) return null
      return (getContext as (...args: unknown[]) => unknown).call(this, kind, ...rest)
    } as typeof getContext
  })
}
