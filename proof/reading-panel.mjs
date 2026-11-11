import assert from 'node:assert/strict'
import {devices, expect} from '@playwright/test'

export async function scrollReading(page, top) {
  if (page.context().browser().browserType().name() === 'webkit') {
    await page.evaluate(top => {
      dispatchEvent(new Event('touchstart'))
      scrollBy(0, top)
      dispatchEvent(new Event('touchend'))
    }, top)
  } else {
    const viewport = page.viewportSize()
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await page.mouse.wheel(0, top)
  }
  await page.waitForTimeout(200)
}

export async function readingPanel(page, feed) {
  const panel = feed
    ? page.locator(`[data-skyanchor-toolbar-feed="${feed}"]`)
    : page.getByTestId('skyanchor-toolbar')
  if (!(await panel.isVisible())) {
    await page.getByTestId('skyanchor-reading-button').click()
    await panel.waitFor()
  }
  return panel
}

export async function closeReadingPanel(page) {
  if (await page.getByTestId('skyanchor-toolbar').isVisible()) {
    await page
      .getByRole('button', {name: 'Close active dialog', exact: true})
      .click()
    await expect(page.getByTestId('skyanchor-toolbar')).toHaveCount(0)
  }
}

export async function readingAction(page, name, feed) {
  const panel = await readingPanel(page, feed)
  await panel.getByRole('button', {name, exact: true}).click()
  if (
    [
      'Refresh',
      'Load new posts without moving your place',
      'Return to my place',
      'Resume other device',
    ].includes(name)
  )
    await expect(page.getByTestId('skyanchor-toolbar')).toHaveCount(0)
}

export async function legacyReturnFixture(page, did, feed = 'following') {
  await closeReadingPanel(page)
  await page.evaluate(
    ({did, feed}) => {
      const suffix = did + (feed === 'following' ? '' : ':' + feed)
      const snapshot = JSON.parse(
        localStorage.getItem('skyanchor:following:v1:' + suffix),
      )
      assertSnapshot(snapshot)
      function assertSnapshot(value) {
        if (!value?.place || !value?.feed)
          throw new Error('Legacy fixture requires a real saved snapshot')
      }
      localStorage.setItem(
        'skyanchor:return:v1:' + suffix,
        JSON.stringify({version: 1, snapshot}),
      )
    },
    {did, feed},
  )
  await page.reload()
  await page.getByTestId('skyanchor-reading-button').waitFor()
  await page.waitForTimeout(1000)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(1000)
}

export async function verifyReadingPanel(page, report, feed = 'following') {
  await closeReadingPanel(page)
  const trigger = page.getByTestId('skyanchor-reading-button')
  await expect(trigger).toBeVisible()
  await expect(page.getByTestId('skyanchor-toolbar')).toHaveCount(0)
  const bounds = await trigger.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(bounds.width >= 44 && bounds.height >= 44)
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width)
  const geometry = () =>
    page.locator('[data-skyanchor-key]').evaluateAll(nodes =>
      nodes
        .filter(
          node =>
            node.getClientRects().length &&
            node.getBoundingClientRect().bottom > 100,
        )
        .slice(0, 3)
        .map(node => ({
          key: node.dataset.skyanchorKey,
          top: node.getBoundingClientRect().top,
        })),
    )
  const before = await geometry()
  const snapshots = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(
          ([key]) =>
            key.startsWith('skyanchor:following:v1:') ||
            key.startsWith('skyanchor:return:v1:'),
        ),
      ),
    )
  const local = await snapshots()
  await trigger.focus()
  await page.keyboard.press('Enter')
  const panel = await readingPanel(page, feed)
  await expect(
    panel.getByRole('button', {name: 'Refresh', exact: true}),
  ).toBeVisible()
  const panelBounds = await panel.boundingBox()
  assert.ok(
    panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= viewport.width,
  )
  assert.equal(
    await panel.evaluate(node => node.scrollWidth > node.clientWidth),
    false,
  )
  await page.screenshot({
    path: `proof-reading-panel-${viewport.width}-${feed === 'following' ? 'home' : 'profile'}.png`,
  })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('skyanchor-toolbar')).toHaveCount(0)
  await page.waitForTimeout(150)
  assert.deepEqual(
    await snapshots(),
    local,
    'Opening/closing reading actions must not mutate progress',
  )
  const after = await geometry()
  assert.deepEqual(
    after.map(row => row.key),
    before.map(row => row.key),
  )
  for (let i = 0; i < before.length; i++)
    assert.ok(Math.abs(after[i].top - before[i].top) <= 2)
  await expect(trigger).toBeFocused()
  report.checks.push(
    `Collapsed contextual ${feed} reading entrypoint: 44px touch target, keyboard/escape/focus return, bounded panel, no permanent strip or snapshot/anchor mutation at ${viewport.width}px`,
  )
}

