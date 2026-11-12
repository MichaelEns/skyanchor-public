export type ReadingPlace = {
  version: 1
  anchor: string
  offset: number
  neighbors: string[]
}

export function sameReadingPlace(
  left: ReadingPlace | null | undefined,
  right: ReadingPlace | null | undefined,
) {
  return (
    !!left &&
    !!right &&
    left.anchor === right.anchor &&
    Math.abs(left.offset - right.offset) <= 0.25
  )
}

export type ResumeOptions = {
  signal: AbortSignal
  verify?: () => Promise<void>
  progress: (
    pages: number,
    phase?: 'history' | 'revalidate' | 'placement',
  ) => void
}

export type ReadingFeed =
  | 'following'
  | `author|${string}|posts_and_author_threads`
  | `author|${string}|posts_with_replies`
  | `author|${string}|posts_with_media`
export const MAX_READING_FEEDS = 64
export class ReadingCapacityError extends Error {}
export function validReadingFeed(value: unknown): value is ReadingFeed {
  return (
    value === 'following' ||
    (typeof value === 'string' &&
      value.length <= 256 &&
      /^author\|(?:did:plc:[a-z2-7]{24}|did:web:[a-zA-Z0-9.:%_-]{1,180})\|(posts_and_author_threads|posts_with_replies|posts_with_media)$/.test(
        value,
      ))
  )
}
export function readingStorageKey(
  prefix: string,
  did: string,
  feed: ReadingFeed = 'following',
) {
  if (!validReadingFeed(feed)) throw new Error('Invalid semantic reading feed')
  return prefix + did + (feed === 'following' ? '' : ':' + feed)
}

const accountEpochs = new Map<string, number>()
export function readingEpoch(did: string) {
  return accountEpochs.get(did) ?? 0
}
export function invalidateReadingAccount(did: string) {
  accountEpochs.set(did, readingEpoch(did) + 1)
}

const DID_PATTERN = 'did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9.:%_-]+)'
const POST_PATTERN = `at://${DID_PATTERN}/app\\.bsky\\.feed\\.post/[a-zA-Z0-9._~:-]{1,128}`
const OCCURRENCE = new RegExp(
  `^${POST_PATTERN}\\|repost:(?:-|${DID_PATTERN}:\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z)\\|reply:(?:-|${POST_PATTERN}:${POST_PATTERN})\\|context:${POST_PATTERN}$`,
)

export function validOccurrence(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= 2048 && OCCURRENCE.test(value)
  )
}

export type SyncPlace = {
  did: string
  feed?: ReadingFeed
  revision: number
  device: string | null
  state: ReadingPlace | null
  updated?: number | null
}
export function validSyncPlace(
  value: unknown,
  did: string,
  feed: ReadingFeed = 'following',
): value is SyncPlace {
  if (!value || typeof value !== 'object') return false
  const remote = value as Record<string, unknown>
  return (
    remote.did === did &&
    (feed === 'following'
      ? remote.feed === undefined || remote.feed === feed
      : remote.feed === feed) &&
    typeof remote.revision === 'number' &&
    Number.isSafeInteger(remote.revision) &&
    remote.revision >= 0 &&
    (remote.device === null || typeof remote.device === 'string') &&
    (remote.updated === undefined ||
      remote.updated === null ||
      (typeof remote.updated === 'number' &&
        Number.isSafeInteger(remote.updated) &&
        remote.updated > 0 &&
        remote.updated <= 8_640_000_000_000_000)) &&
    (remote.state === null || validPlace(remote.state))
  )
}

export function occurrenceKey(
  uri: string,
  repost?: {by: {did: string}; indexedAt: string},
  reply?: {root: {uri: string}; parent: {uri: string}},
  context = uri,
) {
  return `${uri}|repost:${repost ? `${repost.by.did}:${repost.indexedAt}` : '-'}|reply:${reply ? `${reply.root.uri}:${reply.parent.uri}` : '-'}|context:${context}`
}

