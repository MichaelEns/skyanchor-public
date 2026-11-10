export function clearReadingAccount(_did: string, _revokeSession = true) {}
export function setSyncCsrf(_did: string, _csrf: string) {}
export function getSyncSession(
  _did: string,
): {csrf: string; expires: number} | undefined {
  return undefined
}
export function setSyncSession(
  _did: string,
  _session: {csrf: string; expires: number},
) {}
export function syncSessionRequest(
  _init: RequestInit,
  _active?: () => boolean,
): Promise<Response> {
  return Promise.reject(new Error('Private sync is only supported on the web'))
}
import {type SessionAccount} from '#/state/session'

export function refreshSyncAccount(
  _did: string,
  refresh: () => Promise<SessionAccount | undefined>,
) {
  return refresh()
}
