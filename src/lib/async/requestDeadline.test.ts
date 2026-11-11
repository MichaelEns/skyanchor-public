import {
  createRequestDeadline,
  RequestTimeoutError,
  withRequestDeadline,
} from './requestDeadline'

afterEach(() => {
  jest.useRealTimers()
})

it('aborts the owning request and rejects a timeout rather than returning success', async () => {
  jest.useFakeTimers()
  let signal!: AbortSignal
  const task = withRequestDeadline('fixture', 100, current => {
    signal = current
    return new Promise((_, reject) => {
      current.addEventListener('abort', () => reject(new Error('aborted')))
    })
  })
  const rejected = expect(task).rejects.toBeInstanceOf(RequestTimeoutError)
  await jest.advanceTimersByTimeAsync(100)
  await rejected
  expect(signal.aborted).toBe(true)
  expect(jest.getTimerCount()).toBe(0)
})

it('reconciles elapsed wall time even if the timer never ran while hidden', () => {
  jest.useFakeTimers()
  const deadline = createRequestDeadline('fixture', 100)
  jest.setSystemTime(Date.now() + 1000)
  expect(() => deadline.throwIfAborted()).toThrow(RequestTimeoutError)
  expect(deadline.signal.aborted).toBe(true)
  deadline.dispose()
  expect(jest.getTimerCount()).toBe(0)
})

it('cancels superseded work and removes timers after success or failure', async () => {
  jest.useFakeTimers()
  const parent = new AbortController()
  parent.abort()
  const run = jest.fn()
  await expect(
    withRequestDeadline('fixture', 100, run, [parent.signal]),
  ).rejects.toBeDefined()
  expect(run).not.toHaveBeenCalled()
  await expect(
    withRequestDeadline('fixture', 100, () => Promise.resolve('ok')),
  ).resolves.toBe('ok')
  await expect(
    withRequestDeadline('fixture', 100, () =>
      Promise.reject(new Error('fixture failure')),
    ),
  ).rejects.toThrow('fixture failure')
  expect(jest.getTimerCount()).toBe(0)
})
