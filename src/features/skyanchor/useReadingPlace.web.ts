import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useLingui} from '@lingui/react/macro'
import {useRoute} from '@react-navigation/native'
import {flushSync} from 'react-dom'

import {logger} from '#/logger'
import {
  chooseAnchor,
  ReadingCapacityError,
  readingEpoch,
  type ReadingFeed,
  type ReadingPlace,
  readSnapshot,
} from './domain'

const departures = new Map<string, {place: ReadingPlace; epoch: number}>()

export function useReadingPlace({
  did,
  feed = 'following',
  scope,
  enabled,
  headerOffset,
  keys,
  save,
}: {
  did: string | undefined
  feed?: ReadingFeed
  scope: string
  enabled: boolean
  headerOffset: number
  keys: string[]
  save: (place: ReadingPlace) => void
}) {
  const {t: l} = useLingui()
  const route = useRoute()
  const entry = `${route.key}|${did}|${feed}`
  const desired = useRef<ReadingPlace | undefined>(undefined)
  const exactTarget = useRef(false)
  const initialized = useRef(false)
  const activated = useRef(false)
  const leaving = useRef(false)
  const correcting = useRef(false)
  const correctionFrame = useRef(0)
  const switching = useRef(false)
  const panningUntil = useRef(0)
  const userScrollUntil = useRef(0)
  const correctedScrollY = useRef<number | undefined>(undefined)
  const capturePaused = useRef(false)
  const pendingTarget = useRef<{cancel: () => void; frame: number} | undefined>(
    undefined,
  )
  const lifetime = useRef({
    did,
    feed,
    epoch: did ? readingEpoch(did) : 0,
    alive: true,
  })
  if (lifetime.current.did !== did || lifetime.current.feed !== feed) {
    lifetime.current = {
      did,
      feed,
      epoch: did ? readingEpoch(did) : 0,
      alive: true,
    }
    desired.current = undefined
    exactTarget.current = false
    initialized.current = false
    activated.current = false
    leaving.current = false
  }
  useEffect(() => {
    const active = lifetime.current
    active.alive = true
    return () => {
      active.alive = false
      pendingTarget.current?.cancel()
      cancelAnimationFrame(correctionFrame.current)
    }
  }, [did, feed, enabled])
  const [notice, setNotice] = useState('')
  const latest = useRef({keys, save, headerOffset, enabled})
  latest.current = {keys, save, headerOffset, enabled}
  const keySignature = keys.join('\n')
  const getRoot = () =>
    document.querySelector<HTMLElement>(
      `[data-skyanchor-scope="${CSS.escape(scope)}"]`,
    )
  const visibleHeaderBottom = () => {
    const header =
      feed === 'following'
        ? document.querySelector<HTMLElement>(
            '[data-testid="mobileHomeHeader"]',
          )
        : getRoot()
            ?.closest('[data-testid="profileScreen"]')
            ?.querySelector<HTMLElement>('[data-testid="profileFeedTabs"]')
    return header?.getClientRects().length
      ? Math.max(
          window.visualViewport?.offsetTop ?? 0,
          header.getBoundingClientRect().bottom,
        )
      : latest.current.headerOffset
  }
  const getNodes = () =>
    [
      ...(getRoot()?.querySelectorAll<HTMLElement>('[data-skyanchor-key]') ??
        []),
    ]
      .filter(
        node =>
          node.getClientRects().length &&
          node
            .closest('[data-skyanchor-account]')
            ?.getAttribute('data-skyanchor-account') === did,
      )
      .filter(
        node =>
          node
            .closest('[data-skyanchor-feed]')
            ?.getAttribute('data-skyanchor-feed') === feed,
      )

  const isElastic = () =>
    window.scrollY < 0 ||
    window.scrollY >
      document.documentElement.scrollHeight -
        document.documentElement.clientHeight +
        1

  function snapshot() {
    if (
      !lifetime.current.alive ||
      lifetime.current.did !== did ||
      lifetime.current.feed !== feed ||
      (did && lifetime.current.epoch !== readingEpoch(did))
    )
      return undefined
    if (!latest.current.enabled || !did || isElastic()) return undefined
    const nodes = getNodes()
    const node = nodes.find(
      node => node.getBoundingClientRect().bottom > visibleHeaderBottom() + 1,
    )
    if (
      !node ||
      node.getBoundingClientRect().top >
        (window.visualViewport
          ? window.visualViewport.offsetTop + window.visualViewport.height
          : window.innerHeight)
    )
      return undefined
    const key = node.getAttribute('data-skyanchor-key')!
    const index = latest.current.keys.indexOf(key)
    const neighbors = latest.current.keys
      .slice(Math.max(0, index - 3), index + 5)
      .filter(value => value !== key)
      .slice(0, 8)
    const place: ReadingPlace = {
      version: 1,
      anchor: key,
      offset: node.getBoundingClientRect().top - visibleHeaderBottom(),
      neighbors,
    }
    return place
  }

  function capture(intentional = false) {
    if (leaving.current || switching.current || capturePaused.current)
      return undefined
    if (correcting.current || !initialized.current) return desired.current
    const place = snapshot()
    return place ? savePlace(place, intentional) : desired.current
  }

  function savePlace(place: ReadingPlace, intentional = false) {
    const changed = JSON.stringify(desired.current) !== JSON.stringify(place)
    try {
      latest.current.save(place)
      desired.current = place
      if (changed)
        window.dispatchEvent(
          new CustomEvent('skyanchor-place', {
            detail: {did, feed, place, intentional},
          }),
        )
    } catch (error) {
      logger.error('SkyAnchor could not save reading place', {message: error})
      setNotice(
        error instanceof ReadingCapacityError
          ? l`Local profile reading-place capacity reached (64 filters). Existing places were not evicted.`
          : l`Reading place could not be saved locally.`,
      )
      return undefined
    }
    return place
  }

  function correct() {
    if (leaving.current || isElastic()) return
    if (Date.now() < panningUntil.current) return
    if (
      !lifetime.current.alive ||
      lifetime.current.did !== did ||
      lifetime.current.feed !== feed ||
      (did && lifetime.current.epoch !== readingEpoch(did))
    )
      return
    if (
      !latest.current.enabled ||
      !desired.current ||
      !latest.current.keys.length
    )
      return
    const chosen = chooseAnchor(desired.current, latest.current.keys)
    if (exactTarget.current && chosen.fallback) return
    if (chosen.fallback)
      setNotice(
        chosen.key
          ? l`Saved post is missing or moderated. Resumed at a nearby post; intervening history may be missing.`
          : l`Saved place is unavailable in this window. Load new posts to try connecting current history.`,
      )
    const node = getNodes().find(
      node => node.getAttribute('data-skyanchor-key') === chosen.key,
    )
    if (!node) return
    const offset = chosen.fallback ? 0 : desired.current.offset
    const delta =
      node.getBoundingClientRect().top - visibleHeaderBottom() - offset
    if (Math.abs(delta) > 0.25) {
      correcting.current = true
      window.scrollBy({top: delta, behavior: 'instant'})
      correctedScrollY.current = window.scrollY
      cancelAnimationFrame(correctionFrame.current)
      correctionFrame.current = requestAnimationFrame(() => {
        correcting.current = false
      })
    }
    return delta
  }

  useLayoutEffect(() => {
    if (!enabled) {
      activated.current = false
      userScrollUntil.current = 0
      return
    }
    if (!did || !keys.length) return
    lifetime.current.alive = true
    const departure = !activated.current ? departures.get(entry) : undefined
    activated.current = true
    if (departure) {
      departures.delete(entry)
      if (departure.epoch === readingEpoch(did)) {
        leaving.current = false
        desired.current = departure.place
        exactTarget.current = true
        initialized.current = true
        capturePaused.current = false
        panningUntil.current = 0
      }
    }
    if (!initialized.current) {
      try {
        desired.current = readSnapshot(localStorage, did, feed)?.place
      } catch (error) {
        logger.error('SkyAnchor could not load reading place', {message: error})
        setNotice(l`Saved place is invalid. It was not restored.`)
      }
      initialized.current = true
    }
    correct()
  }, [enabled, did, feed, entry, headerOffset, keySignature])

  useEffect(() => {
    if (!enabled || !did) return
    let frame = 0
    const onScroll = () => {
      if (leaving.current) return
      if (
        switching.current &&
        !correcting.current &&
        window.scrollY !== correctedScrollY.current
      )
        pendingTarget.current?.cancel()
      if (correcting.current || switching.current) return
      if (window.scrollY === correctedScrollY.current) return
      correctedScrollY.current = undefined
      capturePaused.current = false
      panningUntil.current = Math.max(panningUntil.current, Date.now() + 150)
      cancelAnimationFrame(frame)
      const intentional = Date.now() < userScrollUntil.current
      frame = requestAnimationFrame(() => capture(intentional))
    }
    const observer = new ResizeObserver(correct)
    getNodes().forEach(node => observer.observe(node))
    const root = getNodes()[0]?.closest('[data-skyanchor-feed]')
    if (root) {
      observer.observe(root)
      if (root.parentElement) observer.observe(root.parentElement)
      const profile = root.closest('[data-testid="profileScreen"]')
      if (profile) observer.observe(profile)
    }
    window.addEventListener('scroll', onScroll, {passive: true})
    const onPanStart = () => {
      userScrollUntil.current = Infinity
      leaving.current = false
      pendingTarget.current?.cancel()
      panningUntil.current = Infinity
    }
    const onPanEnd = () => {
      userScrollUntil.current = Date.now() + 1500
      pendingTarget.current?.cancel()
      panningUntil.current = Date.now() + 150
    }
    const onWheel = () => {
      userScrollUntil.current = Date.now() + 1500
      leaving.current = false
      pendingTarget.current?.cancel()
      panningUntil.current = Date.now() + 150
    }
    window.addEventListener('touchstart', onPanStart, {passive: true})
    window.addEventListener('touchend', onPanEnd, {passive: true})
    window.addEventListener('touchcancel', onPanEnd, {passive: true})
    window.addEventListener('wheel', onWheel, {passive: true})
    const onKey = (event: KeyboardEvent) => {
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'PageUp',
          'PageDown',
          'Home',
          'End',
          ' ',
        ].includes(event.key) &&
        !(
          event.target instanceof HTMLElement &&
          (event.target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))
        )
      )
        onWheel()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', correct)
    const onPageHide = () => {
      pendingTarget.current?.cancel()
      capture()
    }
    window.addEventListener('pagehide', onPageHide)
    const saveNow = (event: Event) => {
      const place = capture()
      const detail: unknown =
        event instanceof CustomEvent ? event.detail : undefined
      if (
        initialized.current &&
        !place &&
        detail &&
        typeof detail === 'object' &&
        'failed' in detail
      )
        detail.failed = true
    }
    window.addEventListener('skyanchor-save-now', saveNow)
    const onDeparture = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail: unknown = event.detail
      if (!detail || typeof detail !== 'object' || !('target' in detail)) return
      const target = detail.target
      if (!(target instanceof Node) || !getRoot()?.contains(target)) return
      const place = snapshot()
      if (!place) return
      departures.delete(entry)
      departures.set(entry, {place, epoch: readingEpoch(did)})
      if (departures.size > 64)
        departures.delete(departures.keys().next().value!)
      capturePaused.current = true
      leaving.current = true
      cancelAnimationFrame(frame)
    }
    window.addEventListener('skyanchor-before-navigation', onDeparture)
    const onRestoreEntry = (event: Event) => {
      if (!(event instanceof CustomEvent) || !latest.current.enabled) return
      const detail: unknown = event.detail
      if (
        !detail ||
        typeof detail !== 'object' ||
        !('routeKey' in detail) ||
        detail.routeKey !== route.key ||
        !('handled' in detail)
      )
        return
      if (!desired.current || !lifetime.current.alive) return
      detail.handled = true
      correct()
    }
    window.addEventListener('skyanchor-restore-navigation', onRestoreEntry)
    const onHidden = () => {
      if (document.visibilityState === 'hidden') onPageHide()
    }
    document.addEventListener('visibilitychange', onHidden)
    void document.fonts.ready.then(correct)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('touchstart', onPanStart)
      window.removeEventListener('touchend', onPanEnd)
      window.removeEventListener('touchcancel', onPanEnd)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', correct)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('skyanchor-save-now', saveNow)
      window.removeEventListener('skyanchor-before-navigation', onDeparture)
      window.removeEventListener('skyanchor-restore-navigation', onRestoreEntry)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [enabled, did, feed, entry, keySignature])

  return {
    notice,
    capture,
    snapshot,
    preserve(place: ReadingPlace, update: () => void) {
      desired.current = place
      exactTarget.current = true
      initialized.current = true
      panningUntil.current = 0
      flushSync(update)
      correct()
    },
    abandonTarget(update: () => void) {
      pendingTarget.current?.cancel()
      desired.current = undefined
      capturePaused.current = true
      flushSync(update)
      correctedScrollY.current = window.scrollY
    },
    setTarget(
      place: ReadingPlace | undefined,
      exact = false,
      signal?: AbortSignal,
    ): Promise<void> {
      pendingTarget.current?.cancel()
      panningUntil.current = 0
      userScrollUntil.current = 0
      capturePaused.current = false
      desired.current = place
      exactTarget.current = exact
      initialized.current = true
      setNotice('')
      if (!place) return Promise.resolve()
      switching.current = true
      correctedScrollY.current = window.scrollY
      const active = lifetime.current
      return new Promise((resolve, reject) => {
        let attempts = 0
        // Sticky headers can change their viewport position after the first scroll.
        let stableFrames = 0
        const pending = {
          frame: 0,
          cancel: () =>
            fail(
              new Error(
                l`Reading restore cancelled. Your saved place was not consumed.`,
              ),
            ),
        }
        const fail = (error: Error) => {
          if (pendingTarget.current !== pending) return
          cancelAnimationFrame(pending.frame)
          cancelAnimationFrame(correctionFrame.current)
          correcting.current = false
          pendingTarget.current = undefined
          exactTarget.current = false
          switching.current = false
          capturePaused.current = true
          desired.current = undefined
          setNotice(error.message)
          reject(error)
        }
        const settle = () => {
          if (pendingTarget.current !== pending) return
          if (
            lifetime.current !== active ||
            signal?.aborted ||
            !active.alive ||
            !latest.current.enabled ||
            (did && active.epoch !== readingEpoch(did))
          ) {
            pending.cancel()
            return
          }
          const delta = correct()
          if (pendingTarget.current !== pending) return
          stableFrames =
            delta !== undefined &&
            Number.isFinite(delta) &&
            Math.abs(delta) <= 0.25
              ? stableFrames + 1
              : 0
          if (stableFrames >= 3) {
            const chosen = chooseAnchor(place, latest.current.keys)
            if (!chosen.key) {
              fail(
                new Error(
                  l`Saved place is outside this bounded history window. Your checkpoint was preserved.`,
                ),
              )
              return
            }
            const restored = chosen.fallback
              ? {
                  ...place,
                  anchor: chosen.key,
                  offset: 0,
                  neighbors: place.neighbors.filter(key => key !== chosen.key),
                }
              : place
            correctedScrollY.current = window.scrollY
            switching.current = false
            if (!savePlace(restored)) {
              fail(
                new Error(
                  l`Reading restore could not be saved. Your checkpoint was preserved.`,
                ),
              )
              return
            }
            pendingTarget.current = undefined
            departures.delete(entry)
            exactTarget.current = false
            resolve()
            return
          }
          if (++attempts >= 60) {
            fail(
              new Error(
                l`Reading restore did not settle. Your checkpoint was preserved; try Return again.`,
              ),
            )
            return
          }
          pending.frame = requestAnimationFrame(settle)
        }
        pendingTarget.current = pending
        pending.frame = requestAnimationFrame(settle)
      })
    },
  }
}
