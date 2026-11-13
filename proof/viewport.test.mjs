import assert from 'node:assert/strict'
import fs from 'node:fs'
import {test} from 'node:test'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

function readingFixture({
  naturalHeader = false,
  missing = false,
  saveFailure = false,
  scrollbarLeft = false,
  horizontalScrollbar = false,
  overlayScrollbar = false,
  initialPlace,
  quantizedScroll = false,
  clampedScroll = false,
} = {}) {
  const frames = []
  let nextFrame = 0
  const cancelledFrames = new Set()
  const events = new Map()
  const saved = []
  const dispatched = []
  const effects = []
  const layoutEffects = []
  let effectIndex = 0
  let layoutIndex = 0
  let pendingEffects = []
  let pendingLayouts = []
  const refs = []
  let refIndex = 0
  let rowTop = 5
  let epoch = 0
  let routeKey = 'home-entry'
  let headerBottom = naturalHeader ? 347 : 143
  const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
  let renderedOwner = owner
  let now = 10000
  let nextTimer = 0
  const timers = new Map()
  const documentRoot = {
    scrollHeight: 10000,
    clientHeight: horizontalScrollbar ? 829 : 844,
    scrollWidth: 2000,
    clientWidth: overlayScrollbar ? 1280 : 1265,
    clientLeft: scrollbarLeft ? 15 : 0,
  }
  const document = {
    documentElement: documentRoot,
    visibilityState: 'visible',
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
    fonts: {ready: {then() {}}},
    addEventListener(name, callback) {
      events.set(name, callback)
    },
    removeEventListener(name, callback) {
      if (events.get(name) === callback) events.delete(name)
    },
  }
  const window = {
    scrollY: 1000,
    innerHeight: 844,
    innerWidth: 1280,
    visualViewport: {offsetTop: 0, height: 844},
    scrollBy({top}) {
      if (quantizedScroll) top = Math.round(this.scrollY + top) - this.scrollY
      if (clampedScroll) top = Math.max(0, top)
      this.scrollY += top
      rowTop -= top
      if (naturalHeader) headerBottom = 47
    },
    addEventListener(name, callback) {
      events.set(name, callback)
    },
    removeEventListener(name, callback) {
      if (events.get(name) === callback) events.delete(name)
    },
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
        return {getAttribute: () => renderedOwner}
      if (selector === '[data-skyanchor-feed]')
        return {getAttribute: () => 'following', closest: () => null}
      return null
    },
  }
  const exports = {}
  const noop = () => {}
  class FixtureElement {
    constructor(interactive = false, editable = false) {
      this.interactive = interactive
      this.isContentEditable = editable
    }
    closest() {
      return this.interactive ? this : null
    }
  }
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
      document,
      Date: class extends Date {
        static now() {
          return now
        }
      },
      setTimeout(callback, delay) {
        const id = ++nextTimer
        timers.set(id, {at: now + delay, callback})
        return id
      },
      clearTimeout: id => timers.delete(id),
      getComputedStyle: () => ({
        borderLeftWidth: '0px',
        borderRightWidth: '0px',
        borderTopWidth: '0px',
        borderBottomWidth: '0px',
      }),
      HTMLElement: FixtureElement,
      requestAnimationFrame(callback) {
        const id = ++nextFrame
        frames.push(() => {
          if (!cancelledFrames.has(id)) callback()
        })
        return id
      },
      cancelAnimationFrame(id) {
        cancelledFrames.add(id)
      },
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
            useEffect: (effect, deps) => {
              const index = effectIndex++
              const previous = effects[index]
              if (
                previous &&
                deps?.every((dep, i) => Object.is(dep, previous.deps?.[i]))
              )
                return
              pendingEffects.push(() => {
                previous?.cleanup?.()
                const cleanup = effect()
                effects[index] = {deps, cleanup}
              })
            },
            useLayoutEffect: (effect, deps) => {
              const index = layoutIndex++
              const previous = layoutEffects[index]
              if (
                previous &&
                deps?.every((dep, i) => Object.is(dep, previous.deps?.[i]))
              )
                return
              pendingLayouts.push(() => {
                previous?.cleanup?.()
                const cleanup = effect()
                layoutEffects[index] = {deps, cleanup}
              })
            },
          }
        if (name === '@lingui/react/macro')
          return {useLingui: () => ({t: strings => strings[0]})}
        if (name === '@react-navigation/native')
          return {useRoute: () => ({key: routeKey})}
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
          readSnapshot: () =>
            initialPlace ? {place: initialPlace} : undefined,
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
  function renderHook(overrides = {}) {
    if (overrides.routeKey) routeKey = overrides.routeKey
    refIndex = 0
    effectIndex = 0
    layoutIndex = 0
    const result = exports.useReadingPlace({...options, ...overrides})
    for (const effect of pendingLayouts) effect()
    pendingLayouts = []
    for (const effect of pendingEffects) effect()
    pendingEffects = []
    return result
  }
  const hook = renderHook()
  return {
    hook,
    events,
    frames,
    saved,
    dispatched,
    keyTarget: (interactive, editable) =>
      new FixtureElement(interactive, editable),
    advance(milliseconds) {
      const end = now + milliseconds
      while (true) {
        const next = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        const [id, timer] = next
        timers.delete(id)
        now = timer.at
        timer.callback()
      }
      now = end
    },
    pointer(x, y, overrides = {}) {
      events.get('pointerdown')({
        pointerType: 'mouse',
        button: 0,
        isPrimary: true,
        pointerId: 7,
        clientX: x,
        clientY: y,
        target: documentRoot,
        ...overrides,
      })
    },
    hidden() {
      document.visibilityState = 'hidden'
      events.get('visibilitychange')()
    },
    scrollEnd(nested = false) {
      events.get('scrollend')({target: nested ? {} : document})
    },
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
    scrollBy(top) {
      window.scrollBy({top})
      events.get('scroll')()
    },
    depart(inside = true) {
      events.get('skyanchor-before-navigation')(
        new FixtureEvent({target: inside ? node : {}}),
      )
    },
    focusAgain(overrides = {}) {
      renderHook({enabled: false})
      return renderHook(overrides)
    },
    disable() {
      return renderHook({enabled: false})
    },
    remount(overrides = {}) {
      for (const effect of layoutEffects) effect.cleanup?.()
      for (const effect of effects) effect.cleanup?.()
      refs.length = 0
      layoutEffects.length = 0
      effects.length = 0
      return renderHook(overrides)
    },
    switchOwner(did) {
      renderedOwner = did
      return renderHook({did})
    },
    restoreEntry(routeKey = 'home-entry') {
      const detail = {routeKey, handled: false}
      events.get('skyanchor-restore-navigation')(new FixtureEvent(detail))
      return detail.handled
    },
    cleanup() {
      for (const effect of layoutEffects) effect.cleanup?.()
      for (const effect of effects) effect.cleanup?.()
    },
  }
}

