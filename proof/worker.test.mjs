import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {workerRuntime, context, didA, didB} from './runtime.mjs'
import {syncAuthService} from '../src/features/skyanchor/auth-service.ts'

test('Sync verifier accepts only canonical Bluesky origins and binds regional tokens to the issuing service', async () => {
  const {runtime, db, token, verifications, dispose} = await workerRuntime()
  const regional = 'https://shimeji.us-east.host.bsky.network'
  try {
    const client = context(runtime)
    const jwt = token(didA, regional)
    const headers = {authorization: 'Bearer ' + jwt}
    for (const service of [
      'http://bsky.social',
      'https://127.0.0.1',
      'https://localhost',
      'https://bsky.social.evil.test',
      'https://evilhost.bsky.network',
      'https://host.bsky.network',
      'https://a.host.bsky.network.evil.test',
      'https://a.host.bsky.network@evil.test',
      'https://user@bsky.social',
      'https://bsky.social:443',
      'https://bsky.social:8443',
      'https://bsky.social/x',
      'https://bsky.social/%2e%2e',
      'https://bsky.social?',
      'https://bsky.social#',
      'https://bsky.social\\evil',
      'https://a..host.bsky.network',
      ' https://bsky.social',
      'https://-a.host.bsky.network',
      'https://bsky.social/../',
    ]) {
      assert.equal(syncAuthService(service), undefined)
      assert.equal(
        (
          await client.call(
            'session',
            'POST',
            {device: randomUUID(), service},
            headers,
          )
        ).status,
        400,
      )
    }
    assert.equal(
      verifications.length,
      0,
      'Invalid origins must never receive a fetch or bearer',
    )
    assert.equal(
      (await client.call('session', 'POST', {device: randomUUID()}, headers))
        .status,
      401,
      'Legacy entryway request cannot authenticate a regional token',
    )
    const verified = await client.call(
      'session',
      'POST',
      {device: randomUUID(), service: regional + '/'},
      headers,
    )
    assert.equal(verified.status, 200)
    assert.equal(verified.value.did, didA)
    assert.equal(verifications.at(-1), regional)
    assert.equal(
      (await client.call('place', 'PUT', {revision: 0, state: place(didA)}))
        .status,
      200,
    )
    const before = (await db.prepare('SELECT * FROM places').all()).results
    assert.equal(
      (
        await client.call(
          'session',
          'POST',
          {device: randomUUID(), service: regional},
          {authorization: 'Bearer ' + token(didB)},
        )
      ).status,
      401,
    )
    assert.deepEqual(
      (await db.prepare('SELECT * FROM places').all()).results,
      before,
    )
    const legacy = context(runtime)
    assert.equal(
      (
        await legacy.call(
          'session',
          'POST',
          {device: randomUUID()},
          {authorization: 'Bearer ' + token(didB)},
        )
      ).status,
      200,
    )
    assert.equal((await legacy.call('place')).value.did, didB)
  } finally {
    await dispose()
  }
})

test('Regional verifier refuses redirects, oversized responses and invalid DID authority without creating a session', async () => {
  let mode = 'redirect'
  const {runtime, db, dispose} = await workerRuntime(
    'https://skyanchor.test',
    undefined,
    true,
    request => {
      assert.equal(
        new URL(request.url).origin,
        'https://shimeji.us-east.host.bsky.network',
      )
      if (mode === 'redirect')
        return Response.redirect('https://untrusted.example.test/steal', 307)
      if (mode === 'oversized') return new Response(' '.repeat(32_769))
      return Response.json({did: 'did:web:untrusted.example.test'})
    },
  )
  try {
    const client = context(runtime)
    for (const [value, status] of [
      ['redirect', 502],
      ['oversized', 413],
      ['did', 502],
    ]) {
      mode = value
      assert.equal(
        (
          await client.call(
            'session',
            'POST',
            {
              device: randomUUID(),
              service: 'https://shimeji.us-east.host.bsky.network',
            },
            {authorization: 'Bearer ' + 'x'.repeat(32)},
          )
        ).status,
        status,
      )
      assert.equal(
        (await db.prepare('SELECT COUNT(*) AS count FROM sessions').first())
          .count,
        0,
      )
    }
  } finally {
    await dispose()
  }
})

const place = uri => ({
  version: 1,
  anchor: `at://${uri}/app.bsky.feed.post/fixture|repost:-|reply:-|context:at://${uri}/app.bsky.feed.post/fixture`,
  offset: -24.5,
  neighbors: [],
})

