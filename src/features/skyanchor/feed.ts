import {type Client, jsonToLex, type JsonValue, lexToJson} from '@atproto/lex'
import {type AtIdentifierString} from '@atproto/syntax'

import {AuthorFeedAPI} from '#/lib/api/feed/author'
import {FollowingFeedAPI} from '#/lib/api/feed/following'
import {type FeedAPI} from '#/lib/api/feed/types'
import {logger} from '#/logger'
import {type FeedPageUnselected} from '#/state/queries/post-feed'
import {app} from '#/lexicons'
import * as bsky from '#/types/bsky'
import {
  MAX_OCCURRENCES,
  occurrenceKey,
  type ReadingFeed,
  type ReadingPlace,
  type ReadingSnapshot,
  readSnapshot,
  saveSnapshot,
} from './domain'

export function readingFeedAPI(
  client: Client,
  feed: ReadingFeed = 'following',
) {
  if (feed === 'following') return new FollowingFeedAPI({client})
  const [, actor, filter] = feed.split('|')
  return new AuthorFeedAPI({
    client,
    feedParams: {actor: actor as AtIdentifierString, filter},
  })
}

export function rawKey(
  item: app.bsky.feed.defs.FeedViewPost,
  uri = item.post.uri,
) {
  const repost = bsky.isType(app.bsky.feed.defs.reasonRepost, item.reason)
    ? item.reason
    : undefined
  let reply =
    item.reply && 'uri' in item.reply.root && 'uri' in item.reply.parent
      ? {root: {uri: item.reply.root.uri}, parent: {uri: item.reply.parent.uri}}
      : undefined
  if (uri !== item.post.uri && item.reply) {
    const context = [item.reply.root, item.reply.parent].find(
      post => 'uri' in post && post.uri === uri,
    )
    if (
      context &&
      'record' in context &&
      bsky.isType(app.bsky.feed.post, context.record)
    )
      reply = context.record.reply
  }
  return occurrenceKey(uri, repost, reply, item.post.uri)
}

export function isNewReadingOccurrence(
  pages: FeedPageUnselected[],
  item: app.bsky.feed.defs.FeedViewPost,
) {
  const key = rawKey(item)
  return !pages.some(page => page.feed.some(known => rawKey(known) === key))
}

/** Stage a complete bridge; never publish partial history or trust a discovery buffer. */
export async function bridgeNewer(
  original: {pages: FeedPageUnselected[]; pageParams: unknown[]},
  createAPI: () => FeedAPI,
  signal: AbortSignal,
  active: () => boolean,
  progress: (pages: number) => void,
) {
  let staged = original
  let requests = 0
  let bytes = 0
  const deadline = Date.now() + 90_000
  const check = () => {
    signal.throwIfAborted()
    if (!active()) throw new Error('Reading window changed; load cancelled')
    if (Date.now() > deadline || requests >= 300 || bytes > 16 * 1024 * 1024)
      throw new Error('History exceeds the safe retrieval limit')
  }
  const fetchPage = async (api: FeedAPI, cursor?: string) => {
    check()
    const response = await api.fetch({cursor, limit: 30, signal})
    check()
    requests++
    bytes += JSON.stringify(lexToJson(response.feed)).length * 2
    progress(requests)
    if (requests % 5 === 0)
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    check()
    return {...response, cursor: response.cursor, api, fetchedAt: Date.now()}
  }
  let api = createAPI()
  let head = await fetchPage(api)
  for (let verification = 0; verification < 3; verification++) {
    const oldKeys = staged.pages.flatMap(page =>
      page.feed.map(item => rawKey(item)),
    )
    if (!oldKeys.length)
      throw new Error('No existing occurrence is available to verify overlap')
    const oldIndex = new Map(oldKeys.map((key, index) => [key, index]))
    const needed = Math.min(3, oldKeys.length)
    const pages = [head]
    const incoming: string[] = []
    let overlap = -1
    const cursors = new Set<string>()
    while (overlap === -1) {
      const page = pages[pages.length - 1]
      incoming.push(...page.feed.map(item => rawKey(item)))
      for (
        let index = Math.max(0, incoming.length - page.feed.length - needed);
        index <= incoming.length - needed;
        index++
      ) {
        const old = oldIndex.get(incoming[index])
        if (
          old !== undefined &&
          old + needed <= oldKeys.length &&
          incoming
            .slice(index, index + needed)
            .every((key, offset) => key === oldKeys[old + offset])
        ) {
          overlap = index
          break
        }
      }
      if (overlap !== -1) break
      if (!page.cursor || cursors.has(page.cursor))
        throw new Error('Current service history has no verified overlap')
      cursors.add(page.cursor)
      pages.push(await fetchPage(api, page.cursor))
    }
    let remaining = overlap
    const prefix = pages.flatMap(page => {
      const count = Math.min(remaining, page.feed.length)
      remaining -= count
      const feed = page.feed
        .slice(0, count)
        .filter(item => !oldIndex.has(rawKey(item)))
      return feed.length ? [{...page, feed}] : []
    })
    if (prefix.length) {
      staged = {
        pages: [...prefix, ...staged.pages],
        pageParams: [
          ...prefix.map((_, index) =>
            index ? {api, cursor: prefix[index - 1].cursor} : undefined,
          ),
          ...staged.pageParams,
        ],
      }
    }
    // A final real head read establishes freshness, including arrivals during paging.
    api = createAPI()
    const verified = await fetchPage(api)
    if (
      verified.feed.length === head.feed.length &&
      verified.feed.every(
        (item, index) => rawKey(item) === rawKey(head.feed[index]),
      )
    )
      return staged
    head = verified
  }
  throw new Error('The feed head kept changing during retrieval; retry')
}