const targetPlace = {version: 1, anchor: 'target', offset: -42, neighbors: []}

test('Viewport resize drains the queued local reading capture before correcting the previous place', () => {
  for (const owned of [false, true]) {
    const fixture = readingFixture({initialPlace: targetPlace})
    fixture.flush()
    if (owned) fixture.events.get('touchstart')()
    fixture.scrollBy(61)
    const before = fixture.rowTop
    fixture.events.get('resize')()
    assert.equal(
      fixture.rowTop,
      before,
      'Resize before the reading RAF must not rewind the actual viewport',
    )
    fixture.flush()
    assert.equal(fixture.saved.at(-1)?.offset, targetPlace.offset - 61)
    assert.ok(fixture.dispatched.every(event => !event.intentional))
    fixture.move(before + 97)
    fixture.events.get('resize')()
    fixture.flush()
    assert.equal(fixture.rowTop, before, 'Late layout follows the newer place')
    fixture.scrollBy(23)
    fixture.flush()
    assert.equal(fixture.saved.at(-1)?.offset, targetPlace.offset - 84)
    fixture.cleanup()
  }
})

test('Immediate navigation flushes pending reading locally so a cold entry cannot resurrect the previous window', () => {
  const fixture = readingFixture({initialPlace: targetPlace})
  fixture.flush()
  fixture.events.get('touchstart')()
  fixture.scrollBy(61)
  fixture.depart()
  fixture.flush()
  assert.equal(
    fixture.saved.at(-1)?.offset,
    targetPlace.offset - 61,
    'Departure must not discard the pending durable reading capture',
  )
  assert.ok(fixture.dispatched.every(event => !event.intentional))
  const cold = readingFixture({initialPlace: fixture.saved.at(-1)})
  cold.flush()
  assert.equal(cold.rowTop, fixture.rowTop)
  fixture.cleanup()
  cold.cleanup()
})

