import assert from 'node:assert/strict'
import {expect} from '@playwright/test'

export function installViewportFixture() {
  const original = window.visualViewport
  const viewport = new EventTarget()
  let override
  const listeners = new Map()
  const add = viewport.addEventListener.bind(viewport)
  const remove = viewport.removeEventListener.bind(viewport)
  viewport.addEventListener = (type, listener, options) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(listener)
    add(type, listener, options)
  }
  viewport.removeEventListener = (type, listener, options) => {
    listeners.get(type)?.delete(listener)
    remove(type, listener, options)
  }
  for (const key of ['height', 'width', 'offsetTop', 'offsetLeft', 'scale']) {
    Object.defineProperty(viewport, key, {
      get: () =>
        override?.[key] ??
        original?.[key] ??
        (key === 'height'
          ? innerHeight
          : key === 'width'
            ? innerWidth
            : key === 'scale'
              ? 1
              : 0),
    })
  }
  Object.defineProperty(window, 'visualViewport', {
    get: () => viewport,
    configurable: true,
  })
  window.fixtureViewport = values => {
    override = values
    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('scroll'))
  }
  window.fixtureViewportListeners = () =>
    [...listeners].map(([type, entries]) => [type, entries.size])
  const safeAreas = () => {
    document.documentElement.style.setProperty('--skyanchor-safe-top', '47px')
    document.documentElement.style.setProperty(
      '--skyanchor-safe-bottom',
      '34px',
    )
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', safeAreas)
  else safeAreas()
}

