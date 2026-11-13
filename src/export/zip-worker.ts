/**
 * Archive builder, off the page thread.
 *
 * The main thread already carries the 3D scene; fetching every mesh, hashing it
 * and deflating the zip there starved it badly enough that the archive never
 * finished. This worker does that work with its own thread and heap, streams
 * progress back per file, and returns the finished bytes once (transferred, not
 * copied).
 *
 * Everything it needs that is not a pure function — the page base URL — comes
 * in the request, because `document` does not exist here.
 */
import { buildStlBundle } from './export-stl-bundle'
import type { BuildState } from '../domain/types'

interface ZipRequest {
  state: BuildState
  baseUrl: string
}

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<ZipRequest>) => void) | null
}

const scope = self as unknown as WorkerScope

scope.onmessage = async (event: MessageEvent<ZipRequest>) => {
  const { state, baseUrl } = event.data
  try {
    const { blob, filename } = await buildStlBundle(state, {
      baseUrl,
      onProgress: (p) => scope.postMessage({ type: 'progress', ...p }),
    })
    // Hand back the Blob itself: structured cloning an immutable Blob is cheap,
    // while an ArrayBuffer would be copied again on the page thread — the one
    // thread that is busy painting the rack.
    scope.postMessage({ type: 'done', blob: new Blob([blob], { type: 'application/zip' }), filename })
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