test('Author migration is atomic and copy-preserving with progress, tombstones, clock and stale legacy clients', async () => {
  const {runtime, db, token, dispose} = await workerRuntime(
    'https://skyanchor.test',
    undefined,
    false,
  )
  try {
    await db
      .prepare("INSERT INTO places VALUES (?, 'following', 51, ?, ?, 123)")
      .bind(didA, randomUUID(), JSON.stringify(place(didA)))
      .run()
    await db
      .prepare("INSERT INTO places VALUES (?, 'following', 52, ?, NULL, 456)")
      .bind(didB, randomUUID())
      .run()
    await db
      .prepare(
        "UPDATE clock SET revision = 55, nonce = 'preserved' WHERE id = 1",
      )
      .run()
    const before = await db.prepare('SELECT * FROM places ORDER BY did').all()
    const clock = await db.prepare('SELECT * FROM clock').first()
    const statements = readFileSync(
      path.join('worker', 'migrations', '0002_author_places.sql'),
      'utf8',
    )
      .split(';')
      .filter(value => value.trim())
    await assert.rejects(
      db.batch([
        ...statements.map(sql => db.prepare(sql)),
        db.prepare('INSERT INTO nonexistent_table VALUES (1)'),
      ]),
    )
    assert.deepEqual(
      (await db.prepare('SELECT * FROM places ORDER BY did').all()).results,
      before.results,
    )
    await db.batch(statements.map(sql => db.prepare(sql)))
    assert.deepEqual(
      (await db.prepare('SELECT * FROM places ORDER BY did').all()).results,
      before.results,
    )
    assert.deepEqual(await db.prepare('SELECT * FROM clock').first(), clock)
    const client = context(runtime)
    await client.call(
      'session',
      'POST',
      {device: randomUUID()},
      {authorization: 'Bearer ' + token(didA)},
    )
    assert.equal(
      (await client.call('place', 'PUT', {revision: 0, state: place(didA)}))
        .status,
      409,
    )
    assert.equal((await client.call('place')).value.revision, 51)
    const author = 'author|' + didB + '|posts_with_replies'
    assert.equal(
      (
        await client.call('place?feed=' + encodeURIComponent(author), 'PUT', {
          revision: 0,
          state: place(didB),
        })
      ).status,
      200,
    )
    assert.deepEqual(
      (
        await db
          .prepare("SELECT * FROM places WHERE feed = 'following' ORDER BY did")
          .all()
      ).results,
      before.results,
    )
  } finally {
    await dispose()
  }
})

