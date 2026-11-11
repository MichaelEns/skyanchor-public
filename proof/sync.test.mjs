import path from 'node:path'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'

test(
  'A queued session exchange cancels promptly without sending, and an aborted response body releases the cookie queue',
  {timeout: 3000},
  async () => {
    const result = await build({
      entryPoints: [path.join('src', 'features', 'skyanchor', 'sync.web.ts')],
      bundle: true,
      format: 'esm',
      write: false,
    })
    const sync = await import(
      'data:text/javascript;base64,' +
        Buffer.from(result.outputFiles[0].text).toString('base64')
    )
    const original = globalThis.fetch
    const firstController = new AbortController()
    const queuedController = new AbortController()
    const calls = []
    globalThis.fetch = async (_url, init) => {
      calls.push(init.method)
      if (calls.length > 1) return new Response('{}')
      return new Response(
        new ReadableStream({
          start(controller) {
            init.signal.addEventListener(
              'abort',
              () => controller.error(init.signal.reason),
              {once: true},
            )
          },
        }),
      )
    }
    try {
      const first = sync.syncSessionRequest({
        method: 'POST',
        signal: firstController.signal,
      })
      const firstRejected = assert.rejects(first, {name: 'AbortError'})
      await new Promise(resolve => setImmediate(resolve))
      const queued = sync.syncSessionRequest({
        method: 'POST',
        signal: queuedController.signal,
      })
      const queuedRejected = assert.rejects(queued, {name: 'AbortError'})
      queuedController.abort(new Error('queued fixture cancelled'))
      await queuedRejected
      assert.deepEqual(calls, ['POST'])
      firstController.abort(new Error('first fixture cancelled'))
      await firstRejected
      await sync.syncSessionRequest({method: 'POST'})
      assert.deepEqual(calls, ['POST', 'POST'])
    } finally {
      firstController.abort()
      queuedController.abort()
      globalThis.fetch = original
    }
  },
)

test('Cookie changes serialize across delayed login, logout and next account; cancelled queued login never runs', async () => {
  const result = await build({
    entryPoints: [path.join('src', 'features', 'skyanchor', 'sync.web.ts')],
    bundle: true,
    format: 'esm',
    write: false,
  })
  const sync = await import(
    'data:text/javascript;base64,' +
      Buffer.from(result.outputFiles[0].text).toString('base64')
  )
  const original = globalThis.fetch
  const storageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  )
  const removed = []
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {removeItem: key => removed.push(key)},
  })
  const calls = []
  let complete
  globalThis.fetch = async (_url, init) => {
    calls.push(init.method)
    if (calls.length === 1)
      await new Promise(resolve => {
        complete = resolve
      })
    return new Response('{}')
  }
  try {
    let finishRefresh
    let refreshCalls = 0
    const refresh = () => {
      refreshCalls++
      return new Promise(resolve => {
        finishRefresh = resolve
      })
    }
    const refreshing = sync.refreshSyncAccount('owner', refresh)
    const concurrent = sync.refreshSyncAccount('owner', refresh)
    assert.equal(refreshing, concurrent)
    finishRefresh({did: 'owner', accessJwt: 'rotated-fixture-token'})
    assert.equal((await concurrent).accessJwt, 'rotated-fixture-token')
    assert.equal(refreshCalls, 1)
    await assert.rejects(
      sync.refreshSyncAccount('owner', async () => {
        throw new Error('network unavailable')
      }),
      /network unavailable/,
    )
    assert.equal(
      (
        await sync.refreshSyncAccount('owner', async () => ({
          did: 'owner',
          accessJwt: 'recovered',
        }))
      ).accessJwt,
      'recovered',
    )
    const first = sync.syncSessionRequest({method: 'POST'})
    await new Promise(resolve => setImmediate(resolve))
    const logout = sync.syncSessionRequest({method: 'DELETE'})
    const cancelled = sync.syncSessionRequest({method: 'POST'}, () => false)
    const rejection = assert.rejects(cancelled, /account changed/)
    const next = sync.syncSessionRequest({method: 'POST'})
    assert.deepEqual(calls, ['POST'])
    complete()
    await Promise.all([first, logout, rejection, next])
    assert.deepEqual(calls, ['POST', 'DELETE', 'POST'])
    sync.setSyncCsrf('inactive', 'old-account-csrf')
    sync.clearReadingAccount('inactive', false)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(
      calls,
      ['POST', 'DELETE', 'POST'],
      'Removing an inactive account must not revoke the currently active shared cookie',
    )
    assert.ok(removed.every(key => key.endsWith('inactive')))
  } finally {
    globalThis.fetch = original
    if (storageDescriptor)
      Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
    else delete globalThis.localStorage
  }
})
