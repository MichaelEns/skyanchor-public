import assert from 'node:assert/strict'
import {devices as browserDevices, expect} from '@playwright/test'
import {
  readingAction,
  closeReadingPanel,
  readingPanel,
} from './reading-panel.mjs'

export async function verifyHandoff({
  desktopBrowser,
  phoneBrowser,
  origin,
  mockUpstream,
  signIn,
  worker,
  report,
  deleted,
  entries,
  post,
  holdApi,
}) {
  const did = 'did:plc:eeeeeeeeeeeeeeeeeeeeeeee'
  const contexts = []
  const failures = []
  const records = []
  const markerColor = page =>
    page
      .getByTestId('skyanchor-reading-indicator')
      .evaluate(node => getComputedStyle(node).backgroundColor)
  async function reached(hold, page) {
    let timer
    try {
      await Promise.race([
        hold.reached,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('Resume did not reach the held history page')),
            15000,
          )
        }),
      ])
    } catch (error) {
      report.handoffFailure = {
        ui: await page.locator('body').innerText(),
        historyRequests: contexts.find(
          context => context.fixture?.page === page,
        )?.fixture.controls.timelineRequests,
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  const history = Array.from({length: 510}, (_, index) => ({
    post: post(index + 1),
  }))
  const root = post(601)
  const parent = post(600, {
    record: {
      ...post(600).record,
      reply: {
        root: {uri: root.uri, cid: root.cid},
        parent: {uri: root.uri, cid: root.cid},
      },
    },
  })
  history[469] = {
    post: post(470, {
      record: {
        ...post(470).record,
        reply: {
          root: {uri: root.uri, cid: root.cid},
          parent: {uri: parent.uri, cid: parent.cid},
        },
      },
    }),
    reply: {root, parent},
    reason: {...entries[69].reason, indexedAt: post(470).indexedAt},
  }
  const key = 'skyanchor:following:v1:' + did
  const cloud = () =>
    worker.db
      .prepare(
        "SELECT state, revision, device FROM places WHERE did = ? AND feed = 'following'",
      )
      .bind(did)
      .first()
  const local = page =>
    page.evaluate(key => JSON.parse(localStorage.getItem(key))?.place, key)
  const savedBytes = page =>
    page.evaluate(() => ({
      storage: Object.fromEntries(
        Object.entries(localStorage).filter(
          ([key]) =>
            key.startsWith('skyanchor:following:') ||
            key.startsWith('skyanchor:return:') ||
            key.startsWith('skyanchor:revision:'),
        ),
      ),
      rows: [...document.querySelectorAll('[data-skyanchor-key]')].map(
        node => node.dataset.skyanchorKey,
      ),
      query: location.href,
    }))
  const placementError = (page, state) =>
    page.evaluate(place => {
      const row = [...document.querySelectorAll('[data-skyanchor-key]')].find(
        node => node.dataset.skyanchorKey === place.anchor,
      )
      const header = document.querySelector('[data-testid="mobileHomeHeader"]')
      return row
        ? Math.abs(
            row.getBoundingClientRect().top -
              (header?.getBoundingClientRect().bottom ?? 0) -
              place.offset,
          )
        : Infinity
    }, state)
  const confirmation = async page => {
    await readingAction(page, 'Save my place')
    await expect
      .poll(
        async () =>
          (await cloud())?.state === JSON.stringify(await local(page)),
      )
      .toBe(true)
    await closeReadingPanel(page)
    return cloud()
  }
  const offer = async page => {
    const before = await page.evaluate(() => window.scrollY)
    await readingAction(page, 'Check other device')
    await expect(
      page.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeVisible()
    assert.equal(await page.evaluate(() => window.scrollY), before)
    await closeReadingPanel(page)
  }
  const resume = async (page, state) => {
    await offer(page)
    await readingAction(page, 'Resume other device')
    await expect
      .poll(async () => JSON.stringify(await local(page)))
      .toBe(JSON.stringify(state))
    const error = await page.evaluate(place => {
      const row = [...document.querySelectorAll('[data-skyanchor-key]')].find(
        node => node.dataset.skyanchorKey === place.anchor,
      )
      const header = document.querySelector('[data-testid="mobileHomeHeader"]')
      return row
        ? Math.abs(
            row.getBoundingClientRect().top -
              (header?.getBoundingClientRect().bottom ?? 0) -
              place.offset,
          )
        : Infinity
    }, state)
    assert.ok(
      error <= 2,
      'Explicit handoff restores the exact occurrence and header-relative offset',
    )
    records.push({step: 'resume', error})
  }
  try {
    for (const [index, browser] of [
      desktopBrowser,
      phoneBrowser,
      desktopBrowser,
    ].entries()) {
      const context = await browser.newContext({
        viewport:
          index === 1 ? {width: 390, height: 844} : {width: 1280, height: 900},
        ...(index === 1
          ? {
              isMobile: true,
              hasTouch: true,
              userAgent: browserDevices['iPhone 13'].userAgent,
              ignoreHTTPSErrors: true,
            }
          : {}),
        serviceWorkers: 'block',
      })
      contexts.push(context)
      await context.addInitScript(() => {
        window.fixtureInitialReadingKeys = Object.keys(localStorage).filter(
          key => key.startsWith('skyanchor:'),
        )
      })
      const controls = await mockUpstream(context, did)
      controls.setTimeline(history)
      const page = await context.newPage()
      page.on('pageerror', error => failures.push(error.message))
      const expected = new Map()
      page.on('response', response => {
        if (
          response.status() < 400 ||
          response.url().includes('com.atproto.repo.getRecord')
        )
          return
        const id =
          response.request().method() +
          ' ' +
          new URL(response.url()).pathname +
          ' ' +
          response.status()
        if (expected.get(id)) expected.set(id, expected.get(id) - 1)
        else failures.push(id)
      })
      await signIn(page, index === 0 ? 'fixture@example.test' : 'reader.test')
      assert.deepEqual(
        await page.evaluate(() => window.fixtureInitialReadingKeys),
        [],
      )
      if (index === 2) {
        await page.reload()
        await page.getByTestId('HomeScreen').waitFor()
        await page.locator('[data-skyanchor-key]').first().waitFor()
      }
      contexts[index].fixture = {page, controls, expected}
    }
    const [a, b, c] = contexts.map(context => context.fixture.page)
    const devices = await Promise.all(
      [a, b, c].map(page =>
        page.evaluate(() => localStorage.getItem('skyanchor:device')),
      ),
    )
    assert.equal(new Set(devices).size, 3)
    assert.ok(devices.every(Boolean))
    const sharedTab = await contexts[0].newPage()
    try {
      await sharedTab.goto(origin + '/')
      await sharedTab.getByTestId('HomeScreen').waitFor()
      await sharedTab.getByTestId('skyanchor-reading-button').waitFor()
      assert.equal(
        await sharedTab.evaluate(() =>
          localStorage.getItem('skyanchor:device'),
        ),
        devices[0],
      )
    } finally {
      await sharedTab.close()
    }
    await expect(a.getByTestId('skyanchor-reading-indicator')).toHaveCount(0)
    await expect(
      a.getByTestId('skyanchor-reading-button'),
    ).toHaveAccessibleName('Reading place: Not connected')
    await readingAction(a, 'Connect private sync')
    await expect(a.getByTestId('skyanchor-toolbar')).toContainText(
      'There is no shared saved place for this feed',
    )
    await expect(a.getByTestId('skyanchor-connection-status')).toHaveText(
      'Connected',
    )
    await expect(a.getByTestId('skyanchor-reading-indicator')).toHaveCount(0)
    await closeReadingPanel(a)
    // Load real successive timeline pages; B and C keep their different, fresh windows.
    for (let i = 0; i < 20; i++) {
      const count = await a.locator('[data-skyanchor-key]').count()
      if (await a.locator('[data-skyanchor-key*="/post470|"]').count()) break
      await a.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      )
      await expect
        .poll(() => a.locator('[data-skyanchor-key]').count())
        .toBeGreaterThan(count)
    }
    const target = a.locator('[data-skyanchor-key*="/post470|repost:"]').last()
    await target.scrollIntoViewIfNeeded()
    await target.evaluate(node =>
      window.scrollBy(0, node.getBoundingClientRect().top + 37),
    )
    await expect
      .poll(async () => (await local(a))?.anchor.includes('/post470|repost:'))
      .toBe(true)
    const first = await confirmation(a)
    const place = JSON.parse(first.state)
    assert.ok(
      contexts[0].fixture.controls.timelineRequests.some(
        request => request.index >= 450,
      ),
    )
    assert.ok(place.anchor.includes('/post470|repost:did:'))
    assert.ok(place.anchor.includes('|reply:at://'))
    for (const page of [b, c]) {
      assert.equal(
        await page.evaluate(
          did => localStorage.getItem('skyanchor:revision:' + did),
          did,
        ),
        null,
      )
      assert.equal(
        await page.evaluate(
          did => localStorage.getItem('skyanchor:sync-enabled:' + did),
          did,
        ),
        null,
      )
      assert.equal(
        await page.evaluate(
          anchor =>
            [...document.querySelectorAll('[data-skyanchor-key]')].some(
              node => node.dataset.skyanchorKey === anchor,
            ),
          place.anchor,
        ),
        false,
      )
      const y = await page.evaluate(() => window.scrollY)
      if (page === b) {
        contexts[1].fixture.controls.expireAccess()
        contexts[1].fixture.expected.set('POST /api/skyanchor/session 401', 1)
      }
      await readingAction(page, 'Connect private sync')
      await expect(
        page.getByRole('button', {name: 'Resume other device', exact: true}),
      ).toBeVisible()
      await expect(
        page.getByTestId('skyanchor-reading-button'),
      ).toHaveAccessibleName(/Other device place available/)
      const red = await markerColor(page)
      assert.equal(await page.evaluate(() => window.scrollY), y)
      await readingAction(page, 'Resume other device')
      await expect
        .poll(async () => JSON.stringify(await local(page)), {timeout: 20000})
        .toBe(JSON.stringify(place))
      await expect(page.getByTestId('skyanchor-resume-result')).toContainText(
        'Resumed the other device',
      )
      await expect(
        page.getByTestId('skyanchor-reading-button'),
      ).toHaveAccessibleName(
        /Reading place: (Return available|New posts above)/,
      )
      assert.notEqual(
        await markerColor(page),
        red,
        'Remote offer red and Return blue use distinct computed theme colors',
      )
      const error = await placementError(page, place)
      assert.ok(error <= 2, `Direct first-use placement error ${error}`)
      records.push({
        step: 'direct-first-use',
        browser: page === b ? 'WebKit phone' : 'Chromium desktop',
        depth: 470,
        error,
      })
      assert.ok(
        contexts
          .find(context => context.fixture.page === page)
          .fixture.controls.timelineRequests.some(
            request => request.index >= 450 && request.limit === 30,
          ),
      )
      assert.deepEqual(
        await cloud(),
        first,
        'Direct first-use Resume never writes cloud progress',
      )
    }
    const samePlaceSave = await confirmation(a)
    assert.equal(samePlaceSave.state, first.state)
    await offer(b)
    const starts = contexts[1].fixture.controls.timelineRequests.filter(
      request => request.limit === 30 && request.index === 0,
    ).length
    await readingPanel(b)
    await b
      .getByRole('button', {name: 'Resume other device', exact: true})
      .evaluate(button => {
        button.click()
        button.click()
      })
    await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
      "Already at the other device's saved place",
    )
    assert.deepEqual(await cloud(), samePlaceSave)
    assert.equal(
      contexts[1].fixture.controls.timelineRequests.filter(
        request => request.limit === 30 && request.index === 0,
      ).length,
      starts + 1,
      'Double activation starts exactly one Resume',
    )
    await b.evaluate(() => window.scrollBy(0, 31))
    const second = await confirmation(b)
    await resume(c, JSON.parse(second.state))
    await c.evaluate(() => window.scrollBy(0, 29))
    const third = await confirmation(c)
    assert.ok(
      first.revision < second.revision && second.revision < third.revision,
    )
    await offer(a)
    assert.equal(
      (await cloud()).revision,
      third.revision,
      'Offers never write cloud progress',
    )
    assert.equal(
      (await contexts[0].cookies()).find(
        value => value.name === '__Host-skyanchor',
      )?.value ===
        (await contexts[1].cookies()).find(
          value => value.name === '__Host-skyanchor',
        )?.value,
      false,
    )
    // Freeze A's explicit choice while C publishes a newer revision during recovery.
    const aControls = contexts[0].fixture.controls
    let held = aControls.holdTimeline(30, 30)
    try {
      await readingAction(a, 'Resume other device')
      await reached(held, a)
      await expect(a.getByTestId('skyanchor-resume-result')).toContainText(
        /History pages checked: [0-9]+/,
      )
      await a.evaluate(() => {
        window.dispatchEvent(new Event('focus'))
        window.dispatchEvent(new Event('online'))
      })
      await c.evaluate(() => window.scrollBy(0, 23))
      const newer = await confirmation(c)
      assert.ok(newer.revision > third.revision)
      held.release()
      await expect
        .poll(async () => JSON.stringify(await local(a)))
        .toBe(third.state)
      await readingPanel(a)
      await expect(
        a.getByRole('button', {name: 'Resume other device', exact: true}),
      ).toBeEnabled()
      assert.deepEqual(
        await cloud(),
        newer,
        'Resuming an older frozen offer cannot overwrite the newer source revision',
      )
      await closeReadingPanel(a)
      // Both explicit Cancel and user movement abort the active request without consuming any local checkpoint.
      for (const kind of ['cancel', 'pan']) {
        const before = await savedBytes(a)
        held = aControls.holdTimeline(30, 30)
        await readingAction(a, 'Resume other device')
        await reached(held, a)
        if (kind === 'cancel')
          await a
            .getByRole('button', {name: 'Cancel Resume', exact: true})
            .click()
        else
          await a.evaluate(() =>
            window.dispatchEvent(new WheelEvent('wheel', {deltaY: 1})),
          )
        await expect(a.getByTestId('skyanchor-resume-result')).toContainText(
          'Resume cancelled',
        )
        held.release()
        assert.deepEqual(
          await savedBytes(a),
          before,
          `${kind} must preserve all saved bytes, rows, URL and revision`,
        )
        assert.deepEqual(await cloud(), newer)
      }
      const beforePlacementCancel = await savedBytes(a)
      await a.evaluate(() => {
        window.fixtureResumeScroll = window.scrollBy
        window.scrollBy = function (...args) {
          window.scrollBy = window.fixtureResumeScroll
          window.fixtureResumeScroll.apply(window, args)
          window.dispatchEvent(new WheelEvent('wheel', {deltaY: 1}))
        }
      })
      try {
        await readingAction(a, 'Resume other device')
        await expect(a.getByTestId('skyanchor-resume-result')).toContainText(
          'Resume cancelled',
        )
        await a.evaluate(
          () =>
            new Promise(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        )
        assert.deepEqual(
          await savedBytes(a),
          beforePlacementCancel,
          'Cancellation during exact placement rolls back the staged query and saved bytes',
        )
        assert.deepEqual(await cloud(), newer)
      } finally {
        await a.evaluate(() => {
          window.scrollBy = window.fixtureResumeScroll
        })
      }
    } finally {
      held.release()
    }
    // Rotate a real-shaped regional session using SessionProvider's refresh result.
    const phone = contexts[1].fixture
    phone.controls.expireAccess()
    phone.expected.set('POST /api/skyanchor/session 401', 1)
    const beforeRenewal = await local(b)
    const cookieBeforeRenewal = (await contexts[1].cookies()).find(
      value => value.name === '__Host-skyanchor',
    )?.value
    await readingAction(b, 'Reconnect private sync')
    await expect
      .poll(
        async () =>
          (await contexts[1].cookies()).find(
            value => value.name === '__Host-skyanchor',
          )?.value,
      )
      .not.toBe(cookieBeforeRenewal)
    await expect(
      b.getByText(
        'Another device has a saved place. Your viewport has not moved.',
        {exact: true},
      ),
    ).toBeVisible()
    assert.deepEqual(await local(b), beforeRenewal)
    assert.ok(
      phone.controls.issuedAccess.length >= 2,
      'Renewal must rotate access credentials',
    )
    assert.ok(
      worker.verifications.includes(
        'https://shimeji.us-east.host.bsky.network',
      ),
    )
    await closeReadingPanel(b)
    await worker.db
      .prepare('UPDATE sessions SET expires = 0 WHERE did = ?')
      .bind(did)
      .run()
    phone.expected.set('GET /api/skyanchor/place 401', 1)
    await readingAction(b, 'Check other device')
    await expect(
      b.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeVisible()
    await closeReadingPanel(b)
    // One failed explicit renewal retains local progress and recovers on an explicit retry.
    phone.controls.expireAccess()
    phone.controls.failRefresh(true)
    phone.expected.set('POST /api/skyanchor/session 401', 1)
    phone.expected.set('POST /xrpc/com.atproto.server.refreshSession 503', 1)
    const beforeFailure = await cloud()
    await readingAction(b, 'Reconnect private sync')
    await expect(
      b.getByText(/Bluesky session renewal did not complete/),
    ).toBeVisible()
    assert.deepEqual(await cloud(), beforeFailure)
    assert.deepEqual(await local(b), beforeRenewal)
    phone.controls.failRefresh(false)
    phone.expected.set('POST /api/skyanchor/session 401', 1)
    const cookieBeforeRecovery = (await contexts[1].cookies()).find(
      value => value.name === '__Host-skyanchor',
    )?.value
    await readingAction(b, 'Reconnect private sync')
    await expect
      .poll(
        async () =>
          (await contexts[1].cookies()).find(
            value => value.name === '__Host-skyanchor',
          )?.value,
      )
      .not.toBe(cookieBeforeRecovery)
    await expect(
      b.getByText(/Bluesky session renewal did not complete/),
    ).toHaveCount(0)
    await closeReadingPanel(b)
    // Exercise the real foreground SDK renewal and private GET deadlines.
    await b.clock.install()
    const beforeHang = await savedBytes(b)
    const cloudBeforeHang = await cloud()
    const privateHold = holdApi('GET')
    try {
      await readingAction(b, 'Check other device')
      await reached(privateHold, b)
      await b.clock.fastForward(16000)
      await expect(b.getByTestId('skyanchor-toolbar')).toContainText(
        'Private sync request timed out',
      )
      assert.deepEqual(await savedBytes(b), beforeHang)
      assert.deepEqual(await cloud(), cloudBeforeHang)
    } finally {
      privateHold.release()
    }
    await readingAction(b, 'Check other device')
    const refreshPattern = '**/xrpc/com.atproto.server.refreshSession'
    let enterRefresh, releaseRefresh
    const refreshHold = {
      reached: new Promise(resolve => {
        enterRefresh = resolve
      }),
    }
    const refreshDone = new Promise(resolve => {
      releaseRefresh = resolve
    })
    const hangRefresh = async route => {
      enterRefresh()
      await refreshDone
      await route.abort('failed')
    }
    await contexts[1].route(refreshPattern, hangRefresh)
    try {
      phone.controls.expireAccess()
      phone.expected.set('POST /api/skyanchor/session 401', 1)
      await readingAction(b, 'Reconnect private sync')
      await reached(refreshHold, b)
      await b.clock.fastForward(16000)
      await expect(b.getByTestId('skyanchor-toolbar')).toContainText(
        'Bluesky session renewal did not complete',
      )
      assert.deepEqual(await savedBytes(b), beforeHang)
      assert.deepEqual(await cloud(), cloudBeforeHang)
    } finally {
      releaseRefresh()
      await contexts[1].unroute(refreshPattern, hangRefresh)
    }
    phone.expected.set('POST /api/skyanchor/session 401', 1)
    await readingAction(b, 'Reconnect private sync')
    await expect(
      b
        .getByTestId('skyanchor-toolbar')
        .getByText(/Bluesky session renewal did not complete/),
    ).toHaveCount(0)
    await closeReadingPanel(b)
    const malformedPath = origin + '/api/skyanchor/place'
    const malformed = route =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{"revision":0}',
          })
        : route.fallback()
    await contexts[1].route(malformedPath, malformed)
    try {
      await readingAction(b, 'Check other device')
      await expect(b.getByTestId('skyanchor-toolbar')).toContainText(
        'Invalid private sync response or account binding',
      )
      assert.deepEqual(await savedBytes(b), beforeHang)
      assert.deepEqual(await cloud(), cloudBeforeHang)
    } finally {
      await contexts[1].unroute(malformedPath, malformed)
    }
    await closeReadingPanel(b)
    const missingUri = JSON.parse(third.state).anchor.split('|')[0]
    contexts[1].fixture.controls.setTimeline(
      history.map(item =>
        item.post.uri === missingUri
          ? {
              ...item,
              post: {
                ...item.post,
                labels: [
                  {
                    src: 'did:plc:ar7c4by46qjdydhdevvrndac',
                    uri: missingUri,
                    val: '!hide',
                    cts: new Date().toISOString(),
                  },
                ],
              },
            }
          : item,
      ),
    )
    try {
      await offer(b)
      const beforeModeration = await savedBytes(b)
      await readingAction(b, 'Resume other device')
      await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
        'excluded by current moderation',
      )
      assert.deepEqual(await savedBytes(b), beforeModeration)
      assert.deepEqual(await cloud(), cloudBeforeHang)
    } finally {
      contexts[1].fixture.controls.setTimeline(history)
    }
    deleted.add(missingUri)
    contexts[1].fixture.controls.setTimeline(
      history.filter(item => item.post.uri !== missingUri),
    )
    try {
      const before = await local(b)
      const checkpoint = await b.evaluate(
        did => localStorage.getItem('skyanchor:return:v1:' + did),
        did,
      )
      await offer(b)
      const allBefore = await savedBytes(b)
      await readingAction(b, 'Resume other device')
      await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
        'Could not restore the exact saved occurrence',
      )
      assert.deepEqual(await savedBytes(b), allBefore)
      await readingPanel(b)
      await expect(
        b
          .getByTestId('skyanchor-toolbar')
          .getByText(/Could not restore the exact saved occurrence/),
      ).toBeVisible()
      await expect(
        b.getByRole('button', {name: 'Resume other device', exact: true}),
      ).toBeVisible()
      assert.deepEqual(await local(b), before)
      assert.equal(
        await b.evaluate(
          did => localStorage.getItem('skyanchor:return:v1:' + did),
          did,
        ),
        checkpoint,
      )
      assert.deepEqual(await cloud(), beforeFailure)
      await closeReadingPanel(b)
    } finally {
      deleted.delete(missingUri)
      contexts[1].fixture.controls.setTimeline(history)
    }
    for (const context of contexts)
      assert.ok(
        [...context.fixture.expected.values()].every(count => count === 0),
        'Every precisely expected failure must occur',
      )
    assert.deepEqual(failures, [])
    report.handoff = {
      devices: devices.length,
      revisions: [first.revision, second.revision, third.revision],
      placements: records,
      regionalRefresh: true,
      directFirstUseDepth: 470,
      frozenOfferAndSourceRace: true,
      cancellationPreservesBytes: true,
      foregroundRequestDeadlines: true,
      persistedRegionalReload: true,
      errors: failures,
    }
    report.checks.push(
      'Three independent browser profiles (email entryway, WebKit regional handle, cold persisted regional desktop) hand off a deep exact repost/reply occurrence outside fresh windows through real D1 CAS. Offers never jump or write; expired access/cookie renewal and failure recovery preserve local state.',
    )
  } catch (error) {
    report.handoffFailure ??= await Promise.all(
      contexts
        .filter(context => context.fixture)
        .map(async context => ({
          ui: (await context.fixture.page.locator('body').innerText()).slice(
            -5000,
          ),
          readingLabel: await context.fixture.page
            .getByTestId('skyanchor-reading-button')
            .getAttribute('aria-label'),
          historyRequests: context.fixture.controls.timelineRequests,
        })),
    )
    throw error
  } finally {
    for (const context of contexts) await context.close()
  }
}