test('Back reactivation releases correction before continued touch momentum and saves the newer viewport', () => {
  const fixture = readingFixture()
  fixture.move(45)
  fixture.depart()
  fixture.move(500)
  fixture.focusAgain()
  fixture.flush()
  assert.equal(fixture.rowTop, 45)
  fixture.scrollBy(30)
  fixture.flush()
  assert.equal(fixture.saved.at(-1)?.offset, -128)
  fixture.advance(200)
  fixture.events.get('resize')()
  assert.equal(
    fixture.rowTop,
    15,
    'Late layout cannot restore the old departure',
  )
})

test('A remounted entry uses its exact departure rather than the older durable checkpoint and continues saving', () => {
  const fixture = readingFixture({initialPlace: targetPlace})
  fixture.flush()
  fixture.move(45)
  fixture.depart()
  fixture.move(500)
  fixture.remount()
  fixture.flush()
  assert.equal(fixture.rowTop, 45)
  assert.deepEqual(fixture.saved, [])
  fixture.scrollBy(30)
  fixture.flush()
  assert.equal(fixture.saved.at(-1)?.offset, -128)
})

test('Resumed reading invalidates a cancelled departure before a later activation', () => {
  const fixture = readingFixture()
  fixture.move(45)
  fixture.depart()
  fixture.events.get('wheel')()
  fixture.scrollBy(30)
  fixture.flush()
  fixture.advance(200)
  fixture.move(500)
  fixture.focusAgain()
  fixture.flush()
  assert.equal(
    fixture.rowTop,
    15,
    'A cancelled navigation cannot resurrect its old departure',
  )
})

test('An expired departure cannot claim semantic restoration or block the entry pixel fallback', () => {
  const fixture = readingFixture({initialPlace: targetPlace})
  fixture.flush()
  fixture.move(45)
  fixture.depart()
  fixture.expire()
  fixture.move(500)
  fixture.focusAgain()
  assert.equal(fixture.rowTop, 500)
  assert.equal(fixture.restoreEntry(), false)
})

test('Departure restoration is isolated to the original history entry and feed', () => {
  for (const overrides of [
    {routeKey: 'another-home-entry'},
    {feed: 'author:did:plc:aaaaaaaaaaaaaaaaaaaaaaaa:posts'},
  ]) {
    const fixture = readingFixture()
    fixture.move(45)
    fixture.depart()
    fixture.move(500)
    fixture.remount(overrides)
    fixture.flush()
    assert.equal(fixture.rowTop, 500)
    assert.equal(fixture.restoreEntry(overrides.routeKey), false)
  }
})

test('Disabled source cleanup cancels queued captures and removes gesture/blur listeners before refocus', () => {
  const fixture = readingFixture()
  fixture.events.get('touchstart')()
  fixture.move(45)
  fixture.events.get('scroll')()
  fixture.disable()
  fixture.flush()
  assert.deepEqual(fixture.saved, [])
  for (const event of [
    'scroll',
    'touchstart',
    'touchend',
    'blur',
    'skyanchor-before-navigation',
  ])
    assert.equal(fixture.events.has(event), false, event)
  fixture.move(500)
  fixture.focusAgain()
  fixture.scrollBy(30)
  fixture.flush()
  assert.equal(fixture.saved.at(-1)?.offset, 327)
})

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

