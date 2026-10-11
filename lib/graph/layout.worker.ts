/**
 * The map's layout worker: lays the graph out off the page's main thread, one request at a
 * time, in the order they arrive. The map (layout-client.ts) starts it as a module worker
 * and stops it to cancel work it no longer wants; layout-messages.ts has the messages.
 */
import { answerLayoutRequest, type LayoutRequest, type LayoutResponse } from './layout-messages'

/** The part of the worker's global scope used here; the DOM lib has no worker types. */
interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<LayoutRequest>) => void): void
  postMessage(message: LayoutResponse): void
}

const scope = self as unknown as WorkerScope

scope.addEventListener('message', (event) => {
  scope.postMessage(answerLayoutRequest(event.data))
})
