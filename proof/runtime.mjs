import {readFileSync} from 'node:fs'
import {Miniflare} from 'miniflare'
import {build} from 'esbuild'
import {randomBytes} from 'node:crypto'
import path from 'node:path'

export const didA = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
export const didB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
export async function workerRuntime(
  origin = 'https://skyanchor.test',
  publicConfig,
  authorMigration = true,
  verifier,
) {
  const result = await build({
    entryPoints: [path.join('worker', 'index.ts')],
    bundle: true,
    format: 'esm',
    write: false,
    target: 'es2022',
  })
  const tokens = new Map()
  const verifications = []
  const runtime = new Miniflare({
    modules: true,
    script: result.outputFiles[0].text,
    compatibilityDate: '2025-11-05',
    host: '127.0.0.1',
    port: 0,
    d1Databases: ['DB'],
    bindings: {APP_ORIGIN: origin},
    outboundService: async request => {
      if (
        [
          'https://app-config.workers.bsky.app/config',
          'https://live-events.workers.bsky.app/config',
        ].includes(request.url)
      ) {
        if (publicConfig) return publicConfig(request)
        return new Response(
          JSON.stringify(
            request.url.includes('app-config')
              ? {liveNow: {allow: [], exceptions: []}}
              : {feeds: []},
          ),
          {headers: {'content-type': 'application/json'}},
        )
      }
      if (
        ![
          'https://bsky.social/xrpc/com.atproto.server.getSession',
          'https://shimeji.us-east.host.bsky.network/xrpc/com.atproto.server.getSession',
        ].includes(request.url)
      ) {
        throw new Error('Unexpected Worker upstream request: ' + request.url)
      }
      verifications.push(new URL(request.url).origin)
      if (verifier) return verifier(request)
      const entry = tokens.get(request.headers.get('authorization'))
      const did =
        entry?.service === new URL(request.url).origin ? entry.did : undefined
      return new Response(
        JSON.stringify(
          did ? {did, handle: 'fixture.test'} : {error: 'InvalidToken'},
        ),
        {
          status: did ? 200 : 401,
          headers: {'content-type': 'application/json'},
        },
      )
    },
  })
  const db = await runtime.getD1Database('DB')
  for (const sql of readFileSync(path.join('worker', 'schema.sql'), 'utf8')
    .split(';')
    .filter(sql => sql.trim()))
    await db.prepare(sql).run()
  if (authorMigration)
    await db.batch(
      readFileSync(
        path.join('worker', 'migrations', '0002_author_places.sql'),
        'utf8',
      )
        .split(';')
        .filter(sql => sql.trim())
        .map(sql => db.prepare(sql)),
    )
  await runtime.ready
  const token = (did, service = 'https://bsky.social') => {
    const value = randomBytes(48).toString('base64url')
    tokens.set('Bearer ' + value, {did, service})
    return value
  }
  return {
    runtime,
    db,
    token,
    verifications,
    register: (value, did, service = 'https://bsky.social') =>
      tokens.set('Bearer ' + value, {did, service}),
    expire: value => tokens.delete('Bearer ' + value),
    dispose: () => runtime.dispose(),
  }
}

export function context(runtime, origin = 'https://skyanchor.test') {
  let cookie = ''
  let csrf = ''
  return {
    get cookie() {
      return cookie
    },
    get csrf() {
      return csrf
    },
    async call(path, method = 'GET', body, extra = {}) {
      const headers = {
        origin,
        'content-type': 'application/json',
        cookie,
        'x-skyanchor-csrf': csrf,
        ...extra,
      }
      const response = await runtime.dispatchFetch(
        origin + '/api/skyanchor/' + path,
        {
          method,
          headers,
          ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        },
      )
      const value = await response.json()
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      if (value.csrf) csrf = value.csrf
      return {status: response.status, value, setCookie}
    },
  }
}