test('Semantic author cloud feeds retain independent CAS/tombstones, reject ambiguous queries and bound growth without eviction', async () => {
  const {runtime, db, token, dispose} = await workerRuntime()
  try {
    const a = context(runtime),
      b = context(runtime)
    for (const client of [a, b])
      await client.call(
        'session',
        'POST',
        {device: randomUUID()},
        {authorization: 'Bearer ' + token(didA)},
      )
    const feed = 'author|' + didB + '|posts_with_replies'
    const endpoint = 'place?feed=' + encodeURIComponent(feed)
    const following = await a.call('place', 'PUT', {
      revision: 0,
      state: place(didA),
    })
    const saved = await a.call(endpoint, 'PUT', {
      revision: 0,
      state: place(didB),
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.value.did, didA)
    assert.equal(saved.value.feed, feed)
    const otherOwner = context(runtime)
    await otherOwner.call(
      'session',
      'POST',
      {device: randomUUID()},
      {authorization: 'Bearer ' + token(didB)},
    )
    assert.equal((await otherOwner.call(endpoint)).value.state, null)
    assert.equal((await otherOwner.call(endpoint)).value.did, didB)
    const webFeed = 'author|did:web:public.example.test|posts_with_replies'
    const webSaved = await a.call(
      'place?feed=' + encodeURIComponent(webFeed),
      'PUT',
      {revision: 0, state: place(didA)},
    )
    assert.equal(webSaved.status, 200)
    assert.equal(webSaved.value.feed, webFeed)
    assert.equal(
      (await b.call(endpoint, 'PUT', {revision: 0, state: place(didA)})).status,
      409,
    )
    assert.deepEqual((await a.call('place')).value, following.value)
    const removed = await a.call(endpoint, 'DELETE', {
      revision: saved.value.revision,
    })
    assert.equal(removed.value.state, null)
    assert.equal(
      (await b.call(endpoint, 'PUT', {revision: 0, state: place(didB)})).status,
      409,
    )
    for (const query of [
      '?owner=' + didA,
      '?feed=' + encodeURIComponent(feed) + '&feed=following',
      '?feed=following&did=' + didA,
      '?feed=sharonk',
      '?feed=' + 'a'.repeat(300),
      '?feed=author%7C' + didB + '%7Cposts_with_video',
    ]) {
      assert.equal((await a.call('place' + query)).status, 400)
    }
    assert.equal(
      (
        await a.call(endpoint, 'PUT', {
          revision: removed.value.revision,
          state: place(didB),
          did: didB,
        })
      ).status,
      400,
    )
    for (let i = 0; i < 62; i++) {
      const actor =
        'did:plc:' +
        'a'.repeat(22) +
        String.fromCharCode(97 + Math.floor(i / 26)) +
        String.fromCharCode(97 + (i % 26))
      await db
        .prepare('INSERT INTO places VALUES (?, ?, ?, ?, NULL, 1)')
        .bind(
          didA,
          'author|' + actor + '|posts_with_media',
          100 + i,
          randomUUID(),
        )
        .run()
    }
    const full =
      'place?feed=' +
      encodeURIComponent('author|' + didA + '|posts_and_author_threads')
    assert.equal(
      (await a.call(full, 'PUT', {revision: 0, state: place(didA)})).status,
      422,
    )
    assert.deepEqual((await a.call('place')).value, following.value)
    assert.equal(
      (await a.call(endpoint)).value.revision,
      removed.value.revision,
    )
  } finally {
    await dispose()
  }
})

test('Public config uses only fixed GET upstreams, strips credentials and caches bounded successful JSON', async () => {
  const calls = []
  let mode = 'ok'
  const {runtime, dispose} = await workerRuntime(
    'https://skyanchor.test',
    request => {
      calls.push({
        url: request.url,
        method: request.method,
        authorization: request.headers.get('authorization'),
        cookie: request.headers.get('cookie'),
      })
      if (mode === 'redirect')
        return new Response(null, {
          status: 302,
          headers: {location: 'https://evil.test/'},
        })
      if (mode === 'oversize')
        return new Response('x'.repeat(131073), {
          headers: {'content-type': 'application/json'},
        })
      if (mode === 'invalid')
        return new Response('{broken', {
          headers: {'content-type': 'application/json'},
        })
      if (mode === 'html')
        return new Response('<html>upstream error</html>', {
          headers: {'content-type': 'text/html'},
        })
      return new Response('{"liveNow":{"allow":["CA"],"exceptions":[]}}', {
        headers: {'content-type': 'application/json'},
      })
    },
  )
  try {
    const url = 'https://skyanchor.test/api/skyanchor/app-config/config'
    for (let i = 0; i < 2; i++) {
      const response = await runtime.dispatchFetch(url, {
        headers: {authorization: 'Bearer private', cookie: 'private=value'},
      })
      assert.equal(response.status, 200)
      assert.match(response.headers.get('cache-control'), /public/)
      assert.equal(response.headers.get('set-cookie'), null)
      assert.deepEqual(await response.json(), {
        liveNow: {allow: ['CA'], exceptions: []},
      })
    }
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], {
      url: 'https://app-config.workers.bsky.app/config',
      method: 'GET',
      authorization: null,
      cookie: null,
    })
    assert.equal(
      (await runtime.dispatchFetch(url + '?url=https://evil.test')).status,
      400,
    )
    assert.equal(
      (await runtime.dispatchFetch(url, {method: 'POST'})).status,
      405,
    )
    assert.equal(
      (
        await runtime.dispatchFetch(
          'https://skyanchor.test/api/skyanchor/proxy?url=https://evil.test',
        )
      ).status,
      400,
    )
    assert.equal(calls.length, 1)
    const live = 'https://skyanchor.test/api/skyanchor/live-events/config'
    for (const [value, status] of [
      ['redirect', 502],
      ['oversize', 413],
      ['invalid', 400],
      ['html', 502],
    ]) {
      mode = value
      assert.equal((await runtime.dispatchFetch(live)).status, status)
    }
    assert.ok(
      calls.every(call =>
        [
          'https://app-config.workers.bsky.app/config',
          'https://live-events.workers.bsky.app/config',
        ].includes(call.url),
      ),
    )
  } finally {
    await dispose()
  }
})