test('Owned reading interrupts a pending correction before RAF without capturing its corrective scroll', () => {
  for (const input of ['wheel', 'Home', 'touch']) {
    const fixture = readingFixture()
    fixture.hook.preserve(targetPlace, () => {})
    if (input === 'Home')
      fixture.events.get('keydown')({
        key: 'Home',
        target: fixture.keyTarget(false),
      })
    else fixture.events.get(input === 'touch' ? 'touchstart' : 'wheel')()
    fixture.events.get('scroll')()
    assert.deepEqual(fixture.saved, [])
    fixture.scrollBy(-37)
    fixture.flush()
    assert.equal(fixture.dispatched.length, 1, input)
    assert.equal(fixture.dispatched.at(-1).intentional, true, input)
    assert.equal(fixture.saved.at(-1).offset, targetPlace.offset + 37, input)
    fixture.events.get('resize')()
    assert.equal(fixture.rowTop, targetPlace.offset + 37 + 143, input)
    fixture.cleanup()
  }
})

test('Touch momentum remains owned beyond three seconds, but quiescence and scrollend cannot authorize a later passive scroll', () => {
  for (const end of ['quiescence', 'scrollend']) {
    const fixture = readingFixture()
    fixture.events.get('touchstart')()
    fixture.events.get('touchend')()
    for (let step = 0; step < 32; step++) {
      fixture.advance(100)
      fixture.move(45 - step)
      fixture.events.get('scroll')()
      fixture.flush()
      assert.equal(fixture.dispatched.at(-1).intentional, true)
    }
    if (end === 'scrollend') fixture.scrollEnd()
    else fixture.advance(251)
    fixture.move(30)
    fixture.events.get('scroll')()
    fixture.flush()
    assert.equal(fixture.dispatched.at(-1).intentional, false)
    fixture.cleanup()
  }
})

test('Nested scrollend cannot terminate document momentum; lost contacts have a finite lifetime', () => {
  const fixture = readingFixture()
  fixture.events.get('touchstart')()
  fixture.events.get('touchend')()
  fixture.scrollEnd(true)
  fixture.move(45)
  fixture.events.get('scroll')()
  fixture.flush()
  assert.equal(fixture.dispatched.at(-1).intentional, true)
  fixture.events.get('touchstart')()
  fixture.advance(30001)
  fixture.move(30)
  fixture.events.get('scroll')()
  fixture.flush()
  assert.equal(fixture.dispatched.at(-1).intentional, false)
})

test('Only a primary mouse press in the measured document scrollbar owns a drag, including left and horizontal gutters', () => {
  for (const {left, x, y} of [
    {left: false, x: 1272, y: 120},
    {left: true, x: 7, y: 120},
    {left: false, x: 600, y: 840},
  ]) {
    const fixture = readingFixture({
      scrollbarLeft: left,
      horizontalScrollbar: y === 840,
    })
    fixture.pointer(x, y)
    fixture.advance(2500)
    fixture.move(45)
    fixture.events.get('scroll')()
    fixture.flush()
    assert.equal(fixture.dispatched.at(-1).intentional, true)
    fixture.events.get('pointerup')({pointerId: 7})
    fixture.advance(251)
    fixture.move(30)
    fixture.events.get('scroll')()
    fixture.flush()
    assert.equal(fixture.dispatched.at(-1).intentional, false)
    fixture.cleanup()
  }
  const overlay = readingFixture({overlayScrollbar: true})
  overlay.pointer(1279, 120)
  overlay.move(45)
  overlay.events.get('scroll')()
  overlay.flush()
  assert.equal(overlay.dispatched.at(-1).intentional, false)
  for (const down of [
    fixture => fixture.pointer(600, 120),
    fixture => fixture.pointer(7, 120), // Empty mirrored LTR gutter.
    fixture => fixture.pointer(1272, 120, {target: {tagName: 'BUTTON'}}),
    fixture => fixture.pointer(1272, 120, {button: 2}),
    fixture => fixture.pointer(1272, 120, {pointerType: 'touch'}),
    fixture => fixture.pointer(1280, 120),
  ]) {
    const fixture = readingFixture()
    down(fixture)
    fixture.move(45)
    fixture.events.get('scroll')()
    fixture.flush()
    assert.equal(fixture.dispatched.at(-1).intentional, false)
  }
})

