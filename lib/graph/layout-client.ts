/**
 * The map's side of the layout worker, without React so it can be tested with a stand-in
 * worker. One layout is wanted at a time: asking for a new one, or cancelling, stops the
 * worker mid-run (a layout cannot be interrupted any other way) and starts a fresh one on
 * the next request. An answer whose request id is not the one awaited is dropped, so a
 * stale layout is never handed back.
 */
import type { GraphData } from './constants'
import type { GraphLayout, LayoutOptions } from './layout3d'
import type { LayoutRequest, LayoutResponse } from './layout-messages'

/** The parts of a Worker used here. */
export interface LayoutWorker {
  postMessage(message: LayoutRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<LayoutResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
}

/** The layout was replaced by a newer one or cancelled: nothing to show, nothing wrong. */
export class LayoutCancelledError extends Error {
  constructor() {
    super('The layout was cancelled.')
    this.name = 'LayoutCancelledError'
  }
}

/** The worker refused the graph or stopped: its message is meant for the page. */
export class LayoutFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LayoutFailedError'
  }
}

export const WORKER_STOPPED = 'The map stopped while laying out the graph.'

export interface LayoutClient {
  /** Lays the graph out; replaces (and cancels) any layout still running. */
  layout(graph: GraphData, options?: LayoutOptions): Promise<GraphLayout>
  /** Stops the running layout, if any; its promise rejects with LayoutCancelledError. */
  cancel(): void
  /** Cancels and stops the worker for good. */
  dispose(): void
}

export function createLayoutClient(startWorker: () => LayoutWorker): LayoutClient {
  let worker: LayoutWorker | null = null
  let lastId = 0
  let disposed = false
  let pending: {
    id: number
    resolve: (layout: GraphLayout) => void
    reject: (err: Error) => void
  } | null = null

  const stopWorker = () => {
    if (!worker) return
    worker.onmessage = worker.onerror = worker.onmessageerror = null
    worker.terminate()
    worker = null
  }

  const fail = (err: Error) => {
    const waiting = pending
    pending = null
    waiting?.reject(err)
  }

  const running = () => {
    if (worker) return worker
    const started = startWorker()
    started.onmessage = (event) => {
      const answer = event.data
      if (!pending || answer.requestId !== pending.id) return
      const waiting = pending
      pending = null
      if ('error' in answer) waiting.reject(new LayoutFailedError(answer.error))
      else waiting.resolve(answer.layout)
    }
    // A worker that crashed or sent something unreadable is not trusted with the next
    // request: stop it, and the next request starts a fresh one.
    started.onerror = (event) => {
      event.preventDefault?.()
      stopWorker()
      fail(new LayoutFailedError(WORKER_STOPPED))
    }
    started.onmessageerror = () => {
      stopWorker()
      fail(new LayoutFailedError(WORKER_STOPPED))
    }
    worker = started
    return started
  }

  const cancel = () => {
    if (!pending) return
    // The worker is busy with work nobody wants; stopping it is the only way to end it.
    stopWorker()
    fail(new LayoutCancelledError())
  }

  return {
    layout(graph, options) {
      if (disposed) return Promise.reject(new LayoutCancelledError())
      cancel()
      const id = ++lastId
      return new Promise<GraphLayout>((resolve, reject) => {
        pending = { id, resolve, reject }
        const request: LayoutRequest = { requestId: id, nodes: graph.nodes, links: graph.links }
        if (options) request.options = options
        running().postMessage(request)
      })
    },
    cancel,
    dispose() {
      disposed = true
      cancel()
      stopWorker()
    },
  }
}

/** Starts the real module worker; the browser only, so only called from the hook. */
export function startLayoutWorker(): LayoutWorker {
  return new Worker(new URL('./layout.worker.ts', import.meta.url), {
    type: 'module',
    name: 'graph-layout',
  }) as LayoutWorker
}
