import assert from 'node:assert/strict'
import fs from 'node:fs'
import {test} from 'node:test'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

function readingFixture({
  naturalHeader = false,
  missing = false,
  saveFailure = false,
} = {}) {
  const frames = []
  const events = new Map()
  const saved = []
  const dispatched = []
  const cleanups = []
  const refs = []
  let refIndex = 0
  let rowTop = 5
  let epoch = 0
  let headerBottom = naturalHeader ? 347 : 143
  const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
  const window = {
    scrollY: 1000,
    innerHeight: 844,
    visualViewport: {offsetTop: 0, height: 844},
    scrollBy({top}) {
      this.scrollY += top
      rowTop -= top
      if (naturalHeader) headerBottom = 47
    },
    addEventListener(name, callback) {
      events.set(name, callback)
    },
    removeEventListener() {},
    dispatchEvent(event) {
      dispatched.push(event.detail)
    },
  }
  const node = {
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({top: rowTop, bottom: rowTop + 131}),
    getAttribute: () => 'target',
    closest(selector) {
      if (selector === '[data-skyanchor-account]')
        return {getAttribute: () => owner}
      if (selector === '[data-skyanchor-feed]')
        return {getAttribute: () => 'following', closest: () => null}
      return null
    },
  }
  const exports = {}
  const noop = () => {}
  class FixtureEvent {
    constructor(name, options) {
      this.detail = options ? options.detail : name
    }
  }
  runInNewContext(
    ts.transpileModule(
      fs.readFileSync('src/features/skyanchor/useReadingPlace.web.ts', 'utf8'),
      {compilerOptions: {module: ts.ModuleKind.CommonJS}},
    ).outputText,
    {
      exports,
      window,
      localStorage: {},
      CSS: {escape: value => value},
      document: {
        documentElement: {scrollHeight: 10000, clientHeight: 844},
        querySelector(selector) {
          return selector.includes('mobileHomeHeader')
            ? {
                getClientRects: () => [{}],
                getBoundingClientRect: () => ({bottom: headerBottom}),
              }
            : {
                querySelectorAll: () => (missing ? [] : [node]),
                contains: target => target === node,
              }
        },
        fonts: {ready: {then: noop}},
        addEventListener: noop,
        removeEventListener: noop,
      },
      requestAnimationFrame(callback) {
        frames.push(callback)
        return frames.length
      },
      cancelAnimationFrame: noop,
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
      CustomEvent: FixtureEvent,
      Node: Object,
      require(name) {
        if (name === 'react')
          return {
            useRef: current =>
              refs[refIndex++] ?? (refs[refIndex - 1] = {current}),
            useState: initial => [initial, noop],
            useEffect: effect => {
              const cleanup = effect()
              if (cleanup) cleanups.push(cleanup)
            },
            useLayoutEffect: effect => effect(),
          }
        if (name === '@lingui/react/macro')
          return {useLingui: () => ({t: strings => strings[0]})}
        if (name === '@react-navigation/native')
          return {useRoute: () => ({key: 'home-entry'})}
        if (name === 'react-dom') return {flushSync: action => action()}
        if (name === '#/logger')
          return {
            logger: {
              error() {},
            },
          }
        assert.equal(name, './domain')
        return {
          chooseAnchor: place => ({key: place.anchor, fallback: false}),
          ReadingCapacityError: class extends Error {},
          readingEpoch: () => epoch,
          readSnapshot: () => undefined,
        }
      },
    },
  )
  const options = {
    did: owner,
    scope: 'home',
    enabled: true,
    headerOffset: 95,
    keys: ['target'],
    save: place => {
      if (saveFailure) throw new Error('Fixture quota failure')
      saved.push(JSON.parse(JSON.stringify(place)))
    },
  }
  const hook = exports.useReadingPlace(options)
  return {
    hook,
    events,
    frames,
    saved,
    dispatched,
    get rowTop() {
      return rowTop
    },
    flush() {
      let count = 0
      while (frames.length) {
        assert.ok(++count < 200)
        frames.shift()()
      }
    },
    expire() {
      epoch++
    },
    render() {
      missing = false
    },
    move(top) {
      rowTop = top
    },
    depart(inside = true) {
      events.get('skyanchor-before-navigation')(
        new FixtureEvent({target: inside ? node : {}}),
      )
    },
    focusAgain(overrides = {}) {
      refIndex = 0
      exports.useReadingPlace({...options, enabled: false})
      refIndex = 0
      return exports.useReadingPlace({...options, ...overrides})
    },
    restoreEntry(routeKey = 'home-entry') {
      const detail = {routeKey, handled: false}
      events.get('skyanchor-restore-navigation')(new FixtureEvent(detail))
      return detail.handled
    },
    cleanup() {
      for (const cleanup of cleanups) cleanup()
    },
  }
}

