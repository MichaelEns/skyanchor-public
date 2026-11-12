import {syncAuthService} from '../src/features/skyanchor/auth-service'
import {
  MAX_SYNC_DEVICES,
  MAX_DEVICE_SAVES,
  normalizedDeviceName,
} from '../src/features/skyanchor/checkpoints'
import {
  MAX_READING_FEEDS,
  type ReadingFeed,
  validPlace,
  validReadingFeed,
} from '../src/features/skyanchor/domain'

type Statement = {
  bind(...values: unknown[]): Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{results: T[]}>
  run(): Promise<unknown>
}
type Database = {
  prepare(sql: string): Statement
  batch<T>(statements: Statement[]): Promise<{results: T[]}[]>
}
type Env = {DB: Database; APP_ORIGIN: string}
type ViewerRequest = Request & {cf?: {country?: string; regionCode?: string}}
type Session = {did: string; csrf: string; device: string; expires: number}
type Place = {
  revision: number
  device: string
  state: string | null
  updated: number
}

const MAX_BODY = 16_384
const SESSION_SECONDS = 600
const DID = /^did:plc:[a-z2-7]{24}$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
function json(
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000',
      'cross-origin-resource-policy': 'same-origin',
      ...extra,
    },
  })
}
async function boundedValue(
  response: Request | Response,
  maxBytes: number,
): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maxBytes)
    throw new HttpError(413, 'Body too large')
  const reader = response.body?.getReader()
  if (!reader) throw new HttpError(400, 'Body required')
  let bytes = 0
  const chunks: Uint8Array[] = []
  for (;;) {
    const {value, done} = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      throw new HttpError(413, 'Body too large')
    }
    chunks.push(value)
  }
  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(data))
  } catch {
    throw new HttpError(400, 'Invalid JSON')
  }
  return value
}
async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type') !== 'application/json')
    throw new HttpError(415, 'JSON required')
  const value = await boundedValue(request, MAX_BODY)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'Object required')
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(value).some(key => !keys.includes(key)) ||
    keys.some(key => !(key in value))
  ) {
    throw new HttpError(400, 'Unexpected or missing fields')
  }
}
function state(value: unknown) {
  if (!validPlace(value)) throw new HttpError(400, 'Invalid place')
  return value
}
async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(bytes), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
function cookie(token: string, maxAge: number) {
  return `__Host-skyanchor=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
}
async function authenticate(
  request: Request,
  env: Env,
): Promise<Session & {tokenHash: string}> {
  const token = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)__Host-skyanchor=([0-9a-f-]{36})(?:;|$)/)?.[1]
  if (!token || !UUID.test(token))
    throw new HttpError(401, 'Sign in to private sync')
  const tokenHash = await hash(token)
  const session = await env.DB.prepare(
    'SELECT did, csrf, device, expires FROM sessions WHERE token_hash = ? AND expires > ?',
  )
    .bind(tokenHash, Date.now())
    .first<Session>()
  if (!session) throw new HttpError(401, 'Private sync session expired')
  if (request.headers.get('x-skyanchor-csrf') !== session.csrf) {
    throw new HttpError(403, 'CSRF validation failed')
  }
  return {...session, tokenHash}
}
async function getPlace(env: Env, did: string, feed: ReadingFeed) {
  const row = await env.DB.prepare(
    'SELECT revision, device, state, updated FROM places WHERE did = ? AND feed = ?',
  )
    .bind(did, feed)
    .first<Place>()
  return row
    ? {
        did,
        ...(feed === 'following' ? {} : {feed}),
        ...row,
        state: row.state === null ? null : JSON.parse(row.state),
      }
    : {
        did,
        ...(feed === 'following' ? {} : {feed}),
        revision: 0,
        device: null,
        state: null,
        updated: null,
      }
}
const PUBLIC_CONFIG = new Map([
  [
    '/api/skyanchor/app-config/config',
    'https://app-config.workers.bsky.app/config',
  ],
  [
    '/api/skyanchor/live-events/config',
    'https://live-events.workers.bsky.app/config',
  ],
])
async function publicRead(request: ViewerRequest, env: Env, pathname: string) {
  if (request.method !== 'GET') throw new HttpError(405, 'GET required')
  if (pathname === '/api/skyanchor/geolocation/geolocation') {
    const country = request.cf?.country
    const region = request.cf?.regionCode
    if (
      !country ||
      !/^[A-Z]{2}$/.test(country) ||
      ['XX', 'T1'].includes(country)
    )
      throw new HttpError(503, 'Viewer geolocation unavailable')
    if (country === 'US' && (!region || !/^[A-Z]{2}$/.test(region)))
      throw new HttpError(503, 'Viewer region unavailable')
    return json({
      countryCode: country,
      ...(region && /^[A-Z0-9-]{1,8}$/.test(region)
        ? {regionCode: region}
        : {}),
    })
  }
  const upstreamUrl = PUBLIC_CONFIG.get(pathname)
  if (!upstreamUrl) throw new HttpError(404, 'Not found')
  const cache = await caches.open('skyanchor-public-config')
  const key = new Request(new URL(pathname, env.APP_ORIGIN))
  const cached = await cache.match(key)
  if (cached) return cached
  const upstream = await fetch(upstreamUrl, {
    method: 'GET',
    headers: {accept: 'application/json'},
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  })
  if (!upstream.ok || upstream.status >= 300)
    throw new HttpError(
      502,
      'Public configuration upstream failed or redirected',
    )
  if (
    !/^application\/json(?:;|$)/i.test(
      upstream.headers.get('content-type') || '',
    )
  )
    throw new HttpError(502, 'Public configuration JSON required')
  const value = await boundedValue(upstream, 131_072)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(502, 'Public configuration object required')
  const response = json(value, 200, {
    'cache-control': 'public, max-age=60, s-maxage=300',
  })
  await cache.put(key, response.clone())
  return response
}
async function route(request: Request, env: Env) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/skyanchor/'))
    throw new HttpError(404, 'Not found')
  let feed: ReadingFeed = 'following'
  let selectedDevice: string | undefined
  if (url.search) {
    if (url.search.length > 1024)
      throw new HttpError(400, 'Feed query exceeds bound')
    const entries = [...url.searchParams.entries()]
    const history = url.pathname === '/api/skyanchor/history'
    if (
      ![
        '/api/skyanchor/place',
        '/api/skyanchor/devices',
        '/api/skyanchor/history',
      ].includes(url.pathname) ||
      entries.some(
        ([key]) => key !== 'feed' && !(history && key === 'device'),
      ) ||
      new Set(entries.map(([key]) => key)).size !== entries.length ||
      (url.searchParams.has('feed') &&
        !validReadingFeed(url.searchParams.get('feed'))) ||
      (history && !UUID.test(url.searchParams.get('device') ?? ''))
    )
      throw new HttpError(400, 'Invalid semantic feed query')
    feed = (url.searchParams.get('feed') ?? 'following') as ReadingFeed
    selectedDevice = url.searchParams.get('device') ?? undefined
  }
  if (url.pathname === '/api/skyanchor/history' && !selectedDevice)
    throw new HttpError(400, 'Device query required')
  if (
    PUBLIC_CONFIG.has(url.pathname) ||
    url.pathname === '/api/skyanchor/geolocation/geolocation'
  )
    return publicRead(request, env, url.pathname)
  const origin = request.headers.get('origin')
  if (
    origin !== env.APP_ORIGIN &&
    !(
      request.method === 'GET' &&
      origin === null &&
      request.headers.get('sec-fetch-site') === 'same-origin'
    )
  ) {
    throw new HttpError(403, 'Origin rejected')
  }
  if (
    request.headers.get('sec-fetch-site') &&
    !['same-origin', 'none'].includes(request.headers.get('sec-fetch-site')!)
  ) {
    throw new HttpError(403, 'Cross-site request rejected')
  }
  if (url.pathname === '/api/skyanchor/session' && request.method === 'POST') {
    const body = await boundedJson(request)
    exact(body, [
      'device',
      ...('service' in body ? ['service'] : []),
      ...('deviceName' in body ? ['deviceName'] : []),
    ])
    const service = syncAuthService(
      'service' in body ? body.service : 'https://bsky.social',
    )
    if (!service) throw new HttpError(400, 'Unsupported account service')
    if (typeof body.device !== 'string' || !UUID.test(body.device))
      throw new HttpError(400, 'Invalid device')
    const label =
      'deviceName' in body
        ? normalizedDeviceName(body.deviceName)
        : 'Browser-' + body.device.slice(0, 4)
    if (!label) throw new HttpError(400, 'Invalid browser profile name')
    const authorization = request.headers.get('authorization')
    if (
      !authorization ||
      !/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(authorization)
    )
      throw new HttpError(401, 'Access token required')
    /* Verify at the approved issuing service; token claims are never proof of ownership. */
    const upstream = await fetch(
      service + '/xrpc/com.atproto.server.getSession',
      {
        headers: {authorization},
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
      },
    )
    if (upstream.status >= 300 && upstream.status < 400)
      throw new HttpError(502, 'Account verifier redirect rejected')
    if (!upstream.ok)
      throw new HttpError(
        upstream.status >= 500 ? 503 : 401,
        'Account verification failed',
      )
    const account = await boundedValue(upstream, 32_768)
    if (
      !account ||
      typeof account !== 'object' ||
      !('did' in account) ||
      typeof account.did !== 'string' ||
      !DID.test(account.did)
    ) {
      throw new HttpError(502, 'Invalid verified account')
    }
    const token = crypto.randomUUID()
    const csrf = crypto.randomUUID()
    const old = request.headers
      .get('cookie')
      ?.match(/(?:^|;\s*)__Host-skyanchor=([0-9a-f-]{36})(?:;|$)/)?.[1]
    const operations = [
      env.DB.prepare(
        `INSERT INTO device_registry (did, device, label, updated)
        SELECT ?, ?, ?, ? WHERE
        (SELECT COUNT(*) FROM device_registry WHERE did = ?) < ?
        ON CONFLICT (did, device) DO NOTHING`,
      ).bind(
        account.did,
        body.device,
        label,
        Date.now(),
        account.did,
        MAX_SYNC_DEVICES,
      ),
      env.DB.prepare('DELETE FROM sessions WHERE expires <= ?').bind(
        Date.now(),
      ),
      env.DB.prepare(
        `INSERT INTO sessions
        SELECT ?, ?, ?, ?, ? WHERE EXISTS
        (SELECT 1 FROM device_registry WHERE did = ? AND device = ?)`,
      ).bind(
        await hash(token),
        account.did,
        csrf,
        body.device,
        Date.now() + SESSION_SECONDS * 1000,
        account.did,
        body.device,
      ),
    ]
    if (old)
      operations.splice(
        1,
        0,
        env.DB.prepare(
          `DELETE FROM sessions WHERE token_hash = ? AND EXISTS
          (SELECT 1 FROM device_registry WHERE did = ? AND device = ?)`,
        ).bind(await hash(old), account.did, body.device),
      )
    await env.DB.batch(operations)
    const registered = await env.DB.prepare(
      'SELECT device FROM device_registry WHERE did = ? AND device = ?',
    )
      .bind(account.did, body.device)
      .first<{device: string}>()
    if (!registered)
      throw new HttpError(
        422,
        'Browser profile capacity reached (32); existing profiles and saves were not evicted',
      )
    return json({did: account.did, csrf, expiresIn: SESSION_SECONDS}, 200, {
      'set-cookie': cookie(token, SESSION_SECONDS),
    })
  }
  if (
    url.pathname === '/api/skyanchor/session' &&
    request.method === 'DELETE'
  ) {
    // Exact Origin and Fetch Metadata checks above also protect cold-reload logout.
    const token = request.headers
      .get('cookie')
      ?.match(/(?:^|;\s*)__Host-skyanchor=([0-9a-f-]{36})(?:;|$)/)?.[1]
    if (token && UUID.test(token)) {
      const suppliedCsrf = request.headers.get('x-skyanchor-csrf')
      if (suppliedCsrf) {
        const current = await env.DB.prepare(
          'SELECT csrf FROM sessions WHERE token_hash = ?',
        )
          .bind(await hash(token))
          .first<{csrf: string}>()
        if (current && current.csrf !== suppliedCsrf)
          throw new HttpError(403, 'CSRF validation failed')
      }
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
        .bind(await hash(token))
        .run()
    }
    return json({signedOut: true}, 200, {'set-cookie': cookie('', 0)})
  }
  const session = await authenticate(request, env)
  if (url.pathname === '/api/skyanchor/device') {
    if (request.method !== 'PUT') throw new HttpError(405, 'PUT required')
    const body = await boundedJson(request)
    exact(body, ['label'])
    const label = normalizedDeviceName(body.label)
    if (!label) throw new HttpError(400, 'Invalid browser profile name')
    await env.DB.prepare(
      'UPDATE device_registry SET label = ?, updated = ? WHERE did = ? AND device = ?',
    )
      .bind(label, Date.now(), session.did, session.device)
      .run()
    const renamed = await env.DB.prepare(
      'SELECT device, label, updated FROM device_registry WHERE did = ? AND device = ?',
    )
      .bind(session.did, session.device)
      .first<{device: string; label: string; updated: number}>()
    if (!renamed)
      throw new HttpError(409, 'Browser profile not registered; reconnect')
    return json({did: session.did, ...renamed})
  }
  if (url.pathname === '/api/skyanchor/devices') {
    if (request.method !== 'GET') throw new HttpError(405, 'GET required')
    const rows = await env.DB.prepare(
      `SELECT d.device, d.label, d.updated,
        (SELECT MAX(h.updated) FROM reading_history h WHERE h.did = d.did AND h.device = d.device AND h.feed = ?) AS lastSaved,
        (SELECT COUNT(*) FROM reading_history h WHERE h.did = d.did AND h.device = d.device AND h.feed = ?) AS count
       FROM device_registry d WHERE d.did = ? ORDER BY d.device LIMIT ?`,
    )
      .bind(feed, feed, session.did, MAX_SYNC_DEVICES + 1)
      .all()
    if (rows.results.length > MAX_SYNC_DEVICES)
      throw new HttpError(
        422,
        'Legacy account exceeds 32 browser profiles; all data retained, existing profiles can still read their history',
      )
    return json({did: session.did, feed, devices: rows.results})
  }
  if (url.pathname === '/api/skyanchor/history') {
    if (request.method !== 'GET') throw new HttpError(405, 'GET required')
    const registered = await env.DB.prepare(
      'SELECT device FROM device_registry WHERE did = ? AND device = ?',
    )
      .bind(session.did, selectedDevice)
      .first()
    if (!registered) throw new HttpError(404, 'Browser profile not found')
    const rows = await env.DB.prepare(
      `SELECT revision, state, updated FROM reading_history
       WHERE did = ? AND feed = ? AND device = ? ORDER BY revision DESC LIMIT ?`,
    )
      .bind(session.did, feed, selectedDevice, MAX_DEVICE_SAVES)
      .all<{revision: number; state: string; updated: number}>()
    return json({
      did: session.did,
      feed,
      device: selectedDevice,
      saves: rows.results.map(row => ({
        ...row,
        state: state(JSON.parse(row.state)),
      })),
    })
  }
  if (url.pathname !== '/api/skyanchor/place')
    throw new HttpError(404, 'Not found')
  if (request.method === 'GET')
    return json(await getPlace(env, session.did, feed))
  if (request.method !== 'PUT' && request.method !== 'DELETE')
    throw new HttpError(405, 'Method not allowed')
  const body = await boundedJson(request)
  exact(body, request.method === 'PUT' ? ['revision', 'state'] : ['revision'])
  if (
    typeof body.revision !== 'number' ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    throw new HttpError(400, 'Invalid revision')
  const serialized =
    request.method === 'PUT' ? JSON.stringify(state(body.state)) : null
  const nonce = crypto.randomUUID()
  const now = Date.now()
  const operations = [
    env.DB.prepare(
      `UPDATE clock SET revision = revision + 1, nonce = ?
      WHERE id = 1 AND revision < 9007199254740990 AND (
        EXISTS (SELECT 1 FROM places WHERE did = ? AND feed = ? AND revision = ?)
        OR (? = 0 AND NOT EXISTS (SELECT 1 FROM places WHERE did = ? AND feed = ?)
          AND (? = 'following' OR (SELECT COUNT(*) FROM places WHERE did = ? AND feed != 'following') < ?))
      )`,
    ).bind(
      nonce,
      session.did,
      feed,
      body.revision,
      body.revision,
      session.did,
      feed,
      feed,
      session.did,
      MAX_READING_FEEDS,
    ),
    env.DB.prepare(
      `INSERT INTO places (did, feed, revision, device, state, updated)
      SELECT ?, ?, revision, ?, ?, ? FROM clock WHERE id = 1 AND nonce = ?
      ON CONFLICT (did, feed) DO UPDATE SET revision = excluded.revision, device = excluded.device,
      state = excluded.state, updated = excluded.updated`,
    ).bind(session.did, feed, session.device, serialized, now, nonce),
  ]
  if (serialized !== null) {
    operations.push(
      env.DB.prepare(
        `DELETE FROM reading_history WHERE did = ? AND feed = ? AND device = ?
         AND json_extract(state, '$.anchor') = json_extract(?, '$.anchor')
         AND EXISTS (SELECT 1 FROM clock WHERE id = 1 AND nonce = ?)`,
      ).bind(session.did, feed, session.device, serialized, nonce),
      env.DB.prepare(
        `INSERT INTO reading_history (did, feed, device, revision, state, updated)
         SELECT ?, ?, ?, revision, ?, ? FROM clock WHERE id = 1 AND nonce = ?`,
      ).bind(session.did, feed, session.device, serialized, now, nonce),
      env.DB.prepare(
        `DELETE FROM reading_history WHERE did = ? AND feed = ? AND device = ?
         AND revision NOT IN (SELECT revision FROM reading_history WHERE did = ? AND feed = ? AND device = ? ORDER BY revision DESC LIMIT ?)
         AND EXISTS (SELECT 1 FROM clock WHERE id = 1 AND nonce = ?)`,
      ).bind(
        session.did,
        feed,
        session.device,
        session.did,
        feed,
        session.device,
        MAX_DEVICE_SAVES,
        nonce,
      ),
    )
  } else {
    operations.push(
      env.DB.prepare(
        `DELETE FROM reading_history WHERE did = ? AND feed = ?
       AND EXISTS (SELECT 1 FROM clock WHERE id = 1 AND nonce = ?)`,
      ).bind(session.did, feed, nonce),
    )
  }
  operations.push(env.DB.prepare('SELECT nonce FROM clock WHERE id = 1'))
  const result = await env.DB.batch<{nonce: string}>(operations)
  const current = await getPlace(env, session.did, feed)
  if (current.revision === 0 && feed !== 'following') {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM places WHERE did = ? AND feed != 'following'",
    )
      .bind(session.did)
      .first<{count: number}>()
    if (count && count.count >= MAX_READING_FEEDS)
      throw new HttpError(
        422,
        'Profile reading-place capacity reached (64 filters including tombstones); existing places were not evicted',
      )
  }
  return result.at(-1)?.results[0]?.nonce === nonce
    ? json(current)
    : json({error: 'Place changed on another device', current}, 409)
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env)
    } catch (error) {
      if (error instanceof HttpError)
        return json({error: error.message}, error.status)
      console.error(
        'SkyAnchor private sync request failed',
        error instanceof Error ? error.name : 'UnknownError',
      )
      return json({error: 'Private sync unavailable'}, 503)
    }
  },
}
