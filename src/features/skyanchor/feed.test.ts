import {FeedTuner} from '#/lib/api/feed-manip'
import {createLexClient} from '#/lib/lexClient'
import {type app} from '#/lexicons'
import {occurrenceKey} from './domain'
import {
  bridgeNewer,
  isNewReadingOccurrence,
  rawKey,
  recoverRemoteWindow,
} from './feed'

const mockFetch = jest.fn()
jest.mock('#/lib/api/feed/home', () => ({
  FALLBACK_MARKER_POST: {post: {uri: 'at://did:plc:test/app.bsky.feed.post/1'}},
}))
jest.unmock('multiformats/cid')
jest.mock('#/lib/api/feed/following', () => ({
  FollowingFeedAPI: jest.fn().mockImplementation(() => ({fetch: mockFetch})),
}))
jest.mock('#/logger', () => ({logger: {info: jest.fn()}}))
jest.mock('#/analytics/identifiers', () => ({
  getDeviceId: jest.fn(),
  getSessionId: jest.fn(),
}))

const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const uri = `at://${did}/app.bsky.feed.post/target` as const
const post = {
  uri,
  cid: 'bafyreid3vrfucv7zppnqstf55xqzjowz6h2didm6twx37xazp4k5vcj7ty',
  author: {did, handle: 'reader.test'},
  record: {
    $type: 'app.bsky.feed.post',
    text: 'Current target',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  indexedAt: '2026-01-01T00:00:00.000Z',
} satisfies app.bsky.feed.defs.PostView
const reason = {
  $type: 'app.bsky.feed.defs#reasonRepost',
  by: {did, handle: 'reader.test'},
  indexedAt: '2026-01-02T00:00:00.000Z',
} satisfies app.bsky.feed.defs.ReasonRepost
const place = {
  version: 1 as const,
  anchor: occurrenceKey(uri, reason),
  offset: -41,
  neighbors: [],
}
function clientWithPosts() {
  const call = jest.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({posts: [post]}), {
        headers: {'content-type': 'application/json'},
      }),
    ),
  )
  const client = createLexClient({fetchHandler: call})
  return {client, call}
}

beforeEach(() => mockFetch.mockReset())

it('detects new occurrences without treating fetched duplicates or changed counters as new posts', () => {
  const pages = [
    {
      api: {fetch: mockFetch, peekLatest: mockFetch},
      feed: [{post}, {post, reason}],
      cursor: undefined,
      fetchedAt: 1,
    },
  ]
  expect(isNewReadingOccurrence(pages, {post: {...post, likeCount: 4}})).toBe(
    false,
  )
  expect(isNewReadingOccurrence(pages, {post, reason: {...reason}})).toBe(false)
  expect(
    isNewReadingOccurrence(pages, {
      post,
      reason: {...reason, indexedAt: '2026-01-03T00:00:00.000Z'},
    }),
  ).toBe(true)
  expect(
    isNewReadingOccurrence(pages, {
      post: {...post, uri: `at://${did}/app.bsky.feed.post/new`},
    }),
  ).toBe(true)
})

it('recovers the exact repost from later real history and revalidates current posts, not just its URI', async () => {
  const {client, call} = clientWithPosts()
  mockFetch
    .mockResolvedValueOnce({feed: [{post}], cursor: 'next'})
    .mockResolvedValue({feed: [{post, reason}]})
  const page = await recoverRemoteWindow(
    did,
    client,
    place,
    'following',
    () => true,
  )
  expect(mockFetch).toHaveBeenNthCalledWith(2, {
    cursor: 'next',
    limit: 30,
    signal: expect.any(AbortSignal),
  })
  expect(page.feed[0].reason).toEqual(expect.objectContaining(reason))
  expect(call).toHaveBeenCalledTimes(1)
})

it('bounds unavailable occurrence recovery without substituting a same-URI original or a neighbor', async () => {
  const {client, call} = clientWithPosts()
  mockFetch.mockImplementation(() =>
    Promise.resolve({
      feed: [{post}],
      cursor: String(mockFetch.mock.calls.length),
    }),
  )
  await expect(
    recoverRemoteWindow(did, client, place, 'following', () => true),
  ).rejects.toThrow('history-limit')
  expect(mockFetch).toHaveBeenCalledTimes(296)
  expect(call).not.toHaveBeenCalled()
})