export async function verifyViewport({page, report, profile = false}) {
  if (!profile) await page.getByTestId('composeFAB').waitFor()
  if (!profile) {
    await page.evaluate(() => window.scrollTo(0, 1600))
    await page.waitForTimeout(300)
    await page.evaluate(() => window.scrollBy(0, -160))
  }
  await page.waitForTimeout(1000)
  const before = await page.evaluate(() => ({
    y: scrollY,
    places: Object.fromEntries(
      Object.entries(localStorage).filter(([key]) =>
        /^skyanchor:(following|return|revision)/.test(key),
      ),
    ),
    listeners: window.fixtureViewportListeners(),
  }))
  const layoutHeight = await page.evaluate(
    () => document.documentElement.clientHeight,
  )
  for (const [name, height, offsetTop] of [
    ['chrome collapse beyond stale layout', layoutHeight + 70, 20],
    ['chrome expand', layoutHeight - 100, 12],
    ['offset-only up-scroll', layoutHeight - 100, 36],
    ['standalone full height', layoutHeight, 0],
  ]) {
    await page.evaluate(
      ({height, offsetTop}) =>
        window.fixtureViewport({
          height,
          width: innerWidth,
          offsetTop,
          offsetLeft: 0,
          scale: 1,
        }),
      {height, offsetTop},
    )
    await page.waitForTimeout(200)
    const actual = await page.evaluate(profile => {
      const footer = document.querySelector('[data-testid="mobileBottomBar"]')
      const fab = document.querySelector('[data-testid="composeFAB"]')
      const latest = document.querySelector('[data-testid="loadLatestBtn"]')
      const header = document.querySelector(
        profile
          ? '[data-testid="profileFeedTabs"]'
          : '[data-testid="mobileHomeHeader"]',
      )
      const button = document.querySelector(
        '[data-testid="skyanchor-reading-button"]',
      )
      const links = [...footer.querySelectorAll('a')]
      const rect = node => {
        if (!node) return undefined
        const r = node.getBoundingClientRect()
        return {
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          left: r.left,
          right: r.right,
          width: r.width,
        }
      }
      return {
        layoutHeight: document.documentElement.clientHeight,
        visibleTop: visualViewport.offsetTop,
        visibleBottom: visualViewport.offsetTop + visualViewport.height,
        footer: rect(footer),
        header: rect(header),
        reading: rect(button),
        fab: rect(fab),
        latest: rect(latest),
        links: links.map(rect),
        safeBottom: parseFloat(getComputedStyle(footer).paddingBottom),
        safeTop: parseFloat(getComputedStyle(header).paddingTop),
        overflow: document.documentElement.scrollWidth - innerWidth,
        places: Object.fromEntries(
          Object.entries(localStorage).filter(([key]) =>
            /^skyanchor:(following|return|revision)/.test(key),
          ),
        ),
        y: scrollY,
      }
    }, profile)
    report.viewport ??= []
    const {places, ...geometry} = actual
    report.viewport.push({name, profile, ...geometry})
    assert.equal(actual.layoutHeight, layoutHeight)
    assert.ok(
      Math.abs(actual.footer.bottom - actual.visibleBottom) <= 2,
      `Footer must reach visual bottom: ${JSON.stringify(actual)}`,
    )
    assert.ok(Math.abs(actual.header.top - actual.visibleTop) <= 2)
    assert.equal(actual.safeTop, 47)
    assert.equal(actual.safeBottom, 34)
    assert.ok(actual.reading.top >= actual.visibleTop + 47)
    for (const link of actual.links) {
      assert.ok(link.height >= 44)
      assert.ok(link.bottom <= actual.visibleBottom - 34 + 1)
    }
    if (actual.fab) {
      assert.ok(Math.abs(actual.footer.top - actual.fab.bottom - 16) <= 2)
    }
    if (actual.latest)
      assert.ok(Math.abs(actual.footer.top - actual.latest.bottom - 16) <= 2)
    assert.ok(actual.overflow <= 1)
    assert.equal(
      actual.y,
      before.y,
      'Geometry updates must not programmatically scroll',
    )
    assert.deepEqual(
      places,
      before.places,
      'Geometry updates cannot write reading state',
    )
  }
  await expect(page.getByTestId('skyanchor-reading-button')).toBeVisible()
  assert.deepEqual(
    await page.evaluate(() => window.fixtureViewportListeners()),
    before.listeners,
  )
  await page.evaluate(() => window.fixtureViewport(undefined))
  await page.waitForTimeout(200)
  if (!profile) {
    for (const boundary of ['top', 'bottom']) {
      await page.evaluate(
        boundary =>
          window.scrollTo(
            0,
            boundary === 'top' ? 0 : document.documentElement.scrollHeight,
          ),
        boundary,
      )
      await page.waitForTimeout(350)
      const actualY = await page.evaluate(() => scrollY)
      for (const offset of boundary === 'top' ? [-64, -28, 0] : [64, 28, 0]) {
        await page.evaluate(
          ({boundary, offset, actualY}) => {
            window.dispatchEvent(new Event('touchstart'))
            window.fixtureScrollYDescriptor ??= Object.getOwnPropertyDescriptor(
              window,
              'scrollY',
            )
            Object.defineProperty(window, 'scrollY', {
              configurable: true,
              get: () =>
                boundary === 'top'
                  ? -Math.abs(offset)
                  : document.documentElement.scrollHeight -
                    document.documentElement.clientHeight +
                    offset,
            })
            window.fixtureViewport({
              height: document.documentElement.clientHeight,
              offsetTop: offset,
              scale: 1,
            })
          },
          {boundary, offset, actualY},
        )
        await page.waitForTimeout(150)
        const rects = await page.evaluate(() => ({
          top: document
            .querySelector('[data-testid="mobileHomeHeader"]')
            .getBoundingClientRect().top,
          bottom: document
            .querySelector('[data-testid="mobileBottomBar"]')
            .getBoundingClientRect().bottom,
          layout: document.documentElement.clientHeight,
          y: pageYOffset,
        }))
        assert.ok(
          Math.abs(rects.top) <= 2,
          `Elastic ${boundary} header: ${JSON.stringify(rects)}`,
        )
        assert.ok(
          Math.abs(rects.bottom - rects.layout) <= 2,
          `Elastic ${boundary} footer: ${JSON.stringify(rects)}`,
        )
        assert.equal(
          rects.y,
          actualY,
          'Elastic shell corrections must never scroll content',
        )
        report.viewport.push({
          name: `elastic ${boundary} ${offset}`,
          profile: false,
          ...rects,
        })
      }
      await page.evaluate(() => {
        Object.defineProperty(
          window,
          'scrollY',
          window.fixtureScrollYDescriptor,
        )
        window.dispatchEvent(new Event('touchend'))
        window.fixtureViewport(undefined)
        window.dispatchEvent(new Event('pageshow'))
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await page.waitForTimeout(200)
    }
    await page.evaluate(() => window.scrollTo(0, 1440))
    await page.waitForTimeout(350)
    const beforePan = await page.evaluate(() => scrollY)
    await page.evaluate(height => {
      window.dispatchEvent(new Event('touchstart'))
      window.fixtureViewport({
        height: height - 90,
        offsetTop: 32,
        width: innerWidth,
        offsetLeft: 0,
        scale: 1,
      })
      window.dispatchEvent(new Event('resize'))
    }, layoutHeight)
    await page.waitForTimeout(200)
    assert.equal(
      await page.evaluate(() => scrollY),
      beforePan,
      'Chrome events during a finger pan must not restore/scroll',
    )
    await page.evaluate(() => {
      window.dispatchEvent(new Event('touchend'))
      window.fixtureViewport({
        height: innerHeight / 2,
        offsetTop: 80,
        width: innerWidth / 2,
        offsetLeft: 30,
        scale: 2,
      })
    })
    await page.waitForTimeout(200)
    assert.equal(
      await page
        .getByTestId('mobileHomeHeader')
        .evaluate(node => node.getBoundingClientRect().top),
      0,
      'Pinch zoom uses natural browser panning, not shell chasing',
    )
    assert.equal(await page.evaluate(() => scrollY), beforePan)
    await page.evaluate(() => window.fixtureViewport(undefined))
    await page.waitForTimeout(250)
    await page.getByTestId('composeFAB').click()
    const dialog = page.getByTestId('composePostView')
    await dialog.locator('.ProseMirror[contenteditable="true"]').first().focus()
    await page.evaluate(() =>
      window.fixtureViewport({
        height: 400,
        width: innerWidth,
        offsetTop: 80,
        offsetLeft: 0,
        scale: 1,
      }),
    )
    await page.waitForTimeout(200)
    const keyboardGeometry = await page
      .getByTestId('mobileBottomBar')
      .evaluate(node => ({
        bottom: node.getBoundingClientRect().bottom,
        layoutHeight: document.documentElement.clientHeight,
      }))
    assert.ok(
      Math.abs(keyboardGeometry.bottom - keyboardGeometry.layoutHeight) <= 2,
      'Keyboard must not lift navigation over the composer',
    )
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click()
    await expect(dialog).toHaveCount(0)
    await page.evaluate(() => window.fixtureViewport(undefined))
    await page.waitForTimeout(250)
    const orientation = page.viewportSize()
    await page.setViewportSize({width: 744, height: 390})
    await page.waitForTimeout(350)
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    await page.setViewportSize(orientation)
    await page.waitForTimeout(350)
    const restored = await page
      .getByTestId('mobileBottomBar')
      .evaluate(node => ({
        bottom: node.getBoundingClientRect().bottom,
        visibleBottom: visualViewport.offsetTop + visualViewport.height,
      }))
    assert.ok(Math.abs(restored.bottom - restored.visibleBottom) <= 2)
  }
  await page.screenshot({
    path: profile
      ? 'proof-viewport-profile.png'
      : 'proof-viewport-following.png',
  })
  report.checks.push(
    `${profile ? 'Profile' : 'Following'} WebKit shell uses independent visual edges and safe-area paint, with unchanged reading bytes/scroll${profile ? '' : '; keyboard/pinch/pan/orientation retain browser behavior'} (simulated, not physical Safari)`,
  )
}
