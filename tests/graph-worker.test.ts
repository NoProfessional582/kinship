import { afterEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_COLORS, type GraphData, type GraphLink, type GraphNode } from '@/lib/graph/constants'
import {
  LayoutCancelledError,
  LayoutFailedError,
  WORKER_STOPPED,
  createLayoutClient,
  type LayoutWorker,
} from '@/lib/graph/layout-client'
import {
  LAYOUT_FAILED,
  answerLayoutRequest,
  type LayoutRequest,
  type LayoutResponse,
} from '@/lib/graph/layout-messages'
import { ApiError } from '@/lib/hooks/api'
import {
  FOCUS_NOT_FOUND,
  GRAPH_LOAD_FAILED,
  graphLayoutState,
  graphUrl,
} from '@/lib/graph/use-graph-layout'

const node = (id: string, type: GraphNode['type'] = 'entry'): GraphNode => ({
  id: `${type}:${id}`,
  entityId: id,
  type,
  name: `Record ${id}`,
  color: GRAPH_COLORS[type],
  url: type === 'tag' ? null : `/${type}s/${id}`,
})

const link = (source: GraphNode, target: GraphNode): GraphLink => ({
  id: `${source.id}>${target.id}>mentions`,
  source: source.id,
  target: target.id,
  relation: 'mentions',
  origins: ['Mention'],
})

function graph(...ids: string[]): GraphData {
  const nodes = ids.map((id) => node(id))
  const links = nodes.slice(1).map((n) => link(nodes[0], n))
  return { nodes, links }
}

const request = (requestId: number, data: GraphData): LayoutRequest => ({ requestId, ...data })

describe('layout worker messages', () => {
  it('answers with the request id and a layout safe to post', () => {
    const answer = answerLayoutRequest(request(7, graph('a', 'b', 'c')))
    expect(answer.requestId).toBe(7)
    if (!('layout' in answer)) throw new Error('expected a layout')
    expect(answer.layout.nodes.map((n) => n.id)).toEqual(['entry:a', 'entry:b', 'entry:c'])
    expect(structuredClone(answer)).toEqual(answer)
  })

  it('reports a refused graph by its message', () => {
    const twins = { nodes: [node('a'), node('a')], links: [] }
    expect(answerLayoutRequest(request(3, twins))).toEqual({
      requestId: 3,
      error: 'Two nodes have the id entry:a.',
    })
  })

  it('reports any other failure without its details', () => {
    const broken = { requestId: 4, nodes: null, links: [] } as unknown as LayoutRequest
    expect(answerLayoutRequest(broken)).toEqual({ requestId: 4, error: LAYOUT_FAILED })
  })
})

describe('layout.worker.ts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('answers each message in the order it came', async () => {
    let listener: ((event: { data: LayoutRequest }) => void) | undefined
    const posted: LayoutResponse[] = []
    vi.stubGlobal('self', {
      addEventListener: (type: string, fn: typeof listener) => {
        if (type === 'message') listener = fn
      },
      postMessage: (message: LayoutResponse) => posted.push(message),
    })
    await import('@/lib/graph/layout.worker')
    expect(listener).toBeDefined()

    listener!({ data: request(1, graph('a', 'b')) })
    listener!({ data: request(2, { nodes: [node('x'), node('x')], links: [] }) })
    listener!({ data: request(3, graph('c')) })

    expect(posted.map((m) => m.requestId)).toEqual([1, 2, 3])
    expect('layout' in posted[0]).toBe(true)
    expect(posted[1]).toEqual({ requestId: 2, error: 'Two nodes have the id entry:x.' })
    expect('layout' in posted[2]).toBe(true)
  })
})

/** A stand-in worker: holds requests until the test answers them. */
class FakeWorker implements LayoutWorker {
  static started: FakeWorker[] = []
  received: LayoutRequest[] = []
  terminated = false
  onmessage: LayoutWorker['onmessage'] = null
  onerror: LayoutWorker['onerror'] = null
  onmessageerror: LayoutWorker['onmessageerror'] = null

  constructor() {
    FakeWorker.started.push(this)
  }
  postMessage(message: LayoutRequest) {
    this.received.push(message)
  }
  terminate() {
    this.terminated = true
  }
  /** Answers a request it received, as the real worker would. */
  answer(i = this.received.length - 1) {
    this.reply(answerLayoutRequest(this.received[i]))
  }
  reply(data: LayoutResponse) {
    this.onmessage?.({ data } as MessageEvent<LayoutResponse>)
  }
}

