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

async function holdReadingCapture(page) {
  await page.evaluate(() => {
    const request = window.requestAnimationFrame
    const cancel = window.cancelAnimationFrame
    const held = new Map()
    let paused = true
    window.requestAnimationFrame = callback => {
      const id = request.call(window, time => {
        if (paused) held.set(id, () => callback(time))
        else callback(time)
      })
      return id
    }
    window.cancelAnimationFrame = id => {
      held.delete(id)
      cancel.call(window, id)
    }
    window.fixtureReadingRace = {
      scrolled: false,
      pending: () => held.size,
      release() {
        paused = false
        window.requestAnimationFrame = request
        window.cancelAnimationFrame = cancel
        for (const callback of held.values()) callback()
        held.clear()
      },
    }
    addEventListener(
      'scroll',
      () => {
        window.fixtureReadingRace.scrolled = true
      },
      {once: true},
    )
    dispatchEvent(new Event('touchstart'))
    scrollBy(0, 61)
  })
  await page.waitForFunction(
    () =>
      window.fixtureReadingRace.scrolled &&
      window.fixtureReadingRace.pending() > 0,
    undefined,
    {polling: 20},
  )
}

async function releaseReadingCapture(page) {
  await page.evaluate(() => {
    window.fixtureReadingRace.release()
    dispatchEvent(new Event('touchcancel'))
  })
}