export function persistWindow(
  did: string,
  place: ReadingPlace,
  pages: FeedPageUnselected[],
  identity: ReadingFeed = 'following',
) {
  const feed = pages.flatMap(page => page.feed)
  const index = feed.findIndex(item =>
    [
      rawKey(item),
      ...(item.reply && 'uri' in item.reply.root
        ? [rawKey(item, item.reply.root.uri)]
        : []),
      ...(item.reply && 'uri' in item.reply.parent
        ? [rawKey(item, item.reply.parent.uri)]
        : []),
    ].includes(place.anchor),
  )
  if (index === -1)
    throw new Error('Visible occurrence is not in the active reading window')
  const start = Math.max(0, index - 15)
  saveSnapshot(
    localStorage,
    did,
    {
      place,
      feed: lexToJson(feed.slice(start, start + MAX_OCCURRENCES)) as unknown[],
    },
    identity,
  )
}

/** Recover only an occurrence observed in bounded, current feed history, never a reconstructed repost. */
export async function recoverRemoteWindow(
  did: string,
  client: Client,
  place: ReadingPlace,
  identity: ReadingFeed,
  active: () => boolean,
): Promise<FeedPageUnselected> {
  const api = readingFeedAPI(client, identity)
  let cursor: string | undefined
  for (let i = 0; i < 12; i++) {
    if (!active()) throw new Error('Remote Resume cancelled')
    const page = await api.fetch({cursor, limit: 30})
    if (!active()) throw new Error('Remote Resume cancelled')
    const index = page.feed.findIndex(item =>
      [
        rawKey(item),
        ...(item.reply && 'uri' in item.reply.root
          ? [rawKey(item, item.reply.root.uri)]
          : []),
        ...(item.reply && 'uri' in item.reply.parent
          ? [rawKey(item, item.reply.parent.uri)]
          : []),
      ].includes(place.anchor),
    )
    if (index !== -1) {
      const restored = await restoreWindow(
        did,
        client,
        {place, feed: lexToJson(page.feed) as unknown[]},
        identity,
      )
      if (!active() || !restored) throw new Error('Remote Resume cancelled')
      return restored
    }
    if (!page.cursor || page.cursor === cursor) break
    cursor = page.cursor
  }
  throw new Error(
    'Saved occurrence is outside the bounded current history or unavailable under current moderation. Your local place and Return are preserved; retry or keep your place.',
  )
}

/** Revalidate every saved post and reply context through the active, labeler-configured appview. */
export async function restoreWindow(
  did: string,
  client: Client,
  checkpoint?: ReadingSnapshot,
  identity: ReadingFeed = 'following',
): Promise<FeedPageUnselected | undefined> {
  const snapshot = checkpoint ?? readSnapshot(localStorage, did, identity)
  if (!snapshot) return
  const saved = snapshot.feed.map(value =>
    bsky.parse(app.bsky.feed.defs.feedViewPost, jsonToLex(value as JsonValue), {
      strict: false,
    }),
  )
  const uris = [
    ...new Set(
      saved.flatMap(item => [
        item.post.uri,
        ...(item.reply && 'uri' in item.reply.root
          ? [item.reply.root.uri]
          : []),
        ...(item.reply && 'uri' in item.reply.parent
          ? [item.reply.parent.uri]
          : []),
      ]),
    ),
  ]
  const posts: app.bsky.feed.defs.PostView[] = []
  for (let i = 0; i < uris.length; i += 25) {
    const response = await client.call(app.bsky.feed.getPosts, {
      uris: uris.slice(i, i + 25),
    })
    posts.push(...response.posts)
  }
  const current = new Map(posts.map(post => [post.uri, post]))
  const feed = saved.flatMap<app.bsky.feed.defs.FeedViewPost>(item => {
    const post = current.get(item.post.uri)
    if (!post) return []
    const reply = item.reply
    if (!reply) return [{...item, post}]
    const root = 'uri' in reply.root ? current.get(reply.root.uri) : undefined
    const parent =
      'uri' in reply.parent ? current.get(reply.parent.uri) : undefined
    return [
      {
        ...item,
        post,
        reply: {
          ...reply,
          root: root
            ? {...root, $type: 'app.bsky.feed.defs#postView'}
            : {
                $type: 'app.bsky.feed.defs#notFoundPost',
                uri: 'uri' in reply.root ? reply.root.uri : post.uri,
                notFound: true,
              },
          parent: parent
            ? {...parent, $type: 'app.bsky.feed.defs#postView'}
            : {
                $type: 'app.bsky.feed.defs#notFoundPost',
                uri: 'uri' in reply.parent ? reply.parent.uri : post.uri,
                notFound: true,
              },
        },
      },
    ]
  })
  const api = readingFeedAPI(client, identity)
  /* A cursor is not a reading identity. Search a bounded current history to establish pagination. */
  let cursor: string | undefined
  let found = false
  for (let i = 0; i < 4; i++) {
    const page = await api.fetch({cursor, limit: 30})
    cursor = page.cursor
    if (page.feed.some(item => item.post.uri === saved.at(-1)?.post.uri)) {
      found = true
      break
    }
    if (!cursor) break
  }
  if (!found)
    logger.info(
      'SkyAnchor restored bounded cache without a contiguous history cursor',
    )
  return {api, feed, cursor: found ? cursor : undefined, fetchedAt: Date.now()}
}