export function validPlace(value: unknown): value is ReadingPlace {
  if (!value || typeof value !== 'object') return false
  const place = value as Record<string, unknown>
  return (
    Object.keys(place).length === 4 &&
    place.version === 1 &&
    validOccurrence(place.anchor) &&
    typeof place.offset === 'number' &&
    Number.isFinite(place.offset) &&
    Math.abs(place.offset) <= 20_000 &&
    Array.isArray(place.neighbors) &&
    place.neighbors.length <= 8 &&
    place.neighbors.every(validOccurrence)
  )
}

export function chooseAnchor(place: ReadingPlace, keys: string[]) {
  if (keys.includes(place.anchor)) return {key: place.anchor, fallback: false}
  const neighbor = place.neighbors.find(key => keys.includes(key))
  return {key: neighbor, fallback: true}
}

export const STORAGE_PREFIX = 'skyanchor:following:v1:'
export const RETURN_PREFIX = 'skyanchor:return:v1:'
export const MAX_SNAPSHOT_BYTES = 1_048_576
export const MAX_OCCURRENCES = 90

export type ReadingSnapshot = {place: ReadingPlace; feed: unknown[]}

export function readSnapshot(
  storage: {getItem(key: string): string | null},
  did: string,
  feed: ReadingFeed = 'following',
): ReadingSnapshot | undefined {
  const text = storage.getItem(readingStorageKey(STORAGE_PREFIX, did, feed))
  if (!text) return
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES)
    throw new Error('Saved reading cache exceeds bound')
  const value: unknown = JSON.parse(text)
  if (
    !value ||
    typeof value !== 'object' ||
    !('place' in value) ||
    !validPlace(value.place) ||
    !('feed' in value) ||
    !Array.isArray(value.feed) ||
    value.feed.length > MAX_OCCURRENCES
  ) {
    throw new Error('Saved reading cache is invalid')
  }
  return {place: value.place, feed: value.feed}
}

export function saveSnapshot(
  storage: {
    setItem(key: string, value: string): void
    getItem?(key: string): string | null
    length?: number
    key?(index: number): string | null
  },
  did: string,
  snapshot: ReadingSnapshot,
  feed: ReadingFeed = 'following',
) {
  if (
    feed !== 'following' &&
    storage.getItem &&
    storage.key &&
    storage.length !== undefined &&
    !storage.getItem(readingStorageKey(STORAGE_PREFIX, did, feed))
  ) {
    let count = 0
    for (let i = 0; i < storage.length; i++)
      if (storage.key(i)?.startsWith(STORAGE_PREFIX + did + ':author|')) count++
    if (count >= MAX_READING_FEEDS)
      throw new ReadingCapacityError(
        'Local profile reading-place capacity reached (64 filters); existing places were not evicted',
      )
  }
  if (!validPlace(snapshot.place) || snapshot.feed.length > MAX_OCCURRENCES)
    throw new Error('Invalid reading snapshot')
  const text = JSON.stringify(snapshot)
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES)
    throw new Error('Reading cache exceeds bound')
  storage.setItem(readingStorageKey(STORAGE_PREFIX, did, feed), text)
}

export function readReturnCheckpoint(
  storage: {getItem(key: string): string | null},
  did: string,
  feed: ReadingFeed = 'following',
): ReadingSnapshot | undefined {
  const text = storage.getItem(readingStorageKey(RETURN_PREFIX, did, feed))
  if (!text) return
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES + 64)
    throw new Error('Return checkpoint exceeds bound')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object')
    throw new Error('Invalid return checkpoint')
  const snapshot =
    'version' in value
      ? value.version === 1 && 'snapshot' in value
        ? value.snapshot
        : undefined
      : value
  if (!snapshot) throw new Error('Unsupported return checkpoint version')
  return readSnapshot({getItem: () => JSON.stringify(snapshot)}, did)
}

export function saveReturnCheckpoint(
  storage: {setItem(key: string, value: string): void},
  did: string,
  snapshot: ReadingSnapshot,
  feed: ReadingFeed = 'following',
) {
  saveSnapshot(
    {
      setItem: (_key, text) =>
        storage.setItem(
          readingStorageKey(RETURN_PREFIX, did, feed),
          JSON.stringify({version: 1, snapshot: JSON.parse(text)}),
        ),
    },
    did,
    snapshot,
  )
}
