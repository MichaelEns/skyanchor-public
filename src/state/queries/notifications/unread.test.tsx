import {type PropsWithChildren} from 'react'
import {AppState} from 'react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, renderHook} from '@testing-library/react-native'

import {logger} from '#/logger'
import {
  Provider,
  useLastUnreadCheck,
  useUnreadNotifications,
  useUnreadNotificationsApi,
} from './unread'
import {fetchPage} from './util'

jest.mock('#/lib/broadcast', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    postMessage: jest.fn(),
  })),
}))
jest.mock('#/lib/notifications/notifications', () => ({
  resetBadgeCount: jest.fn(),
}))
jest.mock('#/logger', () => ({
  logger: {error: jest.fn(), debug: jest.fn()},
}))
jest.mock('#/state/preferences/moderation-opts', () => ({
  useModerationOpts: () => undefined,
}))
jest.mock('#/state/session', () => ({
  useSession: () => ({hasSession: true}),
  useAppviewClient: () => undefined,
}))
jest.mock('./feed', () => ({RQKEY: (feed: string) => ['notifications', feed]}))
jest.mock('#/state/queries/util', () => ({truncateAndInvalidate: jest.fn()}))
jest.mock('#/state/queries/profile', () => ({precacheProfile: jest.fn()}))
jest.mock('./util', () => ({
  ...jest.requireActual('./util'),
  fetchPage: jest.fn(),
}))

function setup() {
  const client = new QueryClient({
    defaultOptions: {queries: {gcTime: Infinity, retry: false}},
  })
  const wrapper = ({children}: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <Provider>{children}</Provider>
    </QueryClientProvider>
  )
  return renderHook(
    () => ({
      count: useUnreadNotifications(),
      lastCheck: useLastUnreadCheck(),
      api: useUnreadNotificationsApi(),
    }),
    {wrapper},
  )
}

const cachedPage: Awaited<ReturnType<typeof fetchPage>> = {
  page: {
    cursor: undefined,
    seenAt: new Date(),
    items: [
      {
        _reactKey: 'fixture-follow',
        type: 'follow',
        notification: {
          uri: 'at://did:plc:cccccccccccccccccccccccc/app.bsky.graph.follow/fixture',
          cid: 'bafyreibvl6r3wptx7i5u5sclz6u4o3ogltcrtlodzcryvw33llxvmxc3nu',
          author: {
            did: 'did:plc:cccccccccccccccccccccccc',
            handle: 'fixture.test',
          },
          reason: 'follow',
          record: {},
          isRead: false,
          indexedAt: '2026-11-08T12:00:00.000Z',
        },
      },
    ],
  },
  indexedAt: undefined,
}

const initialAppState = AppState.currentState

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  AppState.currentState = 'active'
  jest.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  AppState.currentState = initialAppState
  jest.useRealTimers()
  jest.restoreAllMocks()
})

it('handles an initial offline rejection and recovers on the next background poll', async () => {
  jest.mocked(fetchPage).mockRejectedValueOnce(new Error('Load failed'))
  jest.mocked(fetchPage).mockResolvedValue(cachedPage)
  const hook = setup()
  await act(async () => {})
  expect(hook.result.current.count).toBe('')
  expect(hook.result.current.lastCheck).toBeUndefined()
  expect(logger.error).not.toHaveBeenCalled()
  expect(logger.debug).toHaveBeenCalledWith(
    'Notification background check deferred: transport unavailable',
  )
  await act(() => jest.advanceTimersByTimeAsync(30000))
  expect(fetchPage).toHaveBeenCalledTimes(2)
  expect(hook.result.current.lastCheck).toBeDefined()
})

it('preserves unread count, last check and usable cache across a rejected interval, then recovers', async () => {
  jest.mocked(fetchPage).mockResolvedValue(cachedPage)
  const hook = setup()
  await act(async () => {})
  // An explicitly loaded page is eligible for reuse by the notification screen.
  await act(() => hook.result.current.api.checkUnread({invalidate: true}))
  const lastCheck = hook.result.current.lastCheck
  const count = hook.result.current.count
  expect(count).toBe('1')
  jest.mocked(fetchPage).mockRejectedValueOnce(new Error('Load failed'))
  await act(() => jest.advanceTimersByTimeAsync(30000))
  expect(hook.result.current.lastCheck).toBe(lastCheck)
  expect(hook.result.current.count).toBe(count)
  expect(hook.result.current.api.getCachedUnreadPage()).toBe(cachedPage.page)
  expect(logger.error).not.toHaveBeenCalled()
  await act(() => jest.advanceTimersByTimeAsync(30000))
  expect(hook.result.current.lastCheck).not.toBe(lastCheck)
})

it('reports unexpected background errors but leaves explicit awaited rejection to its caller', async () => {
  const error = new Error('Invalid notification response')
  jest.mocked(fetchPage).mockRejectedValue(error)
  const hook = setup()
  await act(async () => {})
  expect(logger.error).toHaveBeenCalledWith(
    'Notification background check failed',
    {safeMessage: error},
  )
  jest.mocked(logger.error).mockClear()
  await act(async () => {
    await expect(hook.result.current.api.checkUnread()).rejects.toBe(error)
  })
  expect(logger.error).not.toHaveBeenCalled()
  expect(hook.result.current.lastCheck).toBeUndefined()
})
