export class RequestTimeoutError extends Error {
  constructor(readonly phase: string) {
    super(`Network request failed: ${phase} timed out`)
    this.name = 'RequestTimeoutError'
  }
}

/**
 * Browser timers may be frozen while hidden. Reconcile elapsed wall time on
 * return as well as on the timer, and abort the owning request, not just its UI.
 */
export function createRequestDeadline(
  phase: string,
  ms: number,
  signals: (AbortSignal | null | undefined)[] = [],
) {
  const controller = new AbortController()
  const expires = Date.now() + ms
  const parents = signals.filter((signal): signal is AbortSignal => !!signal)
  const abort = () => controller.abort()
  const check = () => {
    if (Date.now() >= expires && !controller.signal.aborted) {
      controller.abort(new RequestTimeoutError(phase))
    }
  }
  const timer = setTimeout(check, ms)
  for (const signal of parents) {
    signal.addEventListener('abort', abort, {once: true})
    if (signal.aborted) abort()
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', check)
    window.addEventListener('pageshow', check)
  }
  return {
    signal: controller.signal,
    throwIfAborted() {
      check()
      if (controller.signal.aborted) {
        throw controller.signal.reason
      }
    },
    dispose() {
      clearTimeout(timer)
      for (const signal of parents) signal.removeEventListener('abort', abort)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', check)
        window.removeEventListener('pageshow', check)
      }
    },
  }
}

export async function withRequestDeadline<T>(
  phase: string,
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
  signals?: (AbortSignal | null | undefined)[],
): Promise<T> {
  const deadline = createRequestDeadline(phase, ms, signals)
  try {
    deadline.throwIfAborted()
    const result = await run(deadline.signal)
    deadline.throwIfAborted()
    return result
  } catch (error) {
    deadline.throwIfAborted()
    throw error
  } finally {
    deadline.dispose()
  }
}