describe('layout client', () => {
  afterEach(() => {
    FakeWorker.started = []
  })
  const client = () => createLayoutClient(() => new FakeWorker())

  it('resolves with the layout for its own request', async () => {
    const layouts = client()
    const pending = layouts.layout(graph('a', 'b'))
    const [worker] = FakeWorker.started
    expect(worker.received[0]).toMatchObject({ requestId: 1, nodes: graph('a', 'b').nodes })
    worker.answer()
    const layout = await pending
    expect(layout.nodes).toHaveLength(2)
  })

  it('reuses the worker once a layout has finished', async () => {
    const layouts = client()
    const first = layouts.layout(graph('a'))
    FakeWorker.started[0].answer()
    await first
    const second = layouts.layout(graph('b'))
    expect(FakeWorker.started).toHaveLength(1)
    FakeWorker.started[0].answer()
    await expect(second).resolves.toMatchObject({ nodes: [{ id: 'entry:b' }] })
  })

  it('cancels a running layout when a new graph arrives, and stops its worker', async () => {
    const layouts = client()
    const stale = layouts.layout(graph('a', 'b'))
    const fresh = layouts.layout(graph('c'))
    await expect(stale).rejects.toBeInstanceOf(LayoutCancelledError)

    const [first, second] = FakeWorker.started
    expect(first.terminated).toBe(true)
    expect(first.onmessage).toBeNull()
    expect(second.received[0].requestId).toBe(2)
    second.answer()
    await expect(fresh).resolves.toMatchObject({ nodes: [{ id: 'entry:c' }] })
  })

  it('drops an answer to any request but the one awaited', async () => {
    const layouts = client()
    const pending = layouts.layout(graph('b'))
    const worker = FakeWorker.started[0]
    // An answer for an older request id, arriving late.
    worker.reply(answerLayoutRequest(request(0, graph('old'))))
    let settled = false
    void pending.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    worker.answer()
    await expect(pending).resolves.toMatchObject({ nodes: [{ id: 'entry:b' }] })
  })

  it('rejects with the refusal message', async () => {
    const layouts = client()
    const pending = layouts.layout({ nodes: [node('x'), node('x')], links: [] })
    FakeWorker.started[0].answer()
    await expect(pending).rejects.toEqual(new LayoutFailedError('Two nodes have the id entry:x.'))
  })

  it('fails the layout and starts afresh when the worker crashes', async () => {
    const layouts = client()
    const pending = layouts.layout(graph('a'))
    const crashed = FakeWorker.started[0]
    crashed.onerror?.(new Event('error') as ErrorEvent)
    await expect(pending).rejects.toEqual(new LayoutFailedError(WORKER_STOPPED))
    expect(crashed.terminated).toBe(true)

    const again = layouts.layout(graph('a'))
    expect(FakeWorker.started).toHaveLength(2)
    FakeWorker.started[1].answer()
    await expect(again).resolves.toBeDefined()
  })

  it('cancel stops the work; dispose stops the worker for good', async () => {
    const layouts = client()
    const pending = layouts.layout(graph('a'))
    layouts.cancel()
    await expect(pending).rejects.toBeInstanceOf(LayoutCancelledError)
    expect(FakeWorker.started[0].terminated).toBe(true)

    const idle = layouts.layout(graph('b'))
    FakeWorker.started[1].answer()
    await idle
    layouts.dispose()
    expect(FakeWorker.started[1].terminated).toBe(true)
    await expect(layouts.layout(graph('c'))).rejects.toBeInstanceOf(LayoutCancelledError)
    expect(FakeWorker.started).toHaveLength(2)
  })
})

describe('graph layout state', () => {
  const data = graph('a', 'b')
  const layout = answerLayoutRequest(request(1, data))
  if (!('layout' in layout)) throw new Error('expected a layout')

  it('builds the request url', () => {
    expect(graphUrl()).toBe('/api/graph')
    expect(graphUrl({ focusId: 'contact:a b' })).toBe('/api/graph?focusId=contact%3Aa+b&depth=2')
    expect(graphUrl({ focusId: 'project:p', depth: 1 })).toBe(
      '/api/graph?focusId=project%3Ap&depth=1',
    )
  })

  it('is loading until both the graph and its own layout are in', () => {
    expect(graphLayoutState({}, null).status).toBe('loading')
    expect(graphLayoutState({ data }, null).status).toBe('loading')
  })

  it('never pairs a graph with a layout made for another one', () => {
    const newer = graph('a', 'b')
    const state = graphLayoutState(
      { data: newer },
      { graph: data, attraction: 1, layout: layout.layout },
    )
    expect(state).toEqual({ status: 'loading', graph: newer })
  })

  it('is ready with the graph and its layout', () => {
    expect(
      graphLayoutState({ data }, { graph: data, attraction: 1, layout: layout.layout }),
    ).toEqual({
      status: 'ready',
      graph: data,
      layout: layout.layout,
    })
  })

  it('keeps drawing the layout it has while another attraction is laid out', () => {
    const outcome = { graph: data, attraction: 1, layout: layout.layout }
    expect(graphLayoutState({ data }, outcome, 1.5)).toEqual({
      status: 'ready',
      graph: data,
      layout: layout.layout,
      rearranging: true,
    })
    // A new graph still waits for its own layout, whatever the attraction.
    expect(graphLayoutState({ data: graph('a', 'b') }, outcome, 1.5).status).toBe('loading')
  })

  it('is empty for a graph with no records, without a layout', () => {
    const none = { nodes: [], links: [] }
    expect(graphLayoutState({ data: none }, null)).toEqual({ status: 'empty', graph: none })
  })

  it('says a focused record was not found, and other failures plainly', () => {
    expect(graphLayoutState({ error: new ApiError('Not found', 404) }, null)).toEqual({
      status: 'error',
      error: { message: FOCUS_NOT_FOUND, notFound: true },
    })
    expect(graphLayoutState({ error: new ApiError('boom', 500) }, null).error).toEqual({
      message: GRAPH_LOAD_FAILED,
      notFound: false,
    })
  })

  it('shows a layout refusal as an error, not a picture', () => {
    const failed = new LayoutFailedError('Two nodes have the id entry:x.')
    expect(graphLayoutState({ data }, { graph: data, attraction: 1, error: failed })).toEqual({
      status: 'error',
      graph: data,
      error: { message: failed.message, notFound: false },
    })
  })
})
