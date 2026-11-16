import assert from 'node:assert/strict'
import fs from 'node:fs'
import {runInNewContext} from 'node:vm'
import {test} from 'node:test'
import ts from 'typescript'

function fixture({failBatch = -1} = {}) {
  const saved = Array.from({length: 90}, (_, i) => ({
    post: {uri: `post${i}`, text: 'cached'},
  }))
  const calls = []
  const releases = []
  let concurrent = 0
  let maximum = 0
  const output = ts.transpileModule(
    fs.readFileSync(
      process.env.SKYANCHOR_RESTORE_SOURCE ?? 'src/features/skyanchor/feed.ts',
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText
  const exports = {}
  class API {
    async fetch() {
      return {feed: saved, cursor: 'older'}
    }
  }
  const snapshot = {place: {anchor: 'post0'}, feed: saved}
  runInNewContext(output, {
    exports,
    require(name) {
      if (name === '@atproto/lex')
        return {jsonToLex: value => value, lexToJson: value => value}
      if (name.endsWith('/following')) return {FollowingFeedAPI: API}
      if (name.endsWith('/author')) return {AuthorFeedAPI: API}
      if (name === '#/types/bsky') return {parse: (_type, value) => value}
      if (name === '#/lexicons')
        return {app: {bsky: {feed: {defs: {feedViewPost: {}}, getPosts: {}}}}}
      if (name === '#/logger') return {logger: {info() {}}}
      if (name === './domain') return {readSnapshot: () => snapshot}
      if (name === '#/lib/async/requestDeadline') return {}
      throw new Error('Unexpected restore dependency: ' + name)
    },
    localStorage: {},
    setTimeout,
  })
  const client = {
    async call(_method, {uris}, {signal}) {
      const batch = calls.length
      calls.push({uris: [...uris], signal})
      concurrent++
      maximum = Math.max(maximum, concurrent)
      try {
        await new Promise(resolve => releases.push(resolve))
        if (batch === failBatch) throw new Error('revalidation unavailable')
        return {
          posts: uris
            .filter(uri => uri !== 'post1')
            .map(uri => ({uri, text: 'current'})),
        }
      } finally {
        concurrent--
      }
    },
  }
  return {
    restore: () => exports.restoreWindow('reader', client),
    calls,
    releases,
    get maximum() {
      return maximum
    },
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

test(
  'saved-window revalidation overlaps at most three 25-post batches and checks every post before return',
  {timeout: 3000},
  async () => {
    const value = fixture()
    let complete = false
    const pending = value.restore().then(result => {
      complete = true
      return result
    })
    await tick()
    assert.equal(
      value.calls.length,
      3,
      'Three independent batches start without waiting for a network round trip',
    )
    assert.equal(value.maximum, 3)
    assert.equal(complete, false)
    value.releases.splice(0).forEach(release => release())
    await tick()
    assert.equal(value.calls.length, 4)
    assert.equal(
      complete,
      false,
      'The last batch must still finish before rendering',
    )
    value.releases.splice(0).forEach(release => release())
    const result = await pending
    assert.equal(value.maximum, 3)
    assert.deepEqual(
      value.calls.flatMap(call => call.uris),
      Array.from({length: 90}, (_, i) => `post${i}`),
    )
    assert.ok(value.calls.every(call => call.uris.length <= 25))
    assert.equal(result.feed.length, 89)
    assert.ok(result.feed.every(item => item.post.text === 'current'))
    assert.ok(
      !result.feed.some(item => item.post.uri === 'post1'),
      'Deleted posts stay removed',
    )
    assert.equal(result.cursor, 'older')
  },
)

test(
  'a failed revalidation batch rejects the whole saved window instead of showing unchecked cache',
  {timeout: 3000},
  async () => {
    const value = fixture({failBatch: 1})
    const pending = assert.rejects(value.restore(), /revalidation unavailable/)
    await tick()
    value.releases.splice(0).forEach(release => release())
    await pending
    assert.equal(value.calls.length, 3, 'No later group starts after failure')
  },
)