export async function verifyThreadBack({
  desktopBrowser,
  phoneBrowser,
  mockUpstream,
  signIn,
  report,
  installViewportFixture,
  worker,
  entries,
}) {
  for (const [index, browser] of [
    [1, phoneBrowser],
    [0, desktopBrowser],
  ]) {
    const context = await browser.newContext({
      ...(index
        ? devices['iPhone 13']
        : {viewport: {width: 1280, height: 900}}),
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    try {
      if (index) {
        await context.addInitScript(installViewportFixture)
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'platform', {get: () => 'iPhone'})
        })
      }
      const did = index
        ? 'did:plc:kkkkkkkkkkkkkkkkkkkkkkkk'
        : 'did:plc:llllllllllllllllllllllll'
      const controls = await mockUpstream(context, did)
      const timeline = entries
        .filter(item => !item.reply)
        .map(item => ({
          ...item,
          post: {
            ...item.post,
            uri: item.post.uri.replace(
              /\/post(\d+)$/,
              (_, number) => `/post${6000 + Number(number)}`,
            ),
          },
        }))
      controls.setTimeline(timeline)
      const reply = timeline.find(item =>
        item.post.uri.endsWith('/post6023'),
      ).post
      controls.setThreadReply(reply)
      const page = await context.newPage()
      const writes = []
      const coldReloadWrites = []
      const failures = []
      page.on('pageerror', error => failures.push(error.message))
      let navigationOnly = false
      let coldReload = false
      page.on('request', request => {
        if (
          navigationOnly &&
          new URL(request.url()).pathname.startsWith('/api/skyanchor/') &&
          request.method() !== 'GET'
        )
          (coldReload ? coldReloadWrites : writes).push(
            `${request.method()} ${new URL(request.url()).pathname}`,
          )
      })
      await signIn(page)
      await page.evaluate(() => {
        window.fixtureThreadDepartures = 0
        addEventListener(
          'skyanchor-before-navigation',
          () => window.fixtureThreadDepartures++,
        )
      })
      const cloudBytes = async () => ({
        place: await worker.db
          .prepare("SELECT * FROM places WHERE did = ? AND feed = 'following'")
          .bind(did)
          .first(),
        clock: await worker.db
          .prepare('SELECT revision, nonce FROM clock WHERE id = 1')
          .first(),
      })
      const measure = () =>
        page.evaluate(() => {
          const header = document.querySelector(
            '[data-testid="mobileHomeHeader"]',
          )
          const bottom = header?.getClientRects().length
            ? header.getBoundingClientRect().bottom
            : 0
          const rows = [...document.querySelectorAll('[data-skyanchor-key]')]
          const row = rows.find(
            node =>
              node.getClientRects().length &&
              node.getBoundingClientRect().bottom > bottom + 1,
          )
          return {
            key: row?.dataset.skyanchorKey,
            offset: row?.getBoundingClientRect().top - bottom,
          }
        })
      const local = () =>
        page.evaluate(() => {
          const entry = Object.entries(localStorage).find(([key]) =>
            key.startsWith('skyanchor:following:v1:'),
          )
          return entry ? JSON.parse(entry[1]).place : null
        })
      const protectedBytes = () =>
        page.evaluate(() =>
          Object.fromEntries(
            Object.entries(localStorage).filter(([key]) =>
              /^skyanchor:(return|revision|history|historic-local|sharing)/.test(
                key,
              ),
            ),
          ),
        )
      await page
        .getByTestId('postText')
        .filter({hasText: 'Fixture post 20.'})
        .first()
        .scrollIntoViewIfNeeded()
      await scrollReading(page, 61)
      await expect
        .poll(async () => (await local())?.anchor === (await measure()).key)
        .toBe(true)
      const old = await local()
      assert.equal(
        (await cloudBytes()).place,
        null,
        'Thread Back setup must not inherit another scenario account or cloud place',
      )
      await readingAction(page, 'Connect private sync')
      await closeReadingPanel(page)
      const initialHistory = await page.evaluate(() => history.length)
      for (const [visit, kind] of [
        'card',
        'timestamp',
        'card',
        'keyboard',
      ].entries()) {
        await scrollReading(page, -183 - visit * 47)
        const panel = await readingPanel(page)
        const keepMine = panel.getByRole('button', {
          name: 'Keep mine',
          exact: true,
        })
        await panel
          .getByRole('button', {
            name: (await keepMine.isVisible()) ? 'Keep mine' : 'Save my place',
            exact: true,
          })
          .click()
        await expect
          .poll(
            async () => {
              const place = await local()
              return (await cloudBytes()).place?.state === JSON.stringify(place)
            },
            {
              message:
                'Fixture reading must be confirmed before measuring navigation-only writes',
            },
          )
          .toBe(true)
        await expect(panel).toContainText(
          'Current local place confirmed shared',
        )
        await closeReadingPanel(page)
        const cloudBefore = await cloudBytes()
        const protectedBefore = await protectedBytes()
        if (visit === 0) {
          navigationOnly = true
          const sourceURL = page.url()
          await holdReadingCapture(page)
          const coldDeparture = await measure()
          try {
            await page.evaluate(() => {
              const row = [
                ...document.querySelectorAll('[data-skyanchor-key]'),
              ].find(node => {
                const rect = node.getBoundingClientRect()
                return (
                  node.getClientRects().length &&
                  rect.top >= 160 &&
                  rect.bottom < innerHeight - 80
                )
              })
              const link = row?.querySelector('a[href*="/post/"]')
              if (!link)
                throw new Error('Cold departure requires a visible post link')
              link.click()
            })
          } finally {
            await releaseReadingCapture(page)
          }
          await page.waitForURL(/\/post\//)
          const durableDeparture = await local()
          coldReload = true
          const renewed = page.waitForResponse(
            response =>
              response.request().method() === 'POST' &&
              new URL(response.url()).pathname === '/api/skyanchor/session',
          )
          await page.reload()
          await page
            .getByTestId('postThreadItem-by-reader.test')
            .filter({visible: true})
            .first()
            .waitFor()
          await page.goBack()
          await page.waitForURL(sourceURL)
          await page.getByTestId('skyanchor-reading-button').waitFor()
          await page.waitForTimeout(500)
          assert.equal((await renewed).status(), 200)
          assert.deepEqual(
            coldReloadWrites,
            ['POST /api/skyanchor/session'],
            'A cold document renews its in-memory sync session, never reading progress',
          )
          coldReload = false
          const coldRestored = await measure()
          assert.equal(coldRestored.key, coldDeparture.key)
          assert.ok(
            Math.abs(coldRestored.offset - coldDeparture.offset) <= 2,
            `Reload while in thread must retain the immediate departure: ${JSON.stringify({coldDeparture, coldRestored})}`,
          )
          assert.equal(
            durableDeparture?.anchor,
            coldDeparture.key,
            'Immediate departure must persist its pending local occurrence',
          )
          assert.ok(
            Math.abs(durableDeparture.offset - coldDeparture.offset) <= 2,
            `Immediate departure must persist its pending offset: ${JSON.stringify({coldDeparture, durableDeparture})}`,
          )
          report.measurements.push({
            name: `${index ? 'WebKit' : 'Chromium'} pending capture departure, thread reload and cold Back`,
            departure: coldDeparture,
            restored: coldRestored,
            thresholdCSSPx: 2,
          })
          assert.deepEqual(await protectedBytes(), protectedBefore)
          assert.deepEqual(await cloudBytes(), cloudBefore)
          const viewport = page.viewportSize()
          await holdReadingCapture(page)
          try {
            const beforeResize = await measure()
            await page.setViewportSize({
              ...viewport,
              height: viewport.height - 70,
            })
            await page.waitForTimeout(100)
            const afterResize = await measure()
            assert.equal(
              afterResize.key,
              beforeResize.key,
              'Real viewport resize before the reading RAF preserves occurrence',
            )
            assert.ok(
              Math.abs(afterResize.offset - beforeResize.offset) <= 2,
              `Real resize before reading RAF must not rewind: ${JSON.stringify({beforeResize, afterResize})}`,
            )
            report.measurements.push({
              name: `${index ? 'WebKit' : 'Chromium'} real viewport resize before reading RAF`,
              beforeResize,
              afterResize,
              thresholdCSSPx: 2,
            })
          } finally {
            await releaseReadingCapture(page)
          }
          await page.waitForTimeout(300)
          const resized = await measure()
          await expect
            .poll(async () => {
              const place = await local()
              return (
                place?.anchor === resized.key &&
                Math.abs(place.offset - resized.offset) <= 2
              )
            })
            .toBe(true)
          await page.setViewportSize(viewport)
          await page.waitForTimeout(300)
          assert.deepEqual(await protectedBytes(), protectedBefore)
          assert.deepEqual(await cloudBytes(), cloudBefore)
          await page.evaluate(() => {
            window.fixtureThreadDepartures = 0
            addEventListener(
              'skyanchor-before-navigation',
              () => window.fixtureThreadDepartures++,
            )
          })
          navigationOnly = false
        }
        const departure = await measure()
        assert.ok(departure.key)
        const tapKey = await page
          .locator('[data-skyanchor-key]')
          .evaluateAll(nodes => {
            const row = nodes.find(node => {
              const rect = node.getBoundingClientRect()
              return (
                node.getClientRects().length &&
                rect.top >= 160 &&
                rect.bottom < innerHeight - 80
              )
            })
            if (!row)
              throw new Error(
                'Fixture requires a fully visible post for native activation',
              )
            return row.dataset.skyanchorKey
          })
        const row = page.locator(`[data-skyanchor-key="${tapKey}"]`)
        const target =
          kind === 'card'
            ? row.getByTestId('postText').first()
            : row.locator('a[href*="/post/"]').first()
        if (visit === 0) {
          const sourceURL = page.url()
          await page.evaluate(() =>
            document.addEventListener(
              'click',
              event => event.preventDefault(),
              {once: true, capture: true},
            ),
          )
          if (index) await target.tap()
          else await target.click()
          assert.equal(
            page.url(),
            sourceURL,
            'Cancelled activation stays at the source',
          )
          assert.equal(
            await page.evaluate(() => window.fixtureThreadDepartures),
            0,
          )
          if (!index) {
            const popupPromise = page.waitForEvent('popup')
            await row
              .locator('a[href*="/post/"]')
              .first()
              .click({modifiers: ['Control']})
            const popup = await popupPromise
            await popup.close()
            assert.equal(
              page.url(),
              sourceURL,
              'New-tab activation cannot depart the source',
            )
            assert.equal(
              await page.evaluate(() => window.fixtureThreadDepartures),
              0,
            )
          }
        }
        navigationOnly = true
        if (kind === 'keyboard') {
          await target.focus()
          await page.keyboard.press('Enter')
        } else if (index) await target.tap()
        else await target.click()
        await page.waitForURL(/\/post\//)
        await page
          .getByTestId('postThreadItem-by-reader.test')
          .filter({visible: true})
          .first()
          .waitFor()
        if (visit === 1) {
          const firstThread = page.url()
          await page
            .locator('a[href*="/post/post6023"]')
            .filter({visible: true})
            .first()
            .click()
          await page.waitForURL(/\/post\/post6023/)
          await page.goBack()
          await page.waitForURL(firstThread)
        }
        if (visit >= 2) {
          await page
            .getByRole('button', {name: 'Go back', exact: true})
            .filter({visible: true})
            .first()
            .click()
        } else {
          if (index)
            await page.evaluate(() => dispatchEvent(new Event('touchstart')))
          await page.goBack()
        }
        await page.getByTestId('skyanchor-reading-button').waitFor()
        await page.waitForTimeout(300)
        const restored = await measure()
        assert.equal(
          restored.key,
          departure.key,
          `${kind} Back restores the visible occurrence`,
        )
        assert.ok(
          Math.abs(restored.offset - departure.offset) <= 2,
          `Back offset: ${JSON.stringify({departure, restored})}`,
        )
        assert.deepEqual(await protectedBytes(), protectedBefore)
        assert.deepEqual(await cloudBytes(), cloudBefore)
        // No new contact: this is continued native viewport movement after POP,
        // not a new wheel/touchstart that would reset a stuck correction.
        if (index)
          await page.evaluate(() => dispatchEvent(new Event('touchend')))
        for (const delta of [11, 9, 13, 7, 17]) {
          await page.evaluate(delta => window.scrollBy(0, delta), delta)
          await page.waitForTimeout(80)
        }
        await page.waitForTimeout(300)
        const continued = await measure()
        await expect
          .poll(
            async () => {
              const place = await local()
              return (
                place?.anchor === continued.key &&
                Math.abs(place.offset - continued.offset) <= 2
              )
            },
            {
              message:
                'Reading after Back must autosave, without a new touchstart',
            },
          )
          .toBe(true)
        await page
          .locator('[data-skyanchor-key]')
          .first()
          .evaluate(node => {
            const late = document.createElement('div')
            late.dataset.fixtureThreadLate = 'true'
            late.style.height = '97px'
            node.prepend(late)
          })
        await page.waitForTimeout(300)
        const late = await measure()
        assert.equal(late.key, continued.key)
        assert.ok(
          Math.abs(late.offset - continued.offset) <= 2,
          'Late layout must follow resumed reading, not the previous departure/checkpoint',
        )
        await page
          .locator('[data-fixture-thread-late]')
          .evaluate(node => node.remove())
        await page.waitForTimeout(300)
        assert.deepEqual(
          await cloudBytes(),
          cloudBefore,
          'Back, passive continued momentum and layout cannot grant cloud sharing intent',
        )
        assert.deepEqual(await protectedBytes(), protectedBefore)
        report.measurements.push({
          name: `${index ? 'WebKit' : 'Chromium'} native ${kind} repeated Back ${visit}`,
          departure,
          restored,
          continued,
          late,
          thresholdCSSPx: 2,
        })
        navigationOnly = false
      }
      assert.notEqual((await local()).anchor, old.anchor)
      assert.deepEqual(writes, [], 'Navigation alone cannot write private sync')
      assert.deepEqual(failures, [])
      assert.equal(
        await page.evaluate(() => history.length),
        initialHistory + 1,
      )
      report.checks.push(
        `${index ? 'Phone WebKit' : 'Chromium'} pending reading survives real viewport resize and immediate departure/thread reload/cold Back within 2px; local window persists without progress writes or Return/history/pause mutation. Cold restart performs exactly one successful session renewal; ordinary navigation performs no private writes.`,
      )
      report.checks.push(
        `${index ? 'Phone WebKit' : 'Chromium'} native card/timestamp and keyboard activation, nested history POP and app Back restore exact occurrence/offset; continued momentum autosaves and late layout follows current reading, without Return/history/cloud writes.`,
      )
    } finally {
      await context.close()
    }
  }
}

export async function verifySettlement({
  phoneBrowser,
  mockUpstream,
  signIn,
  worker,
  report,
  entries,
}) {
  const did = 'did:plc:nnnnnnnnnnnnnnnnnnnnnnnn'
  const timeline = JSON.parse(
    JSON.stringify(entries).replaceAll(entries[0].post.author.did, did),
  )
  const contexts = []
  const placementFailures = []
  const placeKey = 'skyanchor:following:v1:' + did
  const localPlace = page =>
    page.evaluate(key => JSON.parse(localStorage.getItem(key))?.place, placeKey)
  const cloud = async () => ({
    place: await worker.db
      .prepare("SELECT * FROM places WHERE did = ? AND feed = 'following'")
      .bind(did)
      .first(),
    clock: await worker.db.prepare('SELECT * FROM clock').first(),
    history: (
      await worker.db
        .prepare(
          'SELECT * FROM reading_history WHERE did = ? ORDER BY revision',
        )
        .bind(did)
        .all()
    ).results,
  })
  async function fresh() {
    const context = await phoneBrowser.newContext({
      ...devices['iPhone 13'],
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    contexts.push(context)
    const controls = await mockUpstream(context, did)
    controls.setTimeline(timeline)
    const page = await context.newPage()
    await signIn(page, 'reader.test')
    return page
  }
  async function trace(page, place) {
    await page.evaluate(place => {
      window.fixtureSettlement = []
      window.fixtureSettlementActive = true
      const sample = () => {
        if (!window.fixtureSettlementActive) return
        const row = [...document.querySelectorAll('[data-skyanchor-key]')].find(
          node => node.dataset.skyanchorKey === place.anchor,
        )
        const header = document.querySelector(
          '[data-testid="mobileHomeHeader"]',
        )
        const bottom = header?.getClientRects().length
          ? header.getBoundingClientRect().bottom
          : 0
        if (window.fixtureSettlement.length < 100)
          window.fixtureSettlement.push({
            y: scrollY,
            max:
              document.documentElement.scrollHeight -
              document.documentElement.clientHeight,
            header: bottom,
            top: row?.getBoundingClientRect().top,
            delta: row
              ? row.getBoundingClientRect().top - bottom - place.offset
              : null,
            viewport: {
              height: visualViewport?.height,
              top: visualViewport?.offsetTop,
            },
          })
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }, place)
  }
  async function restored(page, place, name, historical = false) {
    const result = page.getByTestId('skyanchor-resume-result')
    try {
      await expect(result).toContainText(
        historical
          ? 'Restored this saved place locally:'
          : 'Confirmed locally.',
      )
      await page
        .locator('[data-skyanchor-key]')
        .first()
        .evaluate(node => {
          const late = document.createElement('div')
          late.dataset.fixtureSettlementLate = 'true'
          late.style.height = '97px'
          node.prepend(late)
        })
      await page.waitForTimeout(300)
      const geometry = await page.evaluate(place => {
        window.fixtureSettlementActive = false
        const row = [...document.querySelectorAll('[data-skyanchor-key]')].find(
          node => node.dataset.skyanchorKey === place.anchor,
        )
        const header = document.querySelector(
          '[data-testid="mobileHomeHeader"]',
        )
        return {
          error: row
            ? Math.abs(
                row.getBoundingClientRect().top -
                  (header?.getClientRects().length
                    ? header.getBoundingClientRect().bottom
                    : 0) -
                  place.offset,
              )
            : null,
          trace: window.fixtureSettlement,
        }
      }, place)
      assert.notEqual(geometry.error, null)
      assert.ok(geometry.error <= 2)
      assert.deepEqual(await localPlace(page), place)
      report.measurements.push({name, ...geometry, thresholdCSSPx: 2})
      await page
        .locator('[data-fixture-settlement-late]')
        .evaluate(node => node.remove())
      await page.waitForTimeout(300)
    } catch (error) {
      console.error(
        'Synthetic settlement failure:',
        JSON.stringify({
          name,
          place,
          result: await result.textContent(),
          geometry: await page.evaluate(() => ({
            first: window.fixtureSettlement.slice(0, 3),
            last: window.fixtureSettlement.slice(-3),
            deltas: [
              ...new Set(window.fixtureSettlement.map(sample => sample.delta)),
            ],
          })),
        }),
      )
      placementFailures.push(error.message)
    }
  }
  try {
    const source = await fresh()
    await source
      .getByTestId('postText')
      .filter({hasText: 'Fixture post 20.'})
      .first()
      .scrollIntoViewIfNeeded()
    await scrollReading(source, 61)
    await readingAction(source, 'Connect private sync')
    await closeReadingPanel(source)
    // Fractional layout before Save, removed before recovery re-renders the window.
    await source
      .locator('[data-skyanchor-scope]')
      .first()
      .evaluate(node => {
        node.style.transform = 'translateY(0.5px)'
      })
    await readingAction(source, 'Save my place')
    await expect
      .poll(async () => typeof (await cloud()).place?.state)
      .toBe('string')
    const saved = JSON.parse((await cloud()).place.state)
    assert.ok(Math.abs(saved.offset % 1) > 0.25)
    await closeReadingPanel(source)
    await source
      .locator('[data-skyanchor-scope]')
      .first()
      .evaluate(node => {
        node.style.transform = ''
      })
    await source.evaluate(() => scrollBy(0, 900))
    await source.waitForTimeout(300)
    await readingAction(source, 'Check saved places')
    const device = await source.evaluate(() =>
      localStorage.getItem('skyanchor:device'),
    )
    await source
      .getByRole('combobox', {name: 'Source of saved place', exact: true})
      .click()
    await source
      .getByRole('option')
      .filter({hasText: '[' + device.slice(0, 4) + ']'})
      .click()
    const baseline = await cloud()
    await trace(source, saved)
    await readingAction(source, 'Resume saved place')
    await restored(
      source,
      saved,
      'WebKit own-profile fractional checkpoint settlement',
      true,
    )
    assert.deepEqual(await cloud(), baseline)
    if (!placementFailures.length) {
      const paused = await source.evaluate(
        did => localStorage.getItem('skyanchor:historic-local:' + did),
        did,
      )
      assert.ok(
        paused,
        'Own-browser historical restore must retain sharing pause',
      )
      await closeReadingPanel(source)
      await scrollReading(source, 73)
      await source.evaluate(() => {
        dispatchEvent(new Event('resize'))
        dispatchEvent(new Event('focus'))
      })
      await source.waitForTimeout(1000)
      assert.notDeepEqual(await localPlace(source), saved)
      assert.equal(
        await source.evaluate(
          did => localStorage.getItem('skyanchor:historic-local:' + did),
          did,
        ),
        paused,
      )
      assert.deepEqual(await cloud(), baseline)
    }
    const receiver = await fresh()
    await readingAction(receiver, 'Connect private sync')
    await trace(receiver, saved)
    await readingAction(receiver, 'Resume other device')
    await restored(
      receiver,
      saved,
      'WebKit explicit shared fractional checkpoint settlement',
    )
    assert.deepEqual(await cloud(), baseline)
    assert.deepEqual(placementFailures, [])
    report.checks.push(
      'Phone WebKit own-profile history and shared Resume accept the exact fractional checkpoint within browser precision, persist its original bytes, and never write cloud progress; historical reading/foreground retain sharing pause.',
    )
  } finally {
    for (const context of contexts) await context.close()
  }
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
    const privateRequests = []
    const privateRequestIds = new Map()
    let immediatePhase
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
      current.on('request', request => {
        const url = new URL(request.url())
        if (!url.pathname.startsWith('/api/skyanchor/')) return
        const entry = {
          id: privateRequests.length,
          phase: immediatePhase,
          method: request.method(),
          path: url.pathname,
          request:
            url.pathname === '/api/skyanchor/place' &&
            request.method() === 'PUT'
              ? request.postDataJSON()
              : undefined,
        }
        privateRequestIds.set(request, entry)
        privateRequests.push(entry)
        void request.allHeaders().then(
          headers => {
            entry.cookiePresent = !!headers.cookie
          },
          error => {
            entry.headersError = error.message
          },
        )
      })
      current.on('requestfailed', request => {
        const entry = privateRequestIds.get(request)
        if (entry) entry.failed = request.failure()?.errorText
      })
      current.on('pageerror', error => failures.push(error.message))
      current.on('response', response => {
        const entry = privateRequestIds.get(response.request())
        if (entry) {
          entry.status = response.status()
          if (entry.path === '/api/skyanchor/place')
            void response.json().then(
              value => {
                entry.response = value
              },
              error => {
                entry.responseError = error.message
              },
            )
        }
        if (
          response.status() >= 400 &&
          !response.url().includes('com.atproto.repo.getRecord')
        )
          failures.push(`${response.status()} ${response.url().split('?')[0]}`)
      })
      // Only these disposable pages advance time; composer and three-device clocks stay real.
      await current.clock.install()
      await signIn(current)
      await expect
        .poll(() =>
          current.evaluate(
            () =>
              JSON.parse(
                localStorage.getItem('bsky_device\\geolocationServiceResponse'),
              )?.data?.countryCode,
          ),
        )
        .toBe('CA')
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
            "SELECT did, feed, state, revision, device, updated FROM places WHERE did = ? AND feed = 'following'",
          )
          .bind(did)
          .first()
      const cloudBytes = async () => ({
        place: await cloud(),
        clock: await worker.db
          .prepare('SELECT revision, nonce FROM clock WHERE id = 1')
          .first(),
      })
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
      await current.evaluate(did => {
        window.fixtureTopTrace = []
        const trace = (phase, extra = {}) => {
          if (window.fixtureTopTrace.length >= 150) return
          const header = document.querySelector(
            '[data-testid="mobileHomeHeader"]',
          )
          const bottom = header?.getBoundingClientRect().bottom ?? 0
          const rows = [...document.querySelectorAll('[data-skyanchor-key]')]
          const row = rows.find(
            node => node.getBoundingClientRect().bottom > bottom + 1,
          )
          window.fixtureTopTrace.push({
            phase,
            now: Date.now(),
            ticks: performance.now(),
            visibility: document.visibilityState,
            y: scrollY,
            header: bottom,
            anchor: row?.dataset.skyanchorKey,
            top: row?.getBoundingClientRect().top,
            account: row
              ?.closest('[data-skyanchor-account]')
              ?.getAttribute('data-skyanchor-account'),
            feed: row
              ?.closest('[data-skyanchor-feed]')
              ?.getAttribute('data-skyanchor-feed'),
            scope: row
              ?.closest('[data-skyanchor-scope]')
              ?.getAttribute('data-skyanchor-scope'),
            local: JSON.parse(
              localStorage.getItem('skyanchor:following:v1:' + did),
            )?.place,
            dialog: !!document.querySelector(
              '[data-testid="skyanchor-toolbar"]',
            ),
            body: {
              position: document.body.style.position,
              top: document.body.style.top,
            },
            ...extra,
          })
        }
        window.fixtureTraceTop = trace
        for (const method of ['scrollTo', 'scrollBy']) {
          const original = window[method]
          window[method] = function (...args) {
            trace(method, {args, stack: new Error().stack})
            return original.apply(this, args)
          }
        }
        addEventListener('scroll', () => trace('scroll'))
        for (const event of ['focus', 'blur', 'online', 'resize', 'scrollend'])
          addEventListener(event, () => trace(event))
        addEventListener('keydown', event =>
          trace('keydown', {
            key: event.key,
            target: event.target?.tagName,
            role: event.target?.getAttribute?.('role'),
            prevented: event.defaultPrevented,
          }),
        )
        document.addEventListener('visibilitychange', () => trace('visibility'))
        addEventListener('skyanchor-place', event =>
          trace('capture', {detail: event.detail}),
        )
        trace('before-top')
      }, did)
      await current.evaluate(() => {
        // Drain a pending source capture before testing the no-pending branch.
        dispatchEvent(new Event('scroll'))
        return new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        )
      })
      // Expire the 250 ms reading-intent guard after draining actual capture RAFs.
      await current.clock.runFor(251)
      const beforePassiveTop = await cloudBytes()
      const passiveCorrection = await current.evaluate(() => {
        window.fixtureTraceTop('settled-before-passive-top')
        const before = window.fixtureTopTrace.at(-1)
        window.scrollTo(0, 0)
        // A layout correction may run before passive scroll capture reaches RAF.
        dispatchEvent(new Event('resize'))
        window.fixtureTraceTop('passive-top-resize')
        return {before, after: window.fixtureTopTrace.at(-1)}
      })
      await current.evaluate(() => window.fixtureTraceTop('after-top'))
      assert.ok(passiveCorrection.after.y > 2)
      assert.ok(
        Math.abs(passiveCorrection.after.y - passiveCorrection.before.y) <= 2,
      )
      assert.deepEqual(
        passiveCorrection.after.local,
        passiveCorrection.before.local,
      )
      assert.deepEqual(await cloudBytes(), beforePassiveTop)
      await current.evaluate(() => document.activeElement?.blur())
      await current.keyboard.press('Home')
      await expect
        .poll(() => current.evaluate(() => Math.abs(scrollY)))
        .toBeLessThanOrEqual(2)
      const topKey =
        post(-200).uri + '|repost:-|reply:-|context:' + post(-200).uri
      await expect
        .poll(async () => (await snapshot()).place.anchor)
        .toBe(topKey)
      assert.ok(Math.abs((await snapshot()).y) <= 2)
      await current.evaluate(() => window.fixtureTraceTop('before-refresh'))
      await readingAction(current, 'Refresh')
      await current.evaluate(() =>
        window.fixtureTraceTop('after-refresh-click'),
      )
      await readingPanel(current)
      await expect(
        current.getByRole('button', {name: 'Refresh', exact: true}),
      ).toBeEnabled()
      await expect(current.getByTestId('skyanchor-new')).toHaveCount(0)
      await closeReadingPanel(current)
      report.topRefreshTrace ??= []
      report.topRefreshTrace.push({
        engine: index === 0 ? 'desktop' : 'phone WebKit',
        trace: await current.evaluate(() => {
          window.fixtureTraceTop('after-refresh-close')
          return window.fixtureTopTrace
        }),
      })
      await expect(arrow).toHaveCount(0)

      assert.ok(Math.abs(await current.evaluate(() => scrollY)) <= 2)
      const immediateRefreshCases = []
      for (const kind of ['no-new', 'new-head']) {
        immediatePhase = kind
        await current.evaluate(() => document.activeElement?.blur())
        await current.keyboard.press('PageDown')
        await expect
          .poll(async () => (await snapshot()).place.anchor)
          .not.toBe(topKey)
        await readingAction(current, 'Save my place')
        await expect
          .poll(async () => (await cloud()).state)
          .toBe(JSON.stringify((await snapshot()).place))
        await expect(
          current.getByTestId('skyanchor-source-state'),
        ).toContainText('Current local place confirmed shared')
        await closeReadingPanel(current)
        if (kind === 'new-head')
          controls.setTimeline([
            {post: post(-201)},
            {post: post(-200)},
            repost,
            ...incoming,
            ...initial,
          ])
        const phaseTime = await current.evaluate(() => Date.now())
        // Cross-process commands must not consume the immediate gesture's intent budget.
        await current.clock.pauseAt(phaseTime + 1000)
        held = controls.holdTimeline(30, 0)
        await current.evaluate(() => {
          const request = window.requestAnimationFrame
          const cancel = window.cancelAnimationFrame
          let next = 0
          const pending = new Map()
          window.requestAnimationFrame = callback => {
            const id = --next
            pending.set(id, callback)
            return id
          }
          window.cancelAnimationFrame = id => {
            if (!pending.delete(id)) cancel.call(window, id)
          }
          window.fixtureReleaseFrames = () => {
            window.requestAnimationFrame = request
            window.cancelAnimationFrame = cancel
            for (const callback of pending.values())
              request.call(window, callback)
            pending.clear()
          }
          document.activeElement?.blur()
        })
        await current.keyboard.press('Home')
        await expect
          .poll(() => current.evaluate(() => Math.abs(scrollY)))
          .toBeLessThanOrEqual(2)
        const beforeImmediate = await current.evaluate(() => {
          window.fixtureTraceTop('immediate-user-top-before-RAF')
          return window.fixtureTopTrace.at(-1)
        })
        assert.equal(beforeImmediate.anchor, topKey)
        assert.notEqual(beforeImmediate.local.anchor, topKey)
        await current
          .getByTestId('skyanchor-reading-button')
          .evaluate(button => button.click())
        await current
          .getByRole('button', {name: 'Refresh', exact: true})
          .evaluate(button => button.click())
        await current.clock.runFor(1)
        await Promise.race([
          held.reached,
          current.waitForTimeout(10_000).then(() => {
            throw new Error('Immediate top Refresh did not request its head')
          }),
        ])
        assert.ok(Math.abs(await current.evaluate(() => scrollY)) <= 2)
        await current.evaluate(() => window.fixtureReleaseFrames())
        await current.clock.runFor(16)
        await expect
          .poll(async () => (await snapshot()).place.anchor)
          .toBe(topKey)
        const homeCapture = await current.evaluate(() =>
          window.fixtureTopTrace.findLast(entry => entry.phase === 'capture'),
        )
        assert.equal(homeCapture.detail.intentional, true)
        assert.equal(homeCapture.local.anchor, topKey)
        // Confirm the real Home gesture's automatic save before releasing integration.
        const beforeDebounce = await current.evaluate(() => ({
          now: Date.now(),
          ticks: performance.now(),
        }))
        await current.clock.runFor(1000)
        const afterDebounce = await current.evaluate(() => ({
          now: Date.now(),
          ticks: performance.now(),
        }))
        await expect
          .poll(
            async () =>
              (await cloud()).state ===
              JSON.stringify((await snapshot()).place),
          )
          .toBe(true)
        await current.clock.resume()
        const immediateBaseline = await cloudBytes()
        const acceptedWrite = () =>
          privateRequests.findLast(
            entry =>
              entry.phase === kind &&
              entry.method === 'PUT' &&
              entry.status === 200 &&
              entry.response?.revision === immediateBaseline.place.revision &&
              entry.response?.device === immediateBaseline.place.device &&
              JSON.stringify(entry.response.state) ===
                immediateBaseline.place.state &&
              JSON.stringify(entry.request.state) ===
                immediateBaseline.place.state,
          )
        await expect.poll(() => !!acceptedWrite()).toBe(true)
        const acceptedHomeWrite = acceptedWrite()
        await current.evaluate(
          key =>
            new Promise(resolve => {
              window.fixtureImmediateSamples = []
              window.fixtureSampleImmediate = true
              const sample = () => {
                if (!window.fixtureSampleImmediate) return
                const row = [
                  ...document.querySelectorAll('[data-skyanchor-key]'),
                ].find(node => node.dataset.skyanchorKey === key)
                if (window.fixtureImmediateSamples.length < 2048)
                  window.fixtureImmediateSamples.push(
                    row?.getBoundingClientRect().top,
                  )
                if (window.fixtureImmediateSamples.length === 1) resolve()
                requestAnimationFrame(sample)
              }
              requestAnimationFrame(sample)
            }),
          topKey,
        )
        if (kind === 'new-head')
          await current.evaluate(() => {
            // Query observer publication uses zero-delay timers, independently of loading UI.
            const schedule = window.setTimeout
            const cancel = window.clearTimeout
            const pending = new Map()
            let next = 0
            window.setTimeout = (callback, delay, ...args) => {
              if (delay !== 0) return schedule(callback, delay, ...args)
              const id = --next
              pending.set(id, () => callback(...args))
              return id
            }
            window.clearTimeout = id => {
              if (!pending.delete(id)) cancel(id)
            }
            window.fixtureReleaseNotifications = () => {
              window.setTimeout = schedule
              window.clearTimeout = cancel
              for (const callback of pending.values()) schedule(callback, 0)
              pending.clear()
            }
          })
        const samplesBeforeRelease = await current.evaluate(
          () => window.fixtureImmediateSamples.length,
        )
        assert.ok(samplesBeforeRelease >= 1)
        held.release()
        held = undefined
        let labelMilestonePrefix
        try {
          await expect(
            current.getByTestId('skyanchor-reading-button'),
          ).not.toHaveAccessibleName(/Loading new posts/)
          labelMilestonePrefix = (await snapshot()).keys.slice(0, 2)
        } finally {
          if (kind === 'new-head')
            await current.evaluate(() => window.fixtureReleaseNotifications())
        }
        if (kind === 'new-head')
          await expect
            .poll(async () => (await snapshot()).keys.slice(0, 2))
            .toEqual([
              post(-201).uri + '|repost:-|reply:-|context:' + post(-201).uri,
              topKey,
            ])
        await current.evaluate(
          () =>
            new Promise(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        )
        const afterImmediate = await current.evaluate(key => {
          window.fixtureSampleImmediate = false
          window.fixtureTraceTop('immediate-refresh-integrated')
          const row = [
            ...document.querySelectorAll('[data-skyanchor-key]'),
          ].find(node => node.dataset.skyanchorKey === key)
          return {
            ...window.fixtureTopTrace.at(-1),
            firstVisible: window.fixtureTopTrace.at(-1).anchor,
            anchor: row?.dataset.skyanchorKey,
            top: row?.getBoundingClientRect().top,
            samples: window.fixtureImmediateSamples,
          }
        }, topKey)
        assert.equal(afterImmediate.anchor, topKey)
        const delta = Math.abs(afterImmediate.top - beforeImmediate.top)
        assert.ok(delta <= 2, `Immediate ${kind} Refresh drift: ${delta}px`)
        assert.ok(afterImmediate.samples.length > 1)
        const maximumFrameDrift = Math.max(
          ...afterImmediate.samples.map(top =>
            Math.abs(top - beforeImmediate.top),
          ),
        )
        assert.ok(
          maximumFrameDrift <= 2,
          `Immediate ${kind} per-frame Refresh drift: ${maximumFrameDrift}px`,
        )
        if (kind === 'no-new') assert.ok(Math.abs(afterImmediate.y) <= 2)
        else
          assert.deepEqual((await snapshot()).keys.slice(0, 2), [
            post(-201).uri + '|repost:-|reply:-|context:' + post(-201).uri,
            topKey,
          ])
        assert.deepEqual(await cloudBytes(), immediateBaseline)
        immediateRefreshCases.push({
          kind,
          beforeDebounce,
          afterDebounce,
          homeCapture,
          acceptedHomeWrite: {
            id: acceptedHomeWrite.id,
            revision: immediateBaseline.place.revision,
            device: immediateBaseline.place.device,
          },
          before: beforeImmediate,
          labelMilestonePrefix,
          after: afterImmediate,
          deltaCSSPx: delta,
          maximumFrameDriftCSSPx: maximumFrameDrift,
          samplesBeforeRelease,
          unchangedCloudRowAndClock: true,
        })
      }
      report.immediateTopRefresh ??= []
      report.immediateTopRefresh.push({
        engine: index === 0 ? 'desktop' : 'phone WebKit',
        cases: immediateRefreshCases,
        trace: await current.evaluate(() => window.fixtureTopTrace),
      })
      await current.evaluate(() => document.activeElement?.blur())
      await current.keyboard.press('Home')
      await expect
        .poll(() => current.evaluate(() => Math.abs(scrollY)))
        .toBeLessThanOrEqual(2)
      const discoveryTopKey =
        post(-201).uri + '|repost:-|reply:-|context:' + post(-201).uri
      await expect
        .poll(async () => (await snapshot()).place.anchor)
        .toBe(discoveryTopKey)
      await readingAction(current, 'Save my place')
      await expect
        .poll(async () => (await cloud()).state)
        .toBe(JSON.stringify((await snapshot()).place))
      await expect(current.getByTestId('skyanchor-source-state')).toContainText(
        'Current local place confirmed shared',
      )
      await closeReadingPanel(current)
      const discoveryBaseline = await cloudBytes()
      controls.setTimeline([
        {post: post(-202)},
        {post: post(-201)},
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
      assert.deepEqual(await cloudBytes(), discoveryBaseline)
      await current.getByTestId('homeScreenFeedTabs-selector-1').click()
      await expect(arrow).toHaveCount(0)
      await current.getByTestId('homeScreenFeedTabs-selector-0').click()
      await expect(arrow).toBeVisible()
      await arrow.click()
      await expect(arrow).toHaveCount(0)

      controls.setTimeline([
        {post: post(-203)},
        {post: post(-202)},
        {post: post(-201)},
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
      if (current) {
        await current.evaluate(() => window.fixtureReleaseFrames?.())
        await readingPanel(current)
      }
      report.newContentFailure = {
        engine: index === 0 ? 'desktop' : 'phone WebKit',
        failures,
        immediatePhase,
        privateRequests: privateRequests.slice(-24),
        clock: current
          ? await current.evaluate(() => ({
              now: Date.now(),
              ticks: performance.now(),
            }))
          : undefined,
        cloud: await worker.db
          .prepare(
            "SELECT did, feed, state, revision, device, updated FROM places WHERE did = ? AND feed = 'following'",
          )
          .bind(did)
          .first(),
        ui: current ? await current.locator('body').innerText() : '',
        geometry: current
          ? await current.evaluate(() => ({
              y: scrollY,
              topTrace: window.fixtureTopTrace,
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
      const diagnostic = report.newContentFailure
      const stateSummary = state =>
        state && {
          version: state.version,
          anchor: state.anchor,
          offset: state.offset,
          neighbors: state.neighbors?.length,
        }
      console.error(
        'Synthetic new-content failure:',
        JSON.stringify({
          engine: diagnostic.engine,
          phase: immediatePhase,
          clock: diagnostic.clock,
          failures,
          requests: diagnostic.privateRequests.slice(-8).map(entry => ({
            ...entry,
            request: entry.request && {
              revision: entry.request.revision,
              state: stateSummary(entry.request.state),
            },
            response: entry.response && {
              revision: entry.response.revision,
              device: entry.response.device,
              updated: entry.response.updated,
              state: stateSummary(entry.response.state),
            },
          })),
          cloud: diagnostic.cloud && {
            ...diagnostic.cloud,
            state: stateSummary(JSON.parse(diagnostic.cloud.state)),
          },
          ui: diagnostic.ui.slice(-4500),
          geometry: {
            ...diagnostic.geometry,
            localPlaces: undefined,
            topTrace: diagnostic.geometry?.topTrace?.slice(-8).map(entry => ({
              ...entry,
              local: stateSummary(entry.local),
              detail: entry.detail && {
                intentional: entry.detail.intentional,
                place: stateSummary(entry.detail.place),
              },
              stack: undefined,
            })),
          },
        }),
      )
      throw error
    } finally {
      held?.release()
      await context.close()
    }
  }
}