test('Viewer geolocation uses Cloudflare country/state, exposes neither IP nor city and fails unavailable metadata explicitly', async () => {
  const {runtime, dispose} = await workerRuntime()
  try {
    const url = 'https://skyanchor.test/api/skyanchor/geolocation/geolocation'
    for (const cf of [
      {country: 'US', regionCode: 'TX'},
      {country: 'US', regionCode: 'CA'},
      {country: 'GB'},
      {country: 'CA', regionCode: 'ON'},
    ]) {
      const response = await runtime.dispatchFetch(url, {
        cf: {regionCode: null, ...cf, city: 'Private city'},
        headers: {'cf-connecting-ip': '192.0.2.1'},
      })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.deepEqual(await response.json(), {
        countryCode: cf.country,
        ...(cf.regionCode ? {regionCode: cf.regionCode} : {}),
      })
    }
    for (const cf of [
      {},
      {country: 'XX'},
      {country: 'US'},
      {country: 'US', regionCode: 'bad'},
      {country: 'T1'},
    ]) {
      const response = await runtime.dispatchFetch(url, {
        cf: {country: null, regionCode: null, ...cf},
      })
      assert.equal(response.status, 503)
      assert.match((await response.json()).error, /unavailable/)
    }
  } finally {
    await dispose()
  }
})

test('Versioned migration preserves progress, revisions and tombstones and repairs only a lagging clock', async () => {
  const {db, dispose} = await workerRuntime()
  try {
    await db
      .prepare("INSERT INTO places VALUES (?, 'following', 51, ?, NULL, 123)")
      .bind(didA, randomUUID())
      .run()
    const migration = readFileSync(
      path.join('worker', 'migrations', '0001_reading.sql'),
      'utf8',
    )
    for (let pass = 0; pass < 2; pass++) {
      for (const sql of migration.split(';').filter(value => value.trim()))
        await db.prepare(sql).run()
      assert.equal(
        (await db.prepare('SELECT revision FROM clock WHERE id = 1').first())
          .revision,
        51,
      )
      assert.deepEqual(
        await db
          .prepare('SELECT revision, state, updated FROM places WHERE did = ?')
          .bind(didA)
          .first(),
        {revision: 51, state: null, updated: 123},
      )
    }
  } finally {
    await dispose()
  }
})

test('Expired private session renews only with verified access token and invalidates old cookie', async () => {
  const {runtime, db, token, dispose} = await workerRuntime()
  try {
    const a = context(runtime)
    const access = token(didA)
    await a.call(
      'session',
      'POST',
      {device: randomUUID()},
      {authorization: 'Bearer ' + access},
    )
    const oldCookie = a.cookie
    await db.prepare('UPDATE sessions SET expires = 0').run()
    assert.equal((await a.call('place')).status, 401)
    assert.equal(
      (
        await a.call(
          'session',
          'POST',
          {device: randomUUID()},
          {authorization: 'Bearer ' + access},
        )
      ).status,
      200,
    )
    assert.notEqual(a.cookie, oldCookie)
    assert.equal((await a.call('place')).status, 200)
    assert.equal(
      (await a.call('place', 'GET', undefined, {cookie: oldCookie})).status,
      401,
    )
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS count FROM sessions').first())
        .count,
      1,
    )
  } finally {
    await dispose()
  }
})

