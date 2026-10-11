/**
 * Times /map on the made-up 1,000-record, 3,000-link graph (support/synthetic-graph.ts),
 * served in place of the API's answer: the layout in the worker, the scene's build and
 * first frame, and the frames while the view is dragged round. Prints JSON with the times
 * and the browser's WebGL renderer; docs/graph-layout.md records the results.
 *
 * Headless Chromium usually draws WebGL in software (SwiftShader), so frame times here are
 * a floor on a machine with a graphics card, not a promise for one without.
 */
import { expect, test, type Page } from '@playwright/test'
import { syntheticGraph } from '../support/synthetic-graph'

const NODES = Number(process.env.MAP_BENCH_NODES ?? 1000)
const LINKS = Number(process.env.MAP_BENCH_LINKS ?? 3000)
const RUNS = Number(process.env.MAP_BENCH_RUNS ?? 3)
/** Pointer moves in one drag; each waits for the browser, so a slow frame slows the drag. */
const DRAG_STEPS = 30
const graph = syntheticGraph(NODES, LINKS)

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}
const round = (n: number) => Math.round(n * 10) / 10

async function measureOnce(page: Page) {
  await page.route('**/api/graph', (route) => route.fulfill({ json: graph }))
  await page.goto('/map')
  const canvas = page.getByTestId('graph-canvas').locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName('graph:first-draw').length), {
      timeout: 60_000,
    })
    .toBeGreaterThan(0)
  const marks = await page.evaluate(() => {
    const [layout] = performance.getEntriesByName('graph:layout')
    const [draw] = performance.getEntriesByName('graph:first-draw')
    return {
      layout: layout.duration,
      firstDraw: draw.duration,
      // From the start of the page's navigation to the end of the first frame.
      pageToFirstDraw: draw.startTime + draw.duration,
    }
  })

  // Frames while the view is dragged round: the gaps between the browser's frames.
  await page.evaluate(() => {
    const w = window as unknown as { frameTimes: number[]; frameStop: boolean }
    w.frameTimes = []
    w.frameStop = false
    const tick = (t: number) => {
      w.frameTimes.push(t)
      if (!w.frameStop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const box = (await canvas.boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.3, y)
  await page.mouse.down()
  for (let i = 0; i <= DRAG_STEPS; i++) {
    await page.mouse.move(
      box.x + box.width * (0.3 + (0.4 * i) / DRAG_STEPS),
      y + Math.sin(i / 10) * 40,
    )
  }
  await page.mouse.up()
  const stamps = await page.evaluate(() => {
    const w = window as unknown as { frameTimes: number[]; frameStop: boolean }
    w.frameStop = true
    return w.frameTimes
  })
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i])
  return {
    ...marks,
    frameMedian: median(gaps),
    frameP95: percentile(gaps, 0.95),
    frames: gaps.length,
  }
}

test(`render ${NODES} records and ${LINKS} links`, async ({ browser }) => {
  const runs: Awaited<ReturnType<typeof measureOnce>>[] = []
  let gl: { version: string; renderer: string; vendor: string } | undefined
  let agent = ''
  for (let run = 0; run < RUNS; run++) {
    const page = await browser.newPage()
    runs.push(await measureOnce(page))
    if (run === RUNS - 1) {
      gl = await page.evaluate(() => {
        const ctx = document.createElement('canvas').getContext('webgl2')
        const info = ctx?.getExtension('WEBGL_debug_renderer_info')
        return {
          version: ctx?.getParameter(ctx.VERSION) as string,
          renderer: info ? (ctx!.getParameter(info.UNMASKED_RENDERER_WEBGL) as string) : '?',
          vendor: info ? (ctx!.getParameter(info.UNMASKED_VENDOR_WEBGL) as string) : '?',
        }
      })
      agent = await page.evaluate(() => navigator.userAgent)
    }
    await page.close()
  }
  const pick = (key: keyof (typeof runs)[number]) => runs.map((r) => round(r[key]))
  console.log(
    JSON.stringify(
      {
        nodes: NODES,
        links: LINKS,
        runs: RUNS,
        ms: {
          layoutInWorker: pick('layout'),
          sceneBuildAndFirstFrame: pick('firstDraw'),
          pageToFirstFrame: pick('pageToFirstDraw'),
          frameWhileDraggingMedian: pick('frameMedian'),
          frameWhileDraggingP95: pick('frameP95'),
        },
        framesPerDrag: pick('frames'),
        gl,
        agent,
      },
      null,
      2,
    ),
  )
})