test('Lifecycle and programmatic boundaries cancel gesture ownership and queued captures', () => {
  for (const cancel of [
    fixture => fixture.hidden(),
    fixture => fixture.events.get('resize')(),
    fixture => fixture.events.get('blur')(),
    fixture => fixture.events.get('touchcancel')(),
    fixture => fixture.events.get('pointercancel')(),
    fixture => fixture.hook.preserve(targetPlace, () => {}),
    fixture => fixture.hook.abandonTarget(() => {}),
    fixture => fixture.focusAgain(),
    fixture => fixture.switchOwner('did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'),
  ]) {
    const fixture = readingFixture()
    fixture.events.get('wheel')()
    fixture.move(45)
    fixture.events.get('scroll')()
    cancel(fixture)
    fixture.flush()
    assert.ok(fixture.dispatched.every(event => !event.intentional))
    fixture.cleanup()
  }
})

test('Modified or consumed reading keys do not authorize a scroll', () => {
  for (const overrides of [
    {ctrlKey: true},
    {metaKey: true},
    {altKey: true},
    {shiftKey: true},
    {defaultPrevented: true},
    {key: 'Enter'},
  ]) {
    const fixture = readingFixture()
    fixture.events.get('keydown')({key: 'PageDown', ...overrides})
    fixture.move(45)
    fixture.events.get('scroll')()
    fixture.flush()
    assert.equal(fixture.dispatched.at(-1).intentional, false)
  }
  for (const editable of [false, true]) {
    const fixture = readingFixture()
    fixture.events.get('keydown')({
      key: ' ',
      target: fixture.keyTarget(!editable, editable),
    })
    fixture.move(45)
    fixture.events.get('scroll')()
    fixture.flush()
    assert.equal(fixture.dispatched.at(-1).intentional, false)
  }
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

test('Reading input from the previous account cannot authorize the next account capture', () => {
  const fixture = readingFixture()
  fixture.events.get('wheel')()
  fixture.switchOwner('did:plc:bbbbbbbbbbbbbbbbbbbbbbbb')
  fixture.move(45)
  fixture.events.get('scroll')()
  fixture.flush()
  assert.equal(
    fixture.dispatched.at(-1).did,
    'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb',
  )
  assert.equal(fixture.dispatched.at(-1).intentional, false)
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

test('Exact occurrence settlement handles browser scroll quantization without changing the saved offset', async () => {
  for (const offset of [-42.5, -42.875, -42.125]) {
    const fixture = readingFixture({quantizedScroll: true})
    const place = {...targetPlace, offset}
    const completion = fixture.hook.setTarget(place, true)
    fixture.flush()
    await completion
    assert.ok(Math.abs(fixture.rowTop - 143 - place.offset) <= 0.5)
    assert.deepEqual(fixture.saved, [place])
  }
})

test('Unreachable clamped placement outside browser precision still fails without saving', async () => {
  const fixture = readingFixture({clampedScroll: true})
  fixture.move(143 + targetPlace.offset - 1.5)
  const failure = assert.rejects(
    fixture.hook.setTarget(targetPlace, true),
    /did not settle/,
  )
  fixture.flush()
  await failure
  assert.deepEqual(fixture.saved, [])
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
