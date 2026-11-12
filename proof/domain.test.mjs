import {test} from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {build} from 'esbuild'
import {
  occurrenceKey,
  chooseAnchor,
  readSnapshot,
  saveSnapshot,
  STORAGE_PREFIX,
  RETURN_PREFIX,
  readReturnCheckpoint,
  saveReturnCheckpoint,
  ReadingCapacityError,
  validReadingFeed,
  readingStorageKey,
  validSyncPlace,
  sameReadingPlace,
} from '../src/features/skyanchor/domain.ts'

const uri = 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/fixture'
test('Private checkpoint parsing binds owner/feed/device, immutable revisions and bounded response bytes', async () => {
  const built = await build({
    entryPoints: [path.join('src', 'features', 'skyanchor', 'checkpoints.ts')],
    bundle: true,
    format: 'esm',
    write: false,
  })
  const {
    normalizedDeviceName,
    defaultDeviceName,
    validDeviceList,
    validDeviceHistory,
    boundedSyncJson,
  } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(built.outputFiles[0].text).toString('base64')
  )
  const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
    device = '00000000-0000-4000-8000-000000000001'
  const state = {
    version: 1,
    anchor: occurrenceKey(uri),
    offset: -24,
    neighbors: [],
  }
  const history = {
    did,
    feed: 'following',
    device,
    saves: [
      {revision: 5, state, updated: 100},
      {revision: 3, state, updated: 99},
    ],
  }
  assert.equal(validDeviceHistory(history, did, 'following', device), true)
  for (const changes of [
    {did: 'other'},
    {feed: 'author|invalid'},
    {device: 'other'},
    {saves: [...history.saves].reverse()},
    {saves: Array(4).fill(history.saves[0])},
    {saves: [{...history.saves[0], state: {...state, offset: Infinity}}]},
    {saves: [{...history.saves[0], updated: -1}]},
  ])
    assert.equal(
      validDeviceHistory({...history, ...changes}, did, 'following', device),
      false,
    )
  const list = {
    did,
    feed: 'following',
    devices: [
      {
        device,
        label: 'Reader',
        labelKind: 'default',
        updated: 0,
        lastSaved: 100,
        count: 2,
      },
    ],
  }
  assert.equal(validDeviceList(list, did, 'following'), true)
  for (const devices of [
    [{...list.devices[0], label: undefined}],
    [...list.devices, ...list.devices],
    [{...list.devices[0], count: 0}],
    [{...list.devices[0], labelKind: undefined}],
    [{...list.devices[0], labelKind: 'guessed'}],
    Array(33).fill(list.devices[0]),
  ])
    assert.equal(validDeviceList({...list, devices}, did, 'following'), false)
  assert.equal(normalizedDeviceName('  Cafe\u0301  '), 'Café')
  assert.equal(normalizedDeviceName('\nReader'), undefined)
  assert.equal(defaultDeviceName(device), 'Browser - 0000')
  assert.match(
    defaultDeviceName(device, 'Version/20 Safari/600 iPhone'),
    /^Safari on iPhone/,
  )
  assert.equal(
    defaultDeviceName(device, 'Windows NT 10.0 Chrome/145 Safari/537 Edg/145'),
    'Edge on Windows - 0000',
  )
  assert.equal(
    validDeviceList(
      {...list, devices: [{...list.devices[0], labelKind: 'user'}]},
      did,
      'following',
    ),
    true,
  )
  let cancelled = false
  await assert.rejects(
    boundedSyncJson(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(100))
          },
          cancel() {
            cancelled = true
          },
        }),
      ),
      99,
    ),
    /bound/,
  )
  assert.equal(cancelled, true)
  assert.deepEqual(await boundedSyncJson(Response.json(history), 4096), history)
})
test('Shared-place agreement requires the actual occurrence and offset, not matching neighbor metadata', () => {
  const place = {
    version: 1,
    anchor: occurrenceKey(uri),
    offset: -24,
    neighbors: [],
  }
  assert.equal(
    sameReadingPlace(place, {...place, neighbors: [occurrenceKey(uri + '2')]}),
    true,
  )
  assert.equal(sameReadingPlace(place, {...place, offset: -27}), false)
  assert.equal(
    sameReadingPlace(place, {...place, anchor: occurrenceKey(uri + '2')}),
    false,
  )
  assert.equal(sameReadingPlace(undefined, place), false)
  assert.equal(sameReadingPlace(null, null), false)
})
test('Shared checkpoint time accepts server milliseconds and legacy absence, never invalid dates', () => {
  const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
  const remote = {did, revision: 1, device: 'synthetic-browser', state: null}
  for (const updated of [undefined, null, 1794373200000]) {
    assert.equal(validSyncPlace({...remote, updated}, did), true)
  }
  for (const updated of [
    '2026-11-11',
    NaN,
    Infinity,
    -1,
    0,
    1.5,
    8_640_000_000_000_001,
  ]) {
    assert.equal(validSyncPlace({...remote, updated}, did), false)
  }
})
test('Local author capacity is explicit and never evicts Following or previously saved places', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    get length() {
      return values.size
    },
    key: index => [...values.keys()][index] ?? null,
  }
  const snapshot = {
    place: {version: 1, anchor: occurrenceKey(uri), offset: -24, neighbors: []},
    feed: [],
  }
  saveSnapshot(storage, 'owner', snapshot)
  for (let i = 0; i < 64; i++) {
    const actor =
      'did:plc:' +
      'a'.repeat(22) +
      String.fromCharCode(97 + Math.floor(i / 26)) +
      String.fromCharCode(97 + (i % 26))
    saveSnapshot(
      storage,
      'owner',
      snapshot,
      'author|' + actor + '|posts_with_media',
    )
  }
  const before = [...values]
  assert.throws(
    () =>
      saveSnapshot(
        storage,
        'owner',
        snapshot,
        'author|did:web:example.test|posts_with_replies',
      ),
    ReadingCapacityError,
  )
  assert.deepEqual([...values], before)
  assert.deepEqual(readSnapshot(storage, 'owner'), snapshot)
  assert.equal(
    validReadingFeed('author|did:web:example.test|posts_with_replies'),
    true,
  )
})
test('Stable author DID and real filters isolate durable and Return state without changing legacy Following keys', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const owner = 'did:plc:cccccccccccccccccccccccc'
  const feeds = [
    'following',
    'author|did:plc:aaaaaaaaaaaaaaaaaaaaaaaa|posts_and_author_threads',
    'author|did:plc:aaaaaaaaaaaaaaaaaaaaaaaa|posts_with_replies',
    'author|did:plc:bbbbbbbbbbbbbbbbbbbbbbbb|posts_and_author_threads',
  ]
  feeds.forEach((feed, index) => {
    assert.equal(validReadingFeed(feed), true)
    const snapshot = {
      place: {
        version: 1,
        anchor: occurrenceKey(uri),
        offset: -(index + 1),
        neighbors: [],
      },
      feed: [],
    }
    saveSnapshot(storage, owner, snapshot, feed)
    saveReturnCheckpoint(storage, owner, snapshot, feed)
  })
  assert.equal(
    readingStorageKey(STORAGE_PREFIX, owner, 'following'),
    STORAGE_PREFIX + owner,
  )
  feeds.forEach((feed, index) => {
    assert.equal(readSnapshot(storage, owner, feed).place.offset, -(index + 1))
    assert.equal(
      readReturnCheckpoint(storage, owner, feed).place.offset,
      -(index + 1),
    )
    assert.equal(readSnapshot(storage, 'other-owner', feed), undefined)
  })
  for (const invalid of [
    'sharonk',
    'author|sharonk|posts_with_replies',
    'author|did:plc:aaaaaaaaaaaaaaaaaaaaaaaa|0',
    'author|did:plc:aaaaaaaaaaaaaaaaaaaaaaaa|posts_with_video',
    'author|' + 'a'.repeat(300),
  ])
    assert.equal(validReadingFeed(invalid), false)
})
test('Post, repost occurrence and reply context have distinct identities independent of cursors and timestamps', () => {
  const original = occurrenceKey(uri)
  const repost = {
    by: {did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'},
    indexedAt: '2025-01-01T00:00:00Z',
  }
  assert.notEqual(original, occurrenceKey(uri, repost))
  assert.notEqual(
    occurrenceKey(uri, repost),
    occurrenceKey(uri, {...repost, indexedAt: '2025-01-02T00:00:00Z'}),
  )
  assert.notEqual(
    original,
    occurrenceKey(uri, undefined, {root: {uri}, parent: {uri: uri + 'parent'}}),
  )
  assert.notEqual(
    original,
    occurrenceKey(uri, undefined, undefined, uri + 'context'),
  )
})
test('Return checkpoint is independent, account-scoped, migrates legacy snapshots and rejects unsupported or unbounded state', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const snapshot = {
    place: {version: 1, anchor: occurrenceKey(uri), offset: -82, neighbors: []},
    feed: [],
  }
  saveReturnCheckpoint(storage, 'a', snapshot)
  saveSnapshot(storage, 'a', {
    ...snapshot,
    place: {...snapshot.place, offset: 0},
  })
  assert.deepEqual(readReturnCheckpoint(storage, 'a'), snapshot)
  assert.equal(readReturnCheckpoint(storage, 'b'), undefined)
  values.set(RETURN_PREFIX + 'a', JSON.stringify(snapshot))
  assert.deepEqual(readReturnCheckpoint(storage, 'a'), snapshot)
  values.set(RETURN_PREFIX + 'a', JSON.stringify({version: 2, snapshot}))
  assert.throws(() => readReturnCheckpoint(storage, 'a'), /Unsupported/)
  assert.throws(() =>
    saveReturnCheckpoint(storage, 'a', {...snapshot, feed: Array(91).fill({})}),
  )
  values.set(RETURN_PREFIX + 'a', '{bad')
  assert.throws(() => readReturnCheckpoint(storage, 'a'))
})
test('Cold durable storage is per DID, bounded, rejects malformed data and preserves offset plus neighbors', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const place = {
    version: 1,
    anchor: occurrenceKey(uri),
    offset: -82.25,
    neighbors: [occurrenceKey(uri + '2')],
  }
  saveSnapshot(storage, 'account-a', {place, feed: []})
  assert.deepEqual(readSnapshot(storage, 'account-a'), {place, feed: []})
  assert.equal(readSnapshot(storage, 'account-b'), undefined)
  assert.throws(() =>
    saveSnapshot(storage, 'account-a', {place, feed: Array(91).fill({})}),
  )
  values.set(STORAGE_PREFIX + 'account-a', '{bad')
  assert.throws(() => readSnapshot(storage, 'account-a'))
  values.set(STORAGE_PREFIX + 'account-a', 'x'.repeat(1048577))
  assert.throws(() => readSnapshot(storage, 'account-a'))
})
test('Deleted/moderated anchors fall back honestly to a neighbor, never a timestamp maximum', () => {
  const anchor = occurrenceKey(uri),
    neighbor = occurrenceKey(uri + '2')
  const place = {version: 1, anchor, offset: -82, neighbors: [neighbor]}
  assert.deepEqual(chooseAnchor(place, [anchor, neighbor]), {
    key: anchor,
    fallback: false,
  })
  assert.deepEqual(chooseAnchor(place, [neighbor]), {
    key: neighbor,
    fallback: true,
  })
  assert.deepEqual(chooseAnchor(place, []), {key: undefined, fallback: true})
})
