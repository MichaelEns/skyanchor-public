import {withRequestDeadline} from '#/lib/async/requestDeadline'
import {type SessionAccount} from '#/state/session'
import {invalidateReadingAccount, RETURN_PREFIX, STORAGE_PREFIX} from './domain'

const accountRefreshes = new Map<string, Promise<SessionAccount | undefined>>()
export function refreshSyncAccount(
  did: string,
  refresh: () => Promise<SessionAccount | undefined>,
) {
  const pending = accountRefreshes.get(did)
  if (pending) return pending
  const operation = refresh().finally(() => {
    if (accountRefreshes.get(did) === operation) accountRefreshes.delete(did)
  })
  accountRefreshes.set(did, operation)
  return operation
}

const csrfByDid = new Map<string, string>()
const sessionsByDid = new Map<string, {csrf: string; expires: number}>()
export function getSyncSession(did: string) {
  return sessionsByDid.get(did)
}
export function setSyncSession(
  did: string,
  session: {csrf: string; expires: number},
) {
  sessionsByDid.set(did, session)
  setSyncCsrf(did, session.csrf)
}
let sessionQueue: Promise<unknown> = Promise.resolve()

/** Serialize cookie mutations, including logout, so an old response cannot replace a new account's cookie. */
export function syncSessionRequest(
  init: RequestInit,
  active: () => boolean = () => true,
): Promise<Response> {
  return withRequestDeadline(
    'Private sync session',
    15_000,
    signal => {
      const operation = sessionQueue.then(async () => {
        signal.throwIfAborted()
        if (!active()) throw new Error('Private sync account changed')
        const response = await fetch('/api/skyanchor/session', {
          ...init,
          signal,
          credentials: 'same-origin',
        })
        const body = await response.arrayBuffer()
        if (body.byteLength > 64 * 1024)
          throw new Error('Invalid private sync session response size')
        return new Response(body.byteLength ? body : null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      })
      sessionQueue = operation.then(
        () => undefined,
        () => undefined,
      )
      return new Promise<Response>((resolve, reject) => {
        const abort = () => {
          const reason: unknown = signal.reason
          reject(
            reason instanceof Error
              ? reason
              : new Error('Private sync session cancelled'),
          )
        }
        signal.addEventListener('abort', abort, {once: true})
        if (signal.aborted) abort()
        void operation.then(
          response => {
            signal.removeEventListener('abort', abort)
            resolve(response)
          },
          error => {
            signal.removeEventListener('abort', abort)
            reject(
              error instanceof Error
                ? error
                : new Error('Private sync session request failed'),
            )
          },
        )
      })
    },
    [init.signal],
  )
}
export function setSyncCsrf(did: string, csrf: string) {
  csrfByDid.set(did, csrf)
}
export function clearReadingAccount(did: string, revokeSession = true) {
  invalidateReadingAccount(did)
  localStorage.removeItem(STORAGE_PREFIX + did)
  localStorage.removeItem(RETURN_PREFIX + did)
  localStorage.removeItem('skyanchor:sync-enabled:' + did)
  localStorage.removeItem('skyanchor:revision:' + did)
  for (const key of Object.keys(localStorage)) {
    if (
      [STORAGE_PREFIX, RETURN_PREFIX, 'skyanchor:revision:'].some(prefix =>
        key.startsWith(prefix + did + ':author|'),
      )
    )
      localStorage.removeItem(key)
  }
  const csrf = csrfByDid.get(did)
  csrfByDid.delete(did)
  sessionsByDid.delete(did)
  if (!revokeSession) return
  void syncSessionRequest({
    method: 'DELETE',
    keepalive: true,
    headers: csrf ? {'x-skyanchor-csrf': csrf} : {},
  }).then(
    response => {
      if (!response.ok)
        console.error(
          'SkyAnchor sync sign-out could not be confirmed',
          response.status,
        )
    },
    error =>
      console.error(
        'SkyAnchor sync sign-out failed; server session expires after ten minutes',
        error,
      ),
  )
}
