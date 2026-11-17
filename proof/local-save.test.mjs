import assert from 'node:assert/strict'
import fs from 'node:fs'
import {runInNewContext} from 'node:vm'
import {test} from 'node:test'
import ts from 'typescript'
import * as domain from '../src/features/skyanchor/domain.ts'

const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const uri = index => `at://${did}/app.bsky.feed.post/local${index}`

function fixture({recordBytes = 200, quota = Infinity, denied = false} = {}) {
  const rows = Array.from({length: 100}, (_, index) => ({
    post: {uri: uri(index), record: {}, context: 'x'.repeat(recordBytes)},
  }))
  const other = 'skyanchor:following:v1:other-account'
  const back = domain.RETURN_PREFIX + did
  const key = domain.STORAGE_PREFIX + did
  const data = new Map([
    [other, 'keep-other'],
    [back, 'keep-return'],
    [key, 'keep-existing'],
  ])
  const attempts = []
  const storage = {
    getItem: name => data.get(name) ?? null,
    setItem(name, text) {
      attempts.push({name, bytes: new TextEncoder().encode(text).byteLength})
      if (denied || text.length > quota)
        throw new DOMException('Storage capacity', 'QuotaExceededError')
      data.set(name, text)
    },
  }
  const exports = {}
  const source = ts.transpileModule(
    fs.readFileSync(
      process.env.SKYANCHOR_LOCAL_SAVE_SOURCE ??
        'src/features/skyanchor/feed.ts',
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText
  runInNewContext(source, {
    exports,
    localStorage: storage,
    require(name) {
      if (name === '@atproto/lex') return {lexToJson: value => value}
      if (name === './domain') return domain
      if (name === '#/types/bsky') return {isType: () => false}
      if (name === '#/lexicons')
        return {app: {bsky: {feed: {post: {}, defs: {reasonRepost: {}}}}}}
      if (name === '#/logger') return {logger: {info() {}}}
      if (
        name.endsWith('/author') ||
        name.endsWith('/following') ||
        name === '#/lib/async/requestDeadline'
      )
        return {}
      throw new Error('Unexpected dependency: ' + name)
    },
  })
  const place = {
    version: 1,
    anchor: domain.occurrenceKey(uri(60)),
    offset: -19.5,
    neighbors: [domain.occurrenceKey(uri(59))],
  }
  return {
    rows,
    place,
    data,
    attempts,
    save: () => exports.persistWindow(did, place, [{feed: rows}]),
    read: () => domain.readSnapshot(storage, did),
    unchanged() {
      assert.equal(data.get(other), 'keep-other')
      assert.equal(data.get(back), 'keep-return')
    },
  }
}

test('a large saved reading window contracts around the exact occurrence without cutting records or altering Return', () => {
  const value = fixture({recordBytes: 24000})
  value.save()
  const saved = value.read()
  assert.deepEqual(saved.place, value.place)
  assert.ok(saved.feed.length > 1 && saved.feed.length < 90)
  assert.ok(saved.feed.some(item => item.post.uri === uri(60)))
  assert.ok(saved.feed.every(item => item.post.context.length === 24000))
  const order = saved.feed.map(item =>
    value.rows.findIndex(row => row.post.uri === item.post.uri),
  )
  assert.ok(
    order.every((index, i) => !i || index === order[i - 1] + 1),
    'Cache remains a contiguous slice',
  )
  value.unchanged()
})

test('quota retries only replace this cache and always retain the current occurrence, even in a one-record window', () => {
  const value = fixture({recordBytes: 4000, quota: 7000})
  value.save()
  const saved = value.read()
  assert.deepEqual(saved.place, value.place)
  assert.equal(saved.feed.length, 1)
  assert.equal(saved.feed[0].post.uri, uri(60))
  assert.ok(value.attempts.length <= 8 && value.attempts.length > 1)
  assert.ok(
    value.attempts.every(item => item.name === domain.STORAGE_PREFIX + did),
  )
  value.unchanged()
})

test('denied storage or a single oversized occurrence fails explicitly without replacing the old save', () => {
  for (const options of [
    {denied: true},
    {recordBytes: domain.MAX_SNAPSHOT_BYTES + 1},
  ]) {
    const value = fixture(options)
    assert.throws(
      value.save,
      error =>
        domain.isStorageQuotaError(error) ||
        error instanceof domain.ReadingCacheSizeError,
    )
    assert.equal(value.data.get(domain.STORAGE_PREFIX + did), 'keep-existing')
    assert.ok(value.attempts.length <= 8)
    value.unchanged()
  }
})

test('ordinary saving keeps the full bounded cache and a missing occurrence is never replaced with a neighbor', () => {
  const value = fixture()
  value.save()
  assert.equal(value.read().feed.length, 55)
  assert.equal(value.attempts.length, 1)
  const before = value.data.get(domain.STORAGE_PREFIX + did)
  value.rows.splice(60, 1)
  assert.throws(value.save, domain.ReadingWindowError)
  assert.equal(value.data.get(domain.STORAGE_PREFIX + did), before)
})