it('recovers beyond 360 entries with progress and retains the actual history cursor without a second shallow search', async () => {
  const {client, call} = clientWithPosts()
  mockFetch.mockImplementation(() => {
    const index = mockFetch.mock.calls.length
    return Promise.resolve({
      feed:
        index === 16
          ? [{post, reason}]
          : Array.from({length: 30}, () => ({post})),
      cursor: 'page' + index,
    })
  })
  const progress = jest.fn()
  const result = await recoverRemoteWindow(
    did,
    client,
    place,
    'following',
    () => true,
    undefined,
    progress,
  )
  expect(mockFetch).toHaveBeenCalledTimes(16)
  expect(progress).toHaveBeenLastCalledWith(16, 'revalidate')
  expect(result.cursor).toBe('page16')
  expect(call).toHaveBeenCalledTimes(1)
})

it.each(['exhausted', 'loop', 'oversized', 'deleted'])(
  'preserves exact-identity failure for %s history',
  async kind => {
    const {client, call} = clientWithPosts()
    mockFetch.mockResolvedValue({
      feed:
        kind === 'oversized'
          ? Array.from({length: 31}, () => ({post}))
          : [{post, ...(kind === 'deleted' ? {reason} : {})}],
      cursor: kind === 'exhausted' ? undefined : 'loop',
    })
    if (kind === 'deleted')
      call.mockResolvedValue(
        new Response(JSON.stringify({posts: []}), {
          headers: {'content-type': 'application/json'},
        }),
      )
    await expect(
      recoverRemoteWindow(did, client, place, 'following', () => true),
    ).rejects.toThrow(
      kind === 'exhausted'
        ? 'unavailable'
        : kind === 'loop'
          ? 'cursor-loop'
          : kind === 'oversized'
            ? 'response-limit'
            : 'unavailable',
    )
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(2)
  },
)

it('aborts a hung retrieval on its wall-time deadline and cleans up the owning request', async () => {
  jest.useFakeTimers()
  const {client} = clientWithPosts()
  let aborted = false
  mockFetch.mockImplementation(
    ({signal}: {signal: AbortSignal}) =>
      new Promise((_, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            const reason: unknown = signal.reason
            reject(
              reason instanceof Error ? reason : new Error('History cancelled'),
            )
          },
          {once: true},
        )
      }),
  )
  try {
    const result = expect(
      recoverRemoteWindow(did, client, place, 'following', () => true),
    ).rejects.toThrow('timed out')
    await jest.advanceTimersByTimeAsync(90_000)
    await result
    expect(aborted).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  } finally {
    jest.useRealTimers()
  }
})

it('retains the failing request phase and HTTP status without retaining provider payloads', async () => {
  const {client} = clientWithPosts()
  mockFetch.mockRejectedValue({
    status: 429,
    message: 'untrusted provider payload',
  })
  await expect(
    recoverRemoteWindow(did, client, place, 'following', () => true),
  ).rejects.toMatchObject({
    reason: 'history-request',
    status: 429,
    message: 'history-request',
  })
})

it.each(['cursor', 'feed'])(
  'bounds %s response memory before adopting a candidate',
  async kind => {
    const {client} = clientWithPosts()
    mockFetch.mockResolvedValue({
      feed: [
        {
          post:
            kind === 'feed'
              ? {
                  ...post,
                  record: {...post.record, text: 'x'.repeat(9 * 1024 * 1024)},
                }
              : post,
        },
      ],
      cursor: kind === 'cursor' ? 'x'.repeat(8193) : 'next',
    })
    await expect(
      recoverRemoteWindow(did, client, place, 'following', () => true),
    ).rejects.toThrow('response-limit')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  },
)

it('cancels a delayed history completion before fetching or adopting another account window', async () => {
  const {client, call} = clientWithPosts()
  let active = true
  mockFetch.mockImplementation(() => {
    active = false
    return Promise.resolve({feed: [{post, reason}]})
  })
  await expect(
    recoverRemoteWindow(did, client, place, 'following', () => active),
  ).rejects.toThrow('cancelled')
  expect(call).not.toHaveBeenCalled()
})

