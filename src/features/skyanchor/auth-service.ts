/** Only canonical Bluesky-operated HTTPS origins may receive sync verification tokens. */
export function syncAuthService(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^https:\/\/([a-z0-9.-]+)\/?$/.exec(value)
  if (!match) return undefined
  const host = match[1]
  if (
    host.length > 253 ||
    !host
      .split('.')
      .every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return undefined
  if (host !== 'bsky.social' && !host.endsWith('.host.bsky.network'))
    return undefined
  return 'https://' + host
}

type Credentials = {
  did: string
  service: string
  accessJwt?: string
  refreshJwt?: string
}
export class SyncAuthenticationError extends Error {
  reason: 'unsupported-service' | 'renewal-required' | 'account-changed'
  constructor(
    reason: 'unsupported-service' | 'renewal-required' | 'account-changed',
  ) {
    super(reason)
    this.reason = reason
  }
}

/** At most one rotation; never send credentials from an obsolete owner or unapproved service. */
export async function authenticateSyncAccount({
  account,
  active,
  refresh,
  request,
}: {
  account: Credentials
  active: () => boolean
  refresh: () => Promise<Credentials | undefined>
  request: (credentials: Credentials) => Promise<Response>
}): Promise<Response> {
  let credentials = account
  let refreshed = false
  const check = () => {
    if (!active() || credentials.did !== account.did)
      throw new SyncAuthenticationError('account-changed')
    if (!syncAuthService(credentials.service))
      throw new SyncAuthenticationError('unsupported-service')
  }
  const rotate = async () => {
    check()
    if (!credentials.refreshJwt)
      throw new SyncAuthenticationError('renewal-required')
    const updated = await refresh()
    if (!active()) throw new SyncAuthenticationError('account-changed')
    if (!updated?.accessJwt)
      throw new SyncAuthenticationError('renewal-required')
    credentials = updated
    refreshed = true
    check()
  }
  check()
  if (!credentials.accessJwt) await rotate()
  check()
  let response = await request(credentials)
  if (!active()) throw new SyncAuthenticationError('account-changed')
  if (response.status === 401 && !refreshed) {
    await response.body?.cancel()
    await rotate()
    check()
    response = await request(credentials)
  }
  if (!active()) throw new SyncAuthenticationError('account-changed')
  return response
}
