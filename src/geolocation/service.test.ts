jest.mock('#/env', () => ({
  IS_WEB: true,
  GEOLOCATION_URL: 'https://geo.example.test',
}))
jest.mock('#/geolocation/debug', () => ({enabled: false}))
jest.mock('#/geolocation/logger', () => ({
  logger: {debug: jest.fn(), info: jest.fn()},
}))
const mockValues = new Map<string, unknown>()
const mockSet = jest.fn((keys: string[], value: unknown) =>
  mockValues.set(keys[0], value),
)
jest.mock('#/storage', () => ({
  device: {
    get: (keys: string[]) => mockValues.get(keys[0]),
    set: (keys: string[], value: unknown) => mockSet(keys, value),
  },
}))

import {resolve} from './service'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  mockValues.clear()
  mockSet.mockClear()
  jest.useRealTimers()
})

it('bounds first and duplicate uncached resolution, aborts, preserves UNKNOWN, and can retry', async () => {
  jest.useFakeTimers()
  let signal!: AbortSignal
  global.fetch = jest.fn((_url, init) => {
    signal = init!.signal!
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
  })
  const first = resolve()
  const duplicate = resolve()
  await jest.advanceTimersByTimeAsync(3000)
  await Promise.all([first, duplicate])
  expect(signal.aborted).toBe(true)
  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect(mockSet).not.toHaveBeenCalled()
  expect(mockValues.get('geolocationServiceResponse')).toBeUndefined()
  global.fetch = jest.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({countryCode: 'CA', regionCode: 'ON'})),
    ),
  )
  await resolve()
  expect(mockValues.get('geolocationServiceResponse')).toEqual({
    countryCode: 'CA',
    regionCode: 'ON',
  })
  expect(jest.getTimerCount()).toBe(0)
})

it('uses cached geolocation without waiting for a stalled refresh and never replaces it with a default', async () => {
  jest.useFakeTimers()
  const cached = {countryCode: 'CA', regionCode: 'BC'}
  mockValues.set('geolocationServiceResponse', cached)
  global.fetch = jest.fn(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () =>
          reject(new Error('aborted')),
        )
      }),
  )
  await Promise.all([resolve(), resolve()])
  expect(mockValues.get('geolocationServiceResponse')).toEqual(cached)
  await jest.advanceTimersByTimeAsync(3000)
  expect(mockSet).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toBe(0)
})
