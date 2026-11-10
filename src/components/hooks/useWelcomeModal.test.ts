import {act, renderHook} from '@testing-library/react-native'

import {useWelcomeModal} from './useWelcomeModal.ts'

let mockHasSession = false
let mockShowLoggedOut = false
jest.mock('#/state/session', () => ({
  useSession: () => ({hasSession: mockHasSession}),
}))
jest.mock('#/state/shell/logged-out', () => ({
  useLoggedOutView: () => ({showLoggedOut: mockShowLoggedOut}),
}))
jest.mock('#/env', () => ({IS_WEB: true}))

const location = {pathname: '/'}
const storage = new Map<string, string>()
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
)

beforeEach(() => {
  jest.useFakeTimers()
  mockHasSession = false
  mockShowLoggedOut = false
  location.pathname = '/'
  storage.clear()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {location},
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
})

afterEach(() => {
  jest.useRealTimers()
  if (originalWindow)
    Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalStorage)
    Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

it('keeps the ordinary one-second home presentation and once-shown preference', () => {
  const {result, unmount} = renderHook(useWelcomeModal)
  act(() => jest.advanceTimersByTime(999))
  expect(result.current.isOpen).toBe(false)
  act(() => jest.advanceTimersByTime(1))
  expect(result.current.isOpen).toBe(true)
  unmount()
  const next = renderHook(useWelcomeModal)
  act(() => jest.advanceTimersByTime(1000))
  expect(next.result.current.isOpen).toBe(false)
})

it.each(['login', 'session'] as const)(
  'cancels pending presentation on %s entry before authentication completes',
  state => {
    const {result, rerender} = renderHook(useWelcomeModal)
    act(() => jest.advanceTimersByTime(500))
    if (state === 'login') mockShowLoggedOut = true
    else mockHasSession = true
    rerender({})
    act(() => jest.advanceTimersByTime(1000))
    expect(result.current.isOpen).toBe(false)
    expect(jest.getTimerCount()).toBe(0)
  },
)

it('manual close cancels a pending timer without disabling manual open', () => {
  const {result} = renderHook(useWelcomeModal)
  act(() => result.current.close())
  act(() => jest.advanceTimersByTime(1000))
  expect(result.current.isOpen).toBe(false)
  act(() => result.current.open())
  expect(result.current.isOpen).toBe(true)
})

it('checks the current pathname at fire time even without a React rerender', () => {
  const {result} = renderHook(useWelcomeModal)
  location.pathname = '/profile/reader.test'
  act(() => jest.advanceTimersByTime(1000))
  expect(result.current.isOpen).toBe(false)
})

it('does not schedule in auth UI or away from home and cleans up on unmount', () => {
  mockShowLoggedOut = true
  const auth = renderHook(useWelcomeModal)
  expect(jest.getTimerCount()).toBe(0)
  auth.unmount()
  mockShowLoggedOut = false
  location.pathname = '/profile/reader.test'
  const away = renderHook(useWelcomeModal)
  expect(jest.getTimerCount()).toBe(0)
  away.unmount()
  location.pathname = '/'
  const home = renderHook(useWelcomeModal)
  expect(jest.getTimerCount()).toBe(1)
  home.unmount()
  expect(jest.getTimerCount()).toBe(0)
})
