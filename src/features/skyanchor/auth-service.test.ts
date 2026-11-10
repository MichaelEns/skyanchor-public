import {authenticateSyncAccount} from './auth-service'

const account = {
  did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
  service: 'https://shimeji.us-east.host.bsky.network',
  accessJwt: 'expired-fixture-access',
  refreshJwt: 'fixture-refresh',
}
const fresh = {...account, accessJwt: 'rotated-fixture-access'}

it('rotates a rejected regional token once and sends the returned live snapshot, not the old prop', async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce(new Response('{}', {status: 401}))
    .mockResolvedValueOnce(new Response('{}'))
  const refresh = jest.fn().mockResolvedValue(fresh)
  expect(
    (
      await authenticateSyncAccount({
        account,
        active: () => true,
        request,
        refresh,
      })
    ).status,
  ).toBe(200)
  expect(request).toHaveBeenNthCalledWith(1, account)
  expect(request).toHaveBeenNthCalledWith(2, fresh)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('refreshes a missing access token before sending any bearer', async () => {
  const request = jest.fn().mockResolvedValue(new Response('{}'))
  const refresh = jest.fn().mockResolvedValue(fresh)
  await authenticateSyncAccount({
    account: {...account, accessJwt: undefined},
    active: () => true,
    request,
    refresh,
  })
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith(fresh)
})

it('stops after one verified retry instead of looping on rejected credentials', async () => {
  const request = jest.fn().mockResolvedValue(new Response('{}', {status: 401}))
  const refresh = jest.fn().mockResolvedValue(fresh)
  expect(
    (
      await authenticateSyncAccount({
        account,
        active: () => true,
        request,
        refresh,
      })
    ).status,
  ).toBe(401)
  expect(request).toHaveBeenCalledTimes(2)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it.each([
  {...account, service: 'https://custom.example.test'},
  {...account, accessJwt: undefined, refreshJwt: undefined},
])('does not send unsupported or missing credentials', async input => {
  const request = jest.fn()
  const refresh = jest.fn()
  await expect(
    authenticateSyncAccount({
      account: input,
      active: () => true,
      request,
      refresh,
    }),
  ).rejects.toThrow()
  expect(request).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
})

it('discards delayed rotation after account/feed cancellation before sending a new bearer', async () => {
  let active = true
  const request = jest.fn().mockResolvedValue(new Response('{}', {status: 401}))
  const refresh = jest.fn(() => {
    active = false
    return Promise.resolve(fresh)
  })
  await expect(
    authenticateSyncAccount({account, active: () => active, request, refresh}),
  ).rejects.toThrow('account-changed')
  expect(request).toHaveBeenCalledTimes(1)
})

it('rejects a wrong-account or unsupported-service rotation without sending it', async () => {
  for (const updated of [
    {...fresh, did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'},
    {...fresh, service: 'https://custom.example.test'},
  ]) {
    const request = jest
      .fn()
      .mockResolvedValue(new Response('{}', {status: 401}))
    const refresh = jest.fn().mockResolvedValue(updated)
    await expect(
      authenticateSyncAccount({account, active: () => true, request, refresh}),
    ).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  }
})

it('leaves network errors explicit and does not rotate or retry a network failure', async () => {
  const request = jest.fn().mockRejectedValue(new Error('offline'))
  const refresh = jest.fn()
  await expect(
    authenticateSyncAccount({account, active: () => true, request, refresh}),
  ).rejects.toThrow('offline')
  expect(refresh).not.toHaveBeenCalled()
  expect(request).toHaveBeenCalledTimes(1)
})