export async function verifyNewContent({
  desktopBrowser,
  phoneBrowser,
  origin,
  mockUpstream,
  signIn,
  worker,
  report,
  entries,
  post,
  installViewportFixture,
}) {
  for (const [index, browser] of [desktopBrowser, phoneBrowser].entries()) {
    const did =
      index === 0
        ? 'did:plc:ffffffffffffffffffffffff'
        : 'did:plc:gggggggggggggggggggggggg'
    const context = await browser.newContext({
      viewport:
        index === 0 ? {width: 1280, height: 900} : {width: 390, height: 844},
      ...(index === 1
        ? {
            isMobile: true,
            hasTouch: true,
            userAgent: devices['iPhone 13'].userAgent,
          }
        : {}),
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    const failures = []
    let held
    try {
      await context.addInitScript(() => {
        const remove = Storage.prototype.removeItem
        window.fixtureReturnRemovals = []
        Storage.prototype.removeItem = function (key) {
          if (key.startsWith('skyanchor:return:v1:'))
            window.fixtureReturnRemovals.push(key)
          return remove.call(this, key)
        }
      })
      if (index === 1) {
        await context.addInitScript(installViewportFixture)
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'platform', {get: () => 'iPhone'})
        })
      }
      const controls = await mockUpstream(context, did)
      const initial = [...entries]
      controls.setTimeline(initial)
      const current = await context.newPage()
      current.on('pageerror', error => failures.push(error.message))
      current.on('response', response => {
        if (
          response.status() >= 400 &&
          !response.url().includes('com.atproto.repo.getRecord')
        )
          failures.push(`${response.status()} ${response.url().split('?')[0]}`)
      })
      // Only these disposable pages advance time; composer and three-device clocks stay real.
      await current.clock.install()
      await signIn(current)
      const arrow = current.getByRole('button', {
        name: 'Load new posts without moving your place',
        exact: true,
      })
      await expect(arrow).toHaveCount(0)
      await current
        .locator('[data-skyanchor-key]')
        .filter({hasText: 'Fixture post 20.'})
        .first()
        .scrollIntoViewIfNeeded()
      await current.evaluate(() => window.scrollBy(0, 80))
      await current.waitForTimeout(1000)
      await readingAction(current, 'Connect private sync')
      await readingAction(current, 'Save my place')
      await closeReadingPanel(current)
      await current.waitForTimeout(1000)
      const cloud = () =>
        worker.db
          .prepare(
            "SELECT state, revision, device FROM places WHERE did = ? AND feed = 'following'",
          )
          .bind(did)
          .first()
      const snapshot = () =>
        current.evaluate(did => {
          const key = 'skyanchor:following:v1:' + did
          const place = JSON.parse(localStorage.getItem(key)).place
          const row = [
            ...document.querySelectorAll('[data-skyanchor-key]'),
          ].find(node => node.dataset.skyanchorKey === place.anchor)
          return {
            y: scrollY,
            top: row?.getBoundingClientRect().top,
            place,
            keys: [...document.querySelectorAll('[data-skyanchor-key]')].map(
              node => node.dataset.skyanchorKey,
            ),
            local: Object.fromEntries(
              Object.entries(localStorage).filter(([key]) =>
                /^skyanchor:(following|return|revision)/.test(key),
              ),
            ),
          }
        }, did)
      const before = await snapshot()
      const cloudBefore = await cloud()
      assert.ok(cloudBefore?.state, 'The fixture has a confirmed cloud place')
      const polls = () =>
        controls.timelineRequests.filter(call => call.limit === 1).length
      const noNewStart = polls()
      await current.clock.runFor(60_000)
      await expect.poll(polls).toBe(noNewStart + 1)
      await expect(arrow).toHaveCount(0)
      await readingAction(current, 'Refresh')
      await readingPanel(current)
      await expect(
        current.getByRole('button', {name: 'Refresh', exact: true}),
      ).toBeEnabled()
      await expect(current.getByTestId('skyanchor-new')).toHaveCount(0)
      await closeReadingPanel(current)
      assert.deepEqual(
        await snapshot(),
        before,
        'No-new poll/Refresh preserves the exact window and local bytes',
      )
      assert.deepEqual(await cloud(), cloudBefore)

      const incoming = Array.from({length: 150}, (_, i) => ({post: post(-i)}))
      controls.setTimeline([incoming[0], ...initial])
      const start = polls()
      await current.clock.fastForward(60_000)
      await expect.poll(polls).toBe(start + 1)
      await expect(arrow).toBeVisible()
      await expect(
        current.getByTestId('skyanchor-reading-button'),
      ).toHaveAccessibleName(/New posts above/)
      const style = await arrow.evaluate(node => ({
        background: getComputedStyle(node).backgroundColor,
        icon: getComputedStyle(node.querySelector('svg')).color,
      }))
      assert.notEqual(style.background, 'rgba(0, 0, 0, 0)')
      assert.notEqual(style.icon, 'rgb(0, 0, 0)')
      const bounds = await arrow.boundingBox()
      const viewport = current.viewportSize()
      assert.ok(bounds.width >= 44 && bounds.height >= 44)
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width)
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height)
      const compose = await (
        index === 0
          ? current.getByRole('button', {name: 'Compose new post', exact: true})
          : current.getByTestId('followingFeedPage').getByTestId('composeFAB')
      ).boundingBox()
      assert.ok(
        bounds.x + bounds.width <= compose.x ||
          compose.x + compose.width <= bounds.x ||
          bounds.y + bounds.height <= compose.y ||
          compose.y + compose.height <= bounds.y,
      )
      if (index === 1) {
        const footer = await current
          .getByTestId('mobileBottomBar')
          .boundingBox()
        assert.ok(Math.abs(footer.y - bounds.y - bounds.height - 16) <= 2)
      }
      await readingPanel(current)
      await expect(current.getByTestId('skyanchor-new')).toBeVisible()
      await closeReadingPanel(current)
      assert.deepEqual(
        await snapshot(),
        before,
        'Scheduled discovery must not move/capture/read or replace any occurrence',
      )
      assert.deepEqual(
        await cloud(),
        cloudBefore,
        'Discovery cannot change cloud revision/state',
      )
      await current.clock.fastForward(60_000)
      assert.equal(
        polls(),
        start + 1,
        'Known-new polling stays disabled; no shortened interval or busy loop',
      )
      await arrow.focus()
      await expect(arrow).toBeFocused()
      // Discovery saw only one new post. Activation must fetch the actual current head and all five intervening pages.
      controls.setTimeline([...incoming, ...initial])
      const loadRequests = controls.timelineRequests.length
      await current.evaluate(key => {
        window.fixtureLoadingSamples = []
        window.fixtureWatchingLoad = true
        const sample = () => {
          if (!window.fixtureWatchingLoad) return
          const row = [
            ...document.querySelectorAll('[data-skyanchor-key]'),
          ].find(node => node.dataset.skyanchorKey === key)
          if (window.fixtureLoadingSamples.length < 2048)
            window.fixtureLoadingSamples.push(row?.getBoundingClientRect().top)
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }, before.place.anchor)
      held = controls.holdTimeline(30, 30)
      await arrow.click()
      await held.reached
      incoming.unshift({post: post(-1000)})
      controls.setTimeline([...incoming, ...initial])
      held.release()
      held = undefined
      await expect(current.getByTestId('loadLatestBtn')).toHaveCount(0)
      await current.waitForTimeout(500)
      const samples = await current.evaluate(() => {
        window.fixtureWatchingLoad = false
        return window.fixtureLoadingSamples
      })
      assert.ok(samples.length > 1)
      const maximumDrift = Math.max(
        ...samples.map(top => Math.abs(top - before.top)),
      )
      assert.ok(
        maximumDrift <= 2,
        `Per-frame integration drift ${maximumDrift}px exceeds 2px`,
      )
      const afterLoading = await snapshot()
      assert.equal(
        afterLoading.place.anchor,
        before.place.anchor,
        'Loading newer posts must retain the current visible occurrence, not replace the old window',
      )
      assert.ok(
        Math.abs(afterLoading.top - before.top) <= 2,
        'Loading newer posts must preserve the immediate viewport within 2 CSS pixels',
      )
      const expectedNew = incoming.map(
        item => item.post.uri + '|repost:-|reply:-|context:' + item.post.uri,
      )
      assert.deepEqual(
        afterLoading.keys.slice(0, incoming.length),
        expectedNew,
        'Every new occurrence is in API order, without a middle gap',
      )
      assert.deepEqual(
        afterLoading.keys.slice(incoming.length),
        before.keys,
        'All original rows remain below the bridge',
      )
      assert.ok(
        controls.timelineRequests
          .slice(loadRequests)
          .filter(call => call.limit === 30).length >= 7,
      )
      assert.deepEqual(afterLoading.place, before.place)
      assert.deepEqual(
        await cloud(),
        cloudBefore,
        'Fetching/prepending must not advance cloud reading progress',
      )
      assert.equal(
        await current.evaluate(
          key => localStorage.getItem(key),
          'skyanchor:return:v1:' + did,
        ),
        null,
      )
      report.measurements.push({
        name: `${index ? 'WebKit' : 'Chromium'} actual arrow 151 new occurrences / five pages + racing head`,
        before: before.top,
        after: afterLoading.top,
        deltaCSSPx: Math.abs(afterLoading.top - before.top),
        thresholdCSSPx: 2,
        maximumFrameDriftCSSPx: maximumDrift,
        sampledFrames: samples.length,
      })

      // Depart in the same JavaScript turn as a scroll, before any RAF/debounced capture.
      for (const movement of [-183, -117]) {
        const departure = await current.evaluate(movement => {
          window.scrollBy(0, movement)
          const header = document.querySelector(
            '[data-testid="mobileHomeHeader"]',
          )
          const bottom = header?.getClientRects().length
            ? header.getBoundingClientRect().bottom
            : 0
          const row = [
            ...document.querySelectorAll('[data-skyanchor-key]'),
          ].find(
            node =>
              node.getClientRects().length &&
              node.getBoundingClientRect().bottom > bottom + 1,
          )
          const record = {
            key: row.dataset.skyanchorKey,
            top: row.getBoundingClientRect().top,
          }
          row.querySelector('a[href*="/post/"]').click()
          return record
        }, movement)
        await current.waitForURL(/\/post\//)
        await current
          .getByTestId('postThreadItem-by-reader.test')
          .filter({visible: true})
          .first()
          .waitFor()
        if (movement === -183) {
          const firstThread = current.url()
          await current
            .locator('a[href*="/post/post23"]')
            .filter({visible: true})
            .first()
            .click()
          await current.waitForURL(/\/post\/post23/)
          await current
            .getByTestId('postThreadItem-by-reader.test')
            .filter({visible: true})
            .first()
            .waitFor()
          await current.goBack()
          await current.waitForURL(firstThread)
          await current
            .getByTestId('postThreadItem-by-reader.test')
            .filter({visible: true})
            .first()
            .waitFor()
        }
        await current.goBack()
        await current.getByTestId('skyanchor-reading-button').waitFor()
        await current.waitForTimeout(600)
        const restoredTop = await current
          .locator('[data-skyanchor-key]')
          .evaluateAll(
            (nodes, key) =>
              nodes
                .find(node => node.dataset.skyanchorKey === key)
                ?.getBoundingClientRect().top,
            departure.key,
          )
        assert.ok(
          Math.abs(restoredTop - departure.top) <= 2,
          `Immediate pre-RAF departure must restore exactly: ${JSON.stringify({departure, restoredTop})}`,
        )
        report.measurements.push({
          name: `${index ? 'WebKit' : 'Chromium'} immediate scroll/post/Back ${movement}`,
          before: departure.top,
          after: restoredTop,
          deltaCSSPx: Math.abs(restoredTop - departure.top),
          thresholdCSSPx: 2,
        })
        assert.deepEqual(
          (await snapshot()).keys.slice(0, incoming.length),
          expectedNew,
        )
        if (movement === -183) {
          await current
            .locator('[data-skyanchor-key]')
            .first()
            .evaluate(node => {
              const late = document.createElement('div')
              late.dataset.fixtureLateBack = 'true'
              late.style.height = '120px'
              node.prepend(late)
            })
          await current.waitForTimeout(300)
          const lateTop = await current
            .locator('[data-skyanchor-key]')
            .evaluateAll(
              (nodes, key) =>
                nodes
                  .find(node => node.dataset.skyanchorKey === key)
                  ?.getBoundingClientRect().top,
              departure.key,
            )
          assert.ok(
            Math.abs(lateTop - departure.top) <= 2,
            'Late row layout after nested Back must preserve the immediate departure anchor',
          )
          await current
            .locator('[data-fixture-late-back]')
            .evaluate(node => node.remove())
          await current.waitForTimeout(300)
        }
      }

      // Prove natural upward reading reaches every inserted row and retains older pagination.
      for (let i = incoming.length - 1; i >= 0; i--) {
        const row = current.locator(`[data-skyanchor-key="${expectedNew[i]}"]`)
        await row.scrollIntoViewIfNeeded()
        await expect(row).toBeInViewport()
      }
      await current.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      )
      await expect
        .poll(async () => (await snapshot()).keys.length)
        .toBeGreaterThan(afterLoading.keys.length)
      await current
        .locator(`[data-skyanchor-key="${before.place.anchor}"]`)
        .scrollIntoViewIfNeeded()
      await current.waitForTimeout(350)
      const beforeUnavailable = await snapshot()
      controls.setTimeline(
        Array.from({length: 100}, (_, i) => ({post: post(2500 + i)})),
      )
      await readingAction(current, 'Refresh')
      await readingPanel(current)
      await expect(current.getByTestId('skyanchor-fallback')).toContainText(
        'Could not connect all newer history',
      )
      await closeReadingPanel(current)
      const unavailable = await snapshot()
      assert.deepEqual(unavailable.keys, beforeUnavailable.keys)
      assert.deepEqual(unavailable.place, beforeUnavailable.place)

      controls.setTimeline(
        Array.from({length: 180}, (_, i) => ({post: post(3000 + i)})).concat(
          incoming,
          initial,
        ),
      )
      held = controls.holdTimeline(30, 30)
      await readingAction(current, 'Load new posts without moving your place')
      await held.reached
      await current.evaluate(() => window.dispatchEvent(new Event('wheel')))
      held.release()
      held = undefined
      await readingPanel(current)
      await expect(current.getByTestId('skyanchor-fallback')).toContainText(
        'Loading cancelled',
      )
      await closeReadingPanel(current)
      assert.deepEqual(
        (await snapshot()).keys,
        beforeUnavailable.keys,
        'A cancelled multi-batch bridge must not insert a partial prefix',
      )
      await readingPanel(current)
      await expect(current.getByTestId('skyanchor-new')).toHaveCount(0)
      await expect(
        current.getByRole('button', {name: 'Return to my place', exact: true}),
      ).toHaveCount(0)
      await closeReadingPanel(current)

      // The old head is already known, but its new repost is a distinct occurrence.
      const repost = {
        post: initial[0].post,
        reason: {
          $type: 'app.bsky.feed.defs#reasonRepost',
          by: initial[1].post.author,
          indexedAt: new Date().toISOString(),
        },
      }
      controls.setTimeline([repost, ...incoming, ...initial])
      await current.clock.fastForward(60_000)
      await expect(arrow).toBeVisible()
      const bufferedRefresh = current.waitForResponse(response => {
        const url = new URL(response.url())
        return (
          url.pathname.endsWith('/app.bsky.feed.getTimeline') &&
          url.searchParams.get('limit') === '30' &&
          !url.searchParams.has('cursor')
        )
      })
      await readingAction(current, 'Refresh')
      await (await bufferedRefresh).finished()
      await readingPanel(current)
      await expect(
        current.getByRole('button', {name: 'Refresh', exact: true}),
      ).toBeEnabled()
      await closeReadingPanel(current)
      const bufferedCalls = controls.timelineRequests.filter(
        call => call.limit !== 1 && call.index === 0,
      ).length
      controls.setTimeline([
        {post: post(-200)},
        repost,
        ...incoming,
        ...initial,
      ])
      await readingAction(current, 'Load new posts without moving your place')
      await expect
        .poll(
          () =>
            controls.timelineRequests.filter(
              call => call.limit !== 1 && call.index === 0,
            ).length,
        )
        .toBeGreaterThanOrEqual(bufferedCalls + 2)
      await expect(
        current.getByTestId('skyanchor-reading-button'),
      ).not.toHaveAccessibleName(/Loading new posts/)
      await expect(current.getByTestId('loadLatestBtn')).toHaveCount(0)
      await current.evaluate(() => window.scrollTo(0, 0))
      await expect(
        current.getByTestId('skyanchor-reading-button'),
      ).toBeInViewport()
      await readingAction(current, 'Refresh')
      await readingPanel(current)
      await expect(
        current.getByRole('button', {name: 'Refresh', exact: true}),
      ).toBeEnabled()
      await expect(current.getByTestId('skyanchor-new')).toHaveCount(0)
      await closeReadingPanel(current)
      await expect(arrow).toHaveCount(0)

      assert.ok(Math.abs(await current.evaluate(() => scrollY)) <= 2)
      controls.setTimeline([
        {post: post(-202)},
        {post: post(-200)},
        repost,
        ...incoming,
        ...initial,
      ])
      await current.clock.fastForward(60_000)
      await expect(arrow).toBeVisible()
      assert.ok(
        Math.abs(await current.evaluate(() => scrollY)) <= 2,
        'New content is discoverable even at the current top without scrolling',
      )
      await current.getByTestId('homeScreenFeedTabs-selector-1').click()
      await expect(arrow).toHaveCount(0)
      await current.getByTestId('homeScreenFeedTabs-selector-0').click()
      await expect(arrow).toBeVisible()
      await arrow.click()
      await expect(arrow).toHaveCount(0)

      controls.setTimeline([
        {post: post(-203)},
        {post: post(-202)},
        {post: post(-200)},
        repost,
        ...incoming,
        ...initial,
      ])
      held = controls.holdTimeline()
      await current.clock.fastForward(60_000)
      await held.reached
      await current
        .locator('[data-skyanchor-key] a[href*="/profile/"]')
        .filter({hasText: 'Fixture Reader'})
        .first()
        .click()
      held.release()
      held = undefined
      await current.waitForTimeout(200)
      await expect(current.getByTestId('loadLatestBtn')).toHaveCount(0)
      await expect(
        current.locator(
          '[data-skyanchor-reading-slot="following"] [data-testid="skyanchor-reading-button"]',
        ),
      ).toHaveCount(0)
      assert.deepEqual(
        failures,
        [],
        'New-content fixture has no runtime or unexpected HTTP failures',
      )
      report.checks.push(
        `Production ${index === 0 ? 'desktop' : 'phone WebKit'}: 60s non-inserting discovery, actual arrow loads 151 ordered occurrences across five pages including a racing fresh head with <=2px per-frame drift and unchanged cloud place, immediate pre-RAF post/Back twice including nested reply Back and late row layout, natural upward traversal, retained older pagination, cancellation/no-overlap preservation, fresh revalidation, repost detection, no-new silence and stale navigated poll discarded.`,
      )
    } catch (error) {
      const current = context.pages()[0]
      report.newContentFailure = {
        engine: index === 0 ? 'desktop' : 'phone WebKit',
        failures,
        ui: current ? await current.locator('body').innerText() : '',
        geometry: current
          ? await current.evaluate(() => ({
              y: scrollY,
              header: document
                .querySelector('[data-testid="mobileHomeHeader"]')
                ?.getBoundingClientRect()
                .toJSON(),
              localPlaces: Object.fromEntries(
                Object.entries(localStorage).filter(([key]) =>
                  key.startsWith('skyanchor:following:v1:'),
                ),
              ),
            }))
          : undefined,
      }
      throw error
    } finally {
      held?.release()
      await context.close()
    }
  }
}