const targetPlace = {version: 1, anchor: 'target', offset: -42, neighbors: []}

test('Immediate departure snapshot observes the current DOM before queued scroll capture, without saving progress', () => {
  const fixture = readingFixture()
  fixture.move(105)
  fixture.events.get('scroll')()
  fixture.move(45)
  const immediate = fixture.hook.snapshot()
  assert.equal(immediate.offset, -98)
  assert.deepEqual(fixture.saved, [])
})

test('Passive captures stay local; a wheel-owned reading scroll carries sharing intent', () => {
  const fixture = readingFixture()
  fixture.move(45)
  fixture.hook.capture()
  assert.equal(fixture.dispatched.at(-1).intentional, false)
  fixture.move(20)
  fixture.events.get('wheel')()
  fixture.events.get('scroll')()
  fixture.flush()
  assert.equal(fixture.dispatched.at(-1).intentional, true)
})

test('Successful explicit adoption invalidates an older departure for this entry', async () => {
  const fixture = readingFixture()
  fixture.depart()
  // Re-enter before adopting, then leave a stale departure in the route cache.
  fixture.focusAgain()
  fixture.depart()
  fixture.events.get('wheel')()
  const completion = fixture.hook.setTarget(targetPlace, true)
  fixture.flush()
  await completion
  fixture.move(500)
  fixture.focusAgain()
  assert.equal(fixture.rowTop, 101)
})

