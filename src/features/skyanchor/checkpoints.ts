import {type ReadingFeed, type ReadingPlace, validPlace} from './domain'

export const MAX_SYNC_DEVICES = 32
export const MAX_DEVICE_SAVES = 3
export const DEVICE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function normalizedDeviceName(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  if (/[\p{C}\p{Zl}\p{Zp}<>]/u.test(value)) return
  const name = value.normalize('NFC').trim()
  if (
    !name ||
    [...name].length > 64 ||
    new TextEncoder().encode(name).byteLength > 256
  )
    return
  return name
}

export function defaultDeviceName(device: string, userAgent = '') {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Version\/.*Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser'
  const platform = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Macintosh/.test(userAgent)
            ? 'Mac'
            : ''
  return `${browser}${platform ? ' on ' + platform : ''} - ${device.slice(0, 4)}`
}

export type SavedDevice = {
  device: string
  label: string
  updated: number
  lastSaved: number | null
  count: number
}
export type SavedCheckpoint = {
  revision: number
  state: ReadingPlace
  updated: number
}
export type DeviceList = {
  did: string
  feed: ReadingFeed
  devices: SavedDevice[]
}
export type DeviceHistory = {
  did: string
  feed: ReadingFeed
  device: string
  saves: SavedCheckpoint[]
}
const time = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8_640_000_000_000_000
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export function validDeviceList(
  value: unknown,
  did: string,
  feed: ReadingFeed,
): value is DeviceList {
  return (
    object(value) &&
    value.did === did &&
    value.feed === feed &&
    Array.isArray(value.devices) &&
    value.devices.length <= MAX_SYNC_DEVICES &&
    new Set(value.devices.map(item => object(item) && item.device)).size ===
      value.devices.length &&
    value.devices.every(
      item =>
        object(item) &&
        typeof item.device === 'string' &&
        DEVICE_UUID.test(item.device) &&
        typeof item.label === 'string' &&
        normalizedDeviceName(item.label) === item.label &&
        time(item.updated) &&
        (item.lastSaved === null ||
          (time(item.lastSaved) && item.lastSaved > 0)) &&
        Number.isSafeInteger(item.count) &&
        typeof item.count === 'number' &&
        item.count >= 0 &&
        item.count <= MAX_DEVICE_SAVES &&
        (item.count === 0) === (item.lastSaved === null),
    )
  )
}
export function validDeviceHistory(
  value: unknown,
  did: string,
  feed: ReadingFeed,
  device: string,
): value is DeviceHistory {
  if (
    !object(value) ||
    value.did !== did ||
    value.feed !== feed ||
    value.device !== device ||
    !Array.isArray(value.saves) ||
    value.saves.length > MAX_DEVICE_SAVES
  )
    return false
  const saves: unknown[] = value.saves
  return saves.every((item, index) => {
    const previous = saves[index - 1]
    return (
      object(item) &&
      typeof item.revision === 'number' &&
      Number.isSafeInteger(item.revision) &&
      item.revision > 0 &&
      (index === 0 ||
        (object(previous) &&
          typeof previous.revision === 'number' &&
          previous.revision > item.revision)) &&
      time(item.updated) &&
      item.updated > 0 &&
      validPlace(item.state)
    )
  })
}

export async function boundedSyncJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maxBytes)
    throw new Error('Private sync response exceeds bound')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Private sync response is empty')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const {value, done} = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      throw new Error('Private sync response exceeds bound')
    }
    chunks.push(value)
  }
  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(
    new TextDecoder('utf-8', {fatal: true}).decode(data),
  ) as unknown
}
