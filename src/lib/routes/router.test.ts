import {logger} from '#/logger'
import {router} from '#/routes'
import {getCurrentRoute} from './helpers'
import {LINKING} from './linking'

jest.mock('#/logger', () => ({logger: {warn: jest.fn()}}))

const did = 'did:plc:qrz3lhbyuxbeilrc6nekdqme'

it.each([did, encodeURIComponent(did)])(
  'parses reported CustomFeed actor %s',
  name => {
    expect(router.matchPath(`/profile/${name}/feed/9889d7c6d1f9`)).toEqual([
      'CustomFeed',
      {name: did, rkey: '9889d7c6d1f9'},
    ])
  },
)

it.each([
  did,
  'did:web:example.test%3A8443:user',
  'Unicode \u00e9 / # + % ?',
  'literal%2Fslash',
])('roundtrips a single dynamic segment exactly once: %s', name => {
  const path = router.matchName('CustomFeed')!.build({name, rkey: 'key/# +%'})
  expect(path).toBe(
    `/profile/${encodeURIComponent(name)}/feed/${encodeURIComponent('key/# +%')}`,
  )
  expect(router.matchPath(path)).toEqual([
    'CustomFeed',
    {name, rkey: 'key/# +%'},
  ])
})

it('decodes queries only through URLSearchParams and retains path collision precedence', () => {
  expect(
    router.matchPath(
      `/profile/${encodeURIComponent(did)}?name=wrong&tab=media&q=%252F%2B+space`,
    ),
  ).toEqual(['Profile', {name: did, tab: 'media', q: '%2F+ space'}])
  expect(
    router
      .matchName('Profile')!
      .build({name: did, tab: 'media', q: '%2F+ space'}),
  ).toBe(`/profile/${encodeURIComponent(did)}?tab=media&q=%252F%2B+space`)
})

it.each(['%', '%ZZ', '%E0%A4', '%FF'])(
  'rejects malformed path %s without an ErrorBoundary or private URL logging',
  segment => {
    jest.mocked(logger.warn).mockClear()
    expect(
      router.matchPath(`/profile/${segment}?private=not-for-logs`),
    ).toEqual(['NotFound', {}])
    expect(logger.warn).toHaveBeenCalledWith(
      'Route path segment has invalid percent encoding',
    )
  },
)

it('retains established falsy placeholder behavior and valid route descriptors', () => {
  expect(router.matchName('Profile')!.build({name: ''})).toBe(
    '/profile/undefined',
  )
  expect(router.matchPath('/messages/conversation-id')).toEqual([
    'MessagesConversation',
    {conversation: 'conversation-id'},
  ])
  expect(router.matchPath('/starter-pack/alice.test/record')).toEqual([
    'StarterPack',
    {name: 'alice.test', rkey: 'record'},
  ])
})

it('native linking preserves decoded feed params, Home back stack, and chat invite routing', () => {
  const state = LINKING.getStateFromPath(
    `/profile/${encodeURIComponent(did)}/feed/9889d7c6d1f9`,
  )
  expect(getCurrentRoute(state)).toMatchObject({
    name: 'CustomFeed',
    params: {name: did, rkey: '9889d7c6d1f9'},
  })
  expect(LINKING.getPathFromState(state!)).toBe(
    `/profile/${encodeURIComponent(did)}/feed/9889d7c6d1f9`,
  )
  const root = state?.routes[0]
  expect(
    root && 'state' in root ? root.state.routes[0] : undefined,
  ).toMatchObject({name: 'Home'})
  expect(
    getCurrentRoute(LINKING.getStateFromPath('chat/abc12345')),
  ).toMatchObject({name: 'Home'})
  expect(
    getCurrentRoute(
      LINKING.getStateFromPath('/profile/alice.test?tab=replies'),
    ),
  ).toMatchObject({
    name: 'Profile',
    params: {name: 'alice.test', tab: 'replies'},
  })
})