test('Actual source activation freezes capture until route-entry focus restores its immediate anchor; unrelated targets and owners cannot adopt it', () => {
  const fixture = readingFixture()
  fixture.move(45)
  fixture.depart()
  fixture.move(500)
  fixture.events.get('scroll')()
  fixture.flush()
  assert.deepEqual(
    fixture.saved,
    [],
    'Destination scroll must never enter source progress',
  )
  fixture.focusAgain()
  fixture.flush()
  assert.equal(fixture.rowTop, 45)
  assert.equal(
    fixture.restoreEntry(),
    true,
    'Semantic restoration must suppress the route pixel restorer',
  )
  assert.equal(fixture.restoreEntry('another-route'), false)

  const outside = readingFixture()
  outside.move(45)
  outside.depart(false)
  outside.move(500)
  outside.focusAgain()
  assert.equal(
    outside.rowTop,
    500,
    'Sidebar activation is not a source post departure',
  )
  const changedOwner = readingFixture()
  changedOwner.move(45)
  changedOwner.depart()
  changedOwner.move(500)
  changedOwner.focusAgain({did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'})
  assert.equal(changedOwner.rowTop, 500)
})

test('Explicit reading Resume saves its verified target without relying on a delayed programmatic scroll event', async () => {
  const {hook, events, frames, saved, flush} = readingFixture()
  const completion = hook.setTarget(targetPlace)
  events.get('scroll')()
  assert.equal(frames.length, 1, 'Explicit switching is not a user pan')
  frames.shift()()
  assert.equal(
    saved.length,
    0,
    'First correction is not placement confirmation',
  )
  flush()
  await completion
  assert.deepEqual(saved, [
    {version: 1, anchor: 'target', offset: -42, neighbors: []},
  ])
  events.get('scroll')()
  assert.equal(frames.length, 0)
  assert.equal(saved.length, 1)
})

test('Return remeasures natural-to-sticky geometry and saves only after stable placement', async () => {
  const fixture = readingFixture({naturalHeader: true})
  const completion = fixture.hook.setTarget(targetPlace)
  fixture.frames.shift()()
  assert.equal(
    fixture.rowTop,
    305,
    'One-pass restore has the exact 300px header-transition error',
  )
  assert.equal(fixture.saved.length, 0)
  fixture.flush()
  await completion
  assert.equal(fixture.rowTop, 5)
  assert.deepEqual(fixture.saved, [targetPlace])
})

test('A newer explicit target cancels older queued restoration without stale writes', async () => {
  const fixture = readingFixture()
  const older = assert.rejects(fixture.hook.setTarget(targetPlace), /cancelled/)
  const newerPlace = {...targetPlace, offset: -20}
  const newer = fixture.hook.setTarget(newerPlace)
  fixture.flush()
  await older
  await newer
  assert.deepEqual(fixture.saved, [newerPlace])
})

test('Finger pan, account epoch change and unmount cancel settlement before saving', async () => {
  for (const cancel of [
    fixture => fixture.events.get('touchstart')(),
    fixture => fixture.expire(),
    fixture => fixture.cleanup(),
  ]) {
    const fixture = readingFixture()
    const rejected = assert.rejects(
      fixture.hook.setTarget(targetPlace),
      /cancelled/,
    )
    cancel(fixture)
    fixture.flush()
    await rejected
    assert.deepEqual(fixture.saved, [])
  }
})

test('Missing delayed DOM has a bounded explicit failure rather than consuming a checkpoint', async () => {
  const fixture = readingFixture({missing: true})
  const rejected = assert.rejects(
    fixture.hook.setTarget(targetPlace),
    /did not settle/,
  )
  fixture.flush()
  await rejected
  assert.deepEqual(fixture.saved, [])
})

test('Delayed row rendering remains pending and is corrected before adoption', async () => {
  const fixture = readingFixture({missing: true, naturalHeader: true})
  const completion = fixture.hook.setTarget(targetPlace)
  fixture.frames.shift()()
  fixture.frames.shift()()
  assert.deepEqual(fixture.saved, [])
  fixture.render()
  fixture.flush()
  await completion
  assert.equal(fixture.rowTop, 5)
  assert.deepEqual(fixture.saved, [targetPlace])
})

test('A storage failure rejects confirmed restoration instead of reporting adopted state', async () => {
  const fixture = readingFixture({saveFailure: true})
  const rejected = assert.rejects(
    fixture.hook.setTarget(targetPlace),
    /could not be saved/,
  )
  fixture.flush()
  await rejected
  assert.deepEqual(fixture.saved, [])
})

test('Web viewport lifecycle batches events, reconciles foreground, and cleans every listener/frame/style without scrolling', () => {
  const target = () => {
    const listeners = new Map()
    return {
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type).add(listener)
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener)
      },
      fire(type) {
        for (const listener of listeners.get(type) ?? []) listener()
      },
      count() {
        return [...listeners.values()].reduce(
          (sum, entries) => sum + entries.size,
          0,
        )
      },
    }
  }
  const viewport = Object.assign(target(), {
    height: 844,
    offsetTop: 0,
    scale: 1,
  })
  const window = Object.assign(target(), {visualViewport: viewport})
  const values = new Map()
  const document = Object.assign(target(), {
    activeElement: null,
    documentElement: {
      clientHeight: 844,
      style: {
        setProperty(name, value) {
          values.set(name, value)
        },
        removeProperty(name) {
          values.delete(name)
        },
      },
    },
  })
  const frames = new Map()
  let nextFrame = 0
  let cleanup
  const exports = {}
  runInNewContext(
    ts.transpileModule(
      fs.readFileSync('src/lib/hooks/useWebViewport.web.ts', 'utf8'),
      {compilerOptions: {module: ts.ModuleKind.CommonJS}},
    ).outputText,
    {
      exports,
      window,
      document,
      HTMLElement: class {},
      requestAnimationFrame(callback) {
        frames.set(++nextFrame, callback)
        return nextFrame
      },
      cancelAnimationFrame(id) {
        frames.delete(id)
      },
      require(name) {
        if (name === 'react')
          return {
            useEffect(effect) {
              cleanup = effect()
            },
          }
        assert.equal(name, '#/logger')
        return {
          logger: {
            error() {
              assert.fail('Valid geometry must not log errors')
            },
          },
        }
      },
    },
  )
  exports.useWebViewport()
  assert.equal(values.get('--skyanchor-viewport-bottom'), '0px')
  Object.assign(viewport, {height: 914, offsetTop: 20})
  viewport.fire('resize')
  viewport.fire('scroll')
  document.fire('visibilitychange')
  assert.equal(frames.size, 1)
  const flush = () => {
    for (const [id, callback] of frames) {
      frames.delete(id)
      callback()
    }
  }
  flush()
  assert.equal(values.get('--skyanchor-viewport-top'), '20px')
  assert.equal(values.get('--skyanchor-viewport-bottom'), '-90px')
  viewport.height = 700
  window.fire('pageshow')
  flush()
  assert.equal(values.get('--skyanchor-viewport-bottom'), '124px')
  window.fire('resize')
  cleanup()
  assert.equal(frames.size, 0)
  assert.equal(values.size, 0)
  assert.equal(viewport.count() + window.count() + document.count(), 0)
})
