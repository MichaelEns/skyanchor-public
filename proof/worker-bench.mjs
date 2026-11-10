import assert from 'node:assert/strict'
import fs from 'node:fs'
import {randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {workerRuntime, context, didA} from './runtime.mjs'

const worker = await workerRuntime()
const client = context(worker.runtime)
const samples = {}
async function measure(label, operation, status) {
  const before = performance.now()
  const response = await operation()
  assert.equal(response.status, status, label)
  ;(samples[label] ??= []).push(performance.now() - before)
  return response
}
try {
  for (let i = 0; i < 20; i++) {
    await measure(
      'verifiedSession',
      () =>
        client.call(
          'session',
          'POST',
          {device: randomUUID()},
          {authorization: 'Bearer ' + worker.token(didA)},
        ),
      200,
    )
    const remote = await measure('privateGet', () => client.call('place'), 200)
    const place = {
      version: 1,
      anchor: `at://${didA}/app.bsky.feed.post/fixture|repost:-|reply:-|context:at://${didA}/app.bsky.feed.post/fixture`,
      offset: -24.5,
      neighbors: [],
    }
    const saved = await measure(
      'casPut',
      () =>
        client.call('place', 'PUT', {
          revision: remote.value.revision,
          state: place,
        }),
      200,
    )
    await measure(
      'staleCasConflict',
      () =>
        client.call('place', 'PUT', {
          revision: remote.value.revision,
          state: place,
        }),
      409,
    )
    await measure(
      'casDelete',
      () => client.call('place', 'DELETE', {revision: saved.value.revision}),
      200,
    )
    await measure('cookieLogout', () => client.call('session', 'DELETE'), 200)
  }
  const summary = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b)
      return [
        name,
        {
          count: sorted.length,
          medianMs: sorted[Math.floor(sorted.length / 2)],
          p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
          maximumMs: sorted.at(-1),
        },
      ]
    }),
  )
  const report = {
    passed: true,
    realD1: true,
    sequentialRequests: 120,
    upstreamAuth: 'Fixed verifier mocked only inside isolated proof runtime',
    metric:
      'Local end-to-end wall-clock latency; not Cloudflare request CPU or production Worker memory',
    productionFreeCpuAcceptance:
      'Still requires owner deployed-account CPU measurements against the Free plan',
    samples: summary,
  }
  fs.writeFileSync(
    'proof-worker-bench.json',
    JSON.stringify(report, null, 2) + '\n',
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await worker.dispose()
}