function historyFixture(count = 180) {
  const history: app.bsky.feed.defs.FeedViewPost[] = Array.from(
    {length: count},
    (_, index) => ({
      post: {
        ...post,
        uri: `at://${did}/app.bsky.feed.post/item${index}` as const,
      },
    }),
  )
  const fetch = jest.fn(({cursor}: {cursor?: string}) => {
    const index = Number(cursor ?? 0)
    return Promise.resolve({
      feed: history.slice(index, index + 30),
      cursor: index + 30 < history.length ? String(index + 30) : undefined,
    })
  })
  const api = {fetch, peekLatest: jest.fn()}
  const original = {
    pages: [
      {api, feed: history.slice(150), cursor: 'older-session', fetchedAt: 1},
    ],
    pageParams: [undefined],
  }
  return {history, api, original, fetch}
}

it('bridges five pages and verifies a fresh head while retaining the entire older window and cursor session', async () => {
  const {history, api, original, fetch} = historyFixture()
  const result = await bridgeNewer(
    original,
    () => api,
    new AbortController().signal,
    () => true,
    jest.fn(),
  )
  expect(
    result.pages.flatMap(page => page.feed).map(item => rawKey(item)),
  ).toEqual(history.map(item => rawKey(item)))
  expect(result.pages.at(-1)).toBe(original.pages[0])
  expect(result.pageParams.at(-1)).toBe(original.pageParams[0])
  expect(fetch).toHaveBeenCalledTimes(7)
  expect(fetch.mock.calls.at(-1)?.[0].cursor).toBeUndefined()
})

it('does not trust an old discovered head and includes arrivals during pagination before success', async () => {
  const {history, api, original, fetch} = historyFixture()
  const incoming = {
    post: {...post, uri: `at://${did}/app.bsky.feed.post/racing` as const},
  }
  fetch.mockImplementation(({cursor}) => {
    const index = Number(cursor ?? 0)
    const feed = history.slice(index, index + 30)
    if (index === 150) history.unshift(incoming)
    return Promise.resolve({
      feed,
      cursor: index + 30 < history.length ? String(index + 30) : undefined,
    })
  })
  const result = await bridgeNewer(
    original,
    () => api,
    new AbortController().signal,
    () => true,
    jest.fn(),
  )
  expect(result.pages[0].feed[0]).toBe(incoming)
  expect(
    result.pages.flatMap(page => page.feed).map(item => rawKey(item)),
  ).toEqual(history.map(item => rawKey(item)))
})

it('fails closed without overlap, on cursor loops, cancellation or changed owner/cache', async () => {
  for (const kind of ['missing', 'loop', 'abort', 'inactive']) {
    const {api, original, fetch} = historyFixture()
    const controller = new AbortController()
    fetch.mockImplementation(() => {
      if (kind === 'abort') controller.abort()
      return Promise.resolve({
        feed: [{post}],
        cursor: kind === 'missing' ? undefined : 'loop',
      })
    })
    await expect(
      bridgeNewer(
        original,
        () => api,
        controller.signal,
        () => kind !== 'inactive',
        jest.fn(),
      ),
    ).rejects.toThrow()
    expect(original.pages).toHaveLength(1)
    expect(original.pages[0].cursor).toBe('older-session')
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(2)
  }
})

it('continues past work batches, but never publishes a gap at the operational page limit', async () => {
  const {history, api, original} = historyFixture(9000)
  original.pages[0].feed = history.slice(450, 480)
  const progress = jest.fn()
  const result = await bridgeNewer(
    original,
    () => api,
    new AbortController().signal,
    () => true,
    progress,
  )
  expect(result.pages.flatMap(page => page.feed)).toHaveLength(480)
  expect(progress).toHaveBeenLastCalledWith(17)
  original.pages[0].feed = [{post}]
  await expect(
    bridgeNewer(
      original,
      () => api,
      new AbortController().signal,
      () => true,
      jest.fn(),
    ),
  ).rejects.toThrow(/limit|overlap/)
})

it('retains same-URI distinct reposts and reply contexts across composition without repeated occurrence rows', () => {
  const repost = {post, reason}
  const later = {
    post,
    reason: {...reason, indexedAt: '2026-01-03T00:00:00.000Z'},
  } satisfies app.bsky.feed.defs.FeedViewPost
  const tuner = new FeedTuner([FeedTuner.dedupThreads], true)
  expect(tuner.tune([{post}, repost, later, repost])).toHaveLength(3)
  expect(tuner.tune([later])).toHaveLength(0)
  const followingTuner = new FeedTuner([FeedTuner.dedupThreads])
  expect(followingTuner.tune([{post}, repost, later])).toHaveLength(1)
})