test('Worker verifies account authority, origin, token and cookie CSRF; never accepts client DID', async () => {
  const {runtime, token, dispose} = await workerRuntime()
  try {
    const a = context(runtime)
    assert.equal((await a.call('place')).status, 401)
    assert.equal(
      (
        await a.call(
          'session',
          'POST',
          {device: randomUUID()},
          {authorization: 'Bearer ' + 'x'.repeat(40)},
        )
      ).status,
      401,
    )
    assert.equal(
      (
        await a.call(
          'session',
          'POST',
          {device: randomUUID(), did: didB},
          {authorization: 'Bearer ' + token(didA)},
        )
      ).status,
      400,
    )
    assert.equal(
      (
        await a.call(
          'session',
          'POST',
          {device: randomUUID()},
          {authorization: 'Bearer ' + token(didA), origin: 'https://evil.test'},
        )
      ).status,
      403,
    )
    const login = await a.call(
      'session',
      'POST',
      {device: randomUUID()},
      {authorization: 'Bearer ' + token(didA)},
    )
    assert.equal(login.value.did, didA)
    assert.match(login.setCookie, /HttpOnly; Secure; SameSite=Strict/)
    assert.equal(
      (
        await a.call('session', 'DELETE', undefined, {
          'x-skyanchor-csrf': 'other-account-csrf',
        })
      ).status,
      403,
    )
    assert.equal(
      (await a.call('place')).status,
      200,
      'A different account CSRF token cannot revoke the active cookie',
    )
    assert.equal(
      (
        await a.call(
          'place',
          'PUT',
          {revision: 0, state: place(didA)},
          {'x-skyanchor-csrf': 'wrong'},
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await a.call(
          'place',
          'PUT',
          {revision: 0, state: place(didA)},
          {'sec-fetch-site': 'cross-site'},
        )
      ).status,
      403,
    )
  } finally {
    await dispose()
  }
})

test('D1 CAS prevents stale concurrent writes and ABA across delete; account and device isolation', async () => {
  const {runtime, db, token, dispose} = await workerRuntime()
  try {
    const a = context(runtime),
      a2 = context(runtime),
      b = context(runtime)
    const deviceA = randomUUID(),
      deviceA2 = randomUUID()
    await a.call(
      'session',
      'POST',
      {device: deviceA},
      {authorization: 'Bearer ' + token(didA)},
    )
    await a2.call(
      'session',
      'POST',
      {device: deviceA2},
      {authorization: 'Bearer ' + token(didA)},
    )
    await b.call(
      'session',
      'POST',
      {device: randomUUID()},
      {authorization: 'Bearer ' + token(didB)},
    )
    assert.equal(
      (await a.call('place', 'GET', undefined, {cookie: b.cookie})).status,
      403,
      'A stale account CSRF cannot read a replacement account cookie',
    )
    assert.equal(
      (
        await a.call(
          'place',
          'PUT',
          {revision: 0, state: place(didA)},
          {cookie: b.cookie},
        )
      ).status,
      403,
      'A replacement cookie cannot write old-account progress into the new account',
    )
    assert.equal((await b.call('place')).value.state, null)
    const writes = await Promise.all([
      a.call('place', 'PUT', {revision: 0, state: place(didA)}),
      a2.call('place', 'PUT', {
        revision: 0,
        state: {...place(didA), offset: 40},
      }),
    ])
    assert.deepEqual(writes.map(write => write.status).sort(), [200, 409])
    const first = (await a.call('place')).value
    assert.equal(first.revision, 1)
    assert.ok([deviceA, deviceA2].includes(first.device))
    assert.equal((await b.call('place')).value.state, null)
    const deletion = await a.call('place', 'DELETE', {revision: first.revision})
    assert.equal(deletion.value.revision, 2)
    assert.equal(deletion.value.state, null)
    assert.equal(
      (await a2.call('place', 'PUT', {revision: 0, state: place(didA)})).status,
      409,
    )
    assert.equal(
      (await a2.call('place', 'PUT', {revision: 1, state: place(didA)})).status,
      409,
    )
    const recreated = await a.call('place', 'PUT', {
      revision: 2,
      state: place(didA),
    })
    assert.equal(recreated.value.revision, 3)
    const stored = await db
      .prepare('SELECT state FROM places WHERE did = ?')
      .bind(didA)
      .first()
    assert.equal(stored.state.includes('refreshJwt'), false)
    assert.equal((await a.call('session', 'DELETE')).status, 200)
    assert.equal((await a.call('place')).status, 401)
    assert.equal((await a2.call('place')).status, 200)
    await a2.call(
      'session',
      'POST',
      {device: deviceA2},
      {authorization: 'Bearer ' + token(didB)},
    )
    assert.equal((await a2.call('place')).value.state, null)
  } finally {
    await dispose()
  }
})

test('Worker rejects oversized, malformed, unbounded and unexpected REST inputs', async () => {
  const {runtime, token, dispose} = await workerRuntime()
  try {
    const a = context(runtime)
    await a.call(
      'session',
      'POST',
      {device: randomUUID()},
      {authorization: 'Bearer ' + token(didA)},
    )
    for (const state of [
      {...place(didA), offset: Infinity},
      {...place(didA), offset: 20001},
      {...place(didA), neighbors: Array(9).fill(place(didA).anchor)},
      {...place(didA), did: didB},
      {...place(didA), anchor: 'https://localhost/secret'},
      {...place(didA), anchor: 'x'.repeat(17000)},
      {...place(didA), anchor: place(didA).anchor + '|untrusted:garbage'},
    ])
      assert.ok(
        [400, 413].includes(
          (await a.call('place', 'PUT', {revision: 0, state})).status,
        ),
      )
    assert.equal((await a.call('place?did=' + didB)).status, 400)
    assert.equal(
      (await a.call('place', 'PUT', {revision: -1, state: place(didA)})).status,
      400,
    )
    assert.equal(
      (
        await a.call('place', 'PUT', {
          revision: 0,
          state: place(didA),
          did: didB,
        })
      ).status,
      400,
    )
    assert.equal(
      (await a.call('session', 'DELETE', undefined, {'x-skyanchor-csrf': ''}))
        .status,
      200,
    )
    assert.equal((await a.call('place')).status, 401)
  } finally {
    await dispose()
  }
})
