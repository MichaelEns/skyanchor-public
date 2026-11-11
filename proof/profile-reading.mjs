import assert from 'node:assert/strict'
import {expect} from '@playwright/test'
import {verifyViewport} from './viewport.mjs'
import {
  readingPanel,
  readingAction,
  closeReadingPanel,
  verifyReadingPanel,
  legacyReturnFixture,
} from './reading-panel.mjs'

export async function verifyProfileReading({
  page,
  phonePage,
  origin,
  worker,
  did,
  authors,
  report,
  setConnectivity,
  phoneService,
}) {
  const feed = (author, filter = 'posts_and_author_threads') =>
    `author|${author}|${filter}`
  const storageKey = identity =>
    'skyanchor:following:v1:' +
    did +
    (identity === 'following' ? '' : ':' + identity)
  const snapshot = (current, identity) =>
    current.evaluate(key => localStorage.getItem(key), storageKey(identity))
  const cloud = identity =>
    worker.db
      .prepare('SELECT * FROM places WHERE did = ? AND feed = ?')
      .bind(did, identity)
      .first()
  const originalLocal = await snapshot(page, 'following')
  const originalCloud = await cloud('following')
  const followingUnchanged = async () => {
    assert.equal(
      await snapshot(page, 'following'),
      originalLocal,
      'Author-only actions must not mutate Following snapshot',
    )
    assert.deepEqual(
      await cloud('following'),
      originalCloud,
      'Author-only actions must not mutate Following cloud row/revision',
    )
  }
  const root = (current, identity) =>
    current
      .locator(`[data-skyanchor-feed="${identity}"]`)
      .filter({visible: true})
  const toolbar = (current, identity) =>
    current.locator(`[data-skyanchor-toolbar-feed="${identity}"]`)
  const open = async (current, author, filter = 'posts_and_author_threads') => {
    const handle =
      author === authors[0] ? 'sharon-fixture.test' : 'another-fixture.test'
    await current.goto(origin + '/profile/' + handle)
    await root(current, feed(author))
      .locator('[data-skyanchor-key]')
      .first()
      .waitFor({timeout: 30000})
    if (filter !== 'posts_and_author_threads')
      await current
        .getByRole('tab', {
          name: filter === 'posts_with_replies' ? 'Replies' : 'Media',
          exact: true,
        })
        .click()
    await current.getByTestId('skyanchor-reading-button').waitFor()
    await current.waitForTimeout(600)
  }
  const move = async (current, identity, index, movement = 85) => {
    await closeReadingPanel(current)
    const rows = root(current, identity).locator('[data-skyanchor-key]')
    await rows.nth(index).scrollIntoViewIfNeeded()
    await current.waitForTimeout(350)
    const previous = JSON.parse(
      (await snapshot(current, identity)) ?? 'null',
    )?.place
    await current.evaluate(movement => window.scrollBy(0, movement), movement)
    await expect
      .poll(
        async () =>
          JSON.parse((await snapshot(current, identity)) ?? 'null')?.place,
      )
      .not.toEqual(previous)
    await expect.poll(() => snapshot(current, identity)).not.toBeNull()
    await current.waitForTimeout(1000)
    return JSON.parse(await snapshot(current, identity)).place
  }
  const top = (current, identity, place) =>
    root(current, identity)
      .locator('[data-skyanchor-key]')
      .evaluateAll(
        (nodes, key) =>
          nodes
            .find(node => node.dataset.skyanchorKey === key)
            ?.getBoundingClientRect().top,
        place.anchor,
      )
  const stable = async (name, current, identity, place, action) => {
    const before = await top(current, identity, place)
    await action()
    await current.waitForTimeout(1100)
    const after = await top(current, identity, place)
    assert.equal(typeof after, 'number', name + ' anchor must remain rendered')
    const delta = Math.abs(before - after)
    report.measurements.push({
      name,
      before,
      after,
      deltaCSSPx: delta,
      thresholdCSSPx: 2,
    })
    if (delta > 2) {
      report.profileDrift = {
        name,
        place,
        local: JSON.parse(await snapshot(current, identity)).place,
        geometry: await current.evaluate(() => ({
          y: scrollY,
          tabs: document
            .querySelector('[data-testid="profileFeedTabs"]')
            .getBoundingClientRect()
            .toJSON(),
        })),
      }
    }
    assert.ok(delta <= 2, name + ': drift ' + delta)
    await followingUnchanged()
  }
  const sharon = feed(authors[0])
  await page.addInitScript(() => {
    const Original = window.ResizeObserver
    window.ResizeObserver = class extends Original {
      constructor(callback) {
        super((entries, observer) => {
          if (window.fixtureDelayReturnResize)
            setTimeout(() => callback(entries, observer), 300)
          else callback(entries, observer)
        })
      }
    }
  })
  await open(page, authors[0])
  await verifyReadingPanel(page, report, sharon)
  const place = await move(page, sharon, 14)
  await (
    await readingPanel(page, sharon)
  )
    .getByRole('button', {name: 'Save my place', exact: true})
    .waitFor()
  await expect
    .poll(async () => (await cloud(sharon))?.state)
    .toBe(JSON.stringify(place))
  await followingUnchanged()
  await closeReadingPanel(page)
  const departure = await page.evaluate(identity => {
    const y = scrollY
    window.scrollBy(0, -90)
    const bottom = document
      .querySelector('[data-testid="profileFeedTabs"]')
      .getBoundingClientRect().bottom
    const root = [...document.querySelectorAll('[data-skyanchor-feed]')].find(
      node =>
        node.dataset.skyanchorFeed === identity && node.getClientRects().length,
    )
    const row = [...root.querySelectorAll('[data-skyanchor-key]')].find(
      node => node.getBoundingClientRect().bottom > bottom + 1,
    )
    const result = {
      key: row.dataset.skyanchorKey,
      top: row.getBoundingClientRect().top,
      y,
    }
    row.querySelector('a[href*="/post/"]').click()
    return result
  }, sharon)
  await page.waitForURL(/\/post\/author/)
  await page
    .getByTestId(/^postThreadItem-by-/)
    .filter({visible: true})
    .first()
    .waitFor()
  await page.goBack()
  await page.getByTestId('skyanchor-reading-button').waitFor()
  await page.waitForTimeout(500)
  const departureTop = await root(page, sharon)
    .locator('[data-skyanchor-key]')
    .evaluateAll(
      (nodes, key) =>
        nodes
          .find(node => node.dataset.skyanchorKey === key)
          ?.getBoundingClientRect().top,
      departure.key,
    )
  assert.ok(Math.abs(departureTop - departure.top) <= 2)
  report.measurements.push({
    name: 'Profile immediate pre-RAF post / Back',
    before: departure.top,
    after: departureTop,
    deltaCSSPx: Math.abs(departureTop - departure.top),
    thresholdCSSPx: 2,
  })
  await followingUnchanged()
  await page.evaluate(y => window.scrollTo(0, y), departure.y)
  await page.waitForTimeout(1000)
  await stable(
    'Profile buffered Refresh retains anchor',
    page,
    sharon,
    place,
    () => readingAction(page, 'Refresh', sharon),
  )
  await stable(
    'Profile header layout growth retains anchor',
    page,
    sharon,
    place,
    () =>
      page.getByTestId('profileScreen').evaluate(node => {
        const header = document.createElement('div')
        header.style.height = '120px'
        header.dataset.fixtureHeader = 'true'
        node.prepend(header)
      }),
  )
  await page
    .getByTestId('profileScreen')
    .locator('[data-fixture-header]')
    .evaluate(node => node.remove())
  await page.waitForTimeout(600)
  await stable(
    'Profile legacy Return retains anchor',
    page,
    sharon,
    place,
    async () => {
      await legacyReturnFixture(page, did, sharon)
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
      await page.waitForTimeout(1000)
      const returnKey = storageKey(sharon).replace(
        'skyanchor:following:',
        'skyanchor:return:',
      )
      const checkpoint = await page.evaluate(
        key => localStorage.getItem(key),
        returnKey,
      )
      assert.ok(checkpoint)
      const cancelledLocal = await snapshot(page, sharon)
      const cancelledCloud = await cloud(sharon)
      await page.evaluate(key => {
        window.fixtureReturnGeometry = []
        window.fixtureReturnWrites = []
        window.fixtureReturnScrollEvents = []
        window.addEventListener('scroll', () =>
          window.fixtureReturnScrollEvents.push(scrollY),
        )
        const write = Storage.prototype.setItem
        window.fixtureOriginalReturnWrite = write
        Storage.prototype.setItem = function (name, value) {
          if (name === key.replace('skyanchor:return:', 'skyanchor:following:'))
            window.fixtureReturnWrites.push({
              place: JSON.parse(value).place,
              y: scrollY,
              stack: new Error().stack,
            })
          return write.call(this, name, value)
        }
        window.fixtureDelayReturnResize = true
        window.fixtureCancelReturn = true
        const original = window.scrollBy.bind(window)
        window.fixtureOriginalReturnScroll = original
        window.scrollBy = (...args) => {
          const tabs = document.querySelector('[data-testid="profileFeedTabs"]')
          const before = tabs.getBoundingClientRect().bottom
          original(...args)
          const after = tabs.getBoundingClientRect().bottom
          const retained = !!localStorage.getItem(key)
          if (before > after) {
            tabs.style.transform = `translateY(${before - after}px)`
            requestAnimationFrame(() => {
              tabs.style.transform = ''
            })
          }
          if (window.fixtureCancelReturn) {
            window.fixtureCancelReturn = false
            window.dispatchEvent(new Event('touchstart'))
            requestAnimationFrame(() =>
              window.dispatchEvent(new Event('touchend')),
            )
          }
          window.fixtureReturnGeometry.push({
            before,
            after,
            checkpointRetained: retained,
            args,
            y: scrollY,
          })
        }
        const remove = Storage.prototype.removeItem
        window.fixtureOriginalReturnRemove = remove
        window.fixtureReturnConsumption = []
        Storage.prototype.removeItem = function (name) {
          if (name === key) {
            const place = JSON.parse(this.getItem(name)).snapshot.place
            const node = [
              ...document.querySelectorAll('[data-skyanchor-key]'),
            ].find(node => node.dataset.skyanchorKey === place.anchor)
            const header = document.querySelector(
              '[data-testid="profileFeedTabs"]',
            )
            window.fixtureReturnConsumption.push({
              delta:
                node.getBoundingClientRect().top -
                header.getBoundingClientRect().bottom -
                place.offset,
              local: JSON.parse(
                this.getItem(
                  name.replace('skyanchor:return:', 'skyanchor:following:'),
                ),
              ).place,
            })
          }
          return remove.call(this, name)
        }
      }, returnKey)
      await readingAction(page, 'Return to my place', sharon)
      await page.waitForTimeout(1000)
      assert.equal(
        await page.evaluate(key => localStorage.getItem(key), returnKey),
        checkpoint,
        'Cancelled placement must retain the exact durable Return checkpoint',
      )
      report.cancelledReturn = {
        before: JSON.parse(cancelledLocal).place,
        after: JSON.parse(await snapshot(page, sharon)).place,
        telemetry: await page.evaluate(() => ({
          writes: window.fixtureReturnWrites,
          scrolls: window.fixtureReturnScrollEvents,
          corrections: window.fixtureReturnGeometry,
        })),
      }
      assert.equal(
        await snapshot(page, sharon),
        cancelledLocal,
        'Cancelled restore and panel capture must not overwrite local progress',
      )
      assert.deepEqual(
        await cloud(sharon),
        cancelledCloud,
        'Cancelled restore cannot automatically save unconfirmed cloud progress',
      )
      await page
        .getByTestId('skyanchor-reading-button')
        .evaluate(node => node.click())
      await expect(toolbar(page, sharon)).toContainText(
        'Your saved place was not consumed.',
      )
      await closeReadingPanel(page)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(250)
      await readingAction(page, 'Return to my place', sharon)
      try {
        await expect
          .poll(() =>
            page.evaluate(() => window.fixtureReturnConsumption.length),
          )
          .toBe(1)
      } finally {
        report.finalReturnTelemetry = await page.evaluate(
          key => ({
            checkpointRetained: !!localStorage.getItem(key),
            local: JSON.parse(
              localStorage.getItem(
                key.replace('skyanchor:return:', 'skyanchor:following:'),
              ),
            ).place,
            y: scrollY,
            notices: [...document.querySelectorAll('[role="alert"]')].map(
              node => node.textContent,
            ),
            corrections: window.fixtureReturnGeometry,
            writes: window.fixtureReturnWrites,
          }),
          returnKey,
        )
      }
      report.returnGeometry = await page.evaluate(
        () => window.fixtureReturnGeometry,
      )
      const consumption = await page.evaluate(
        () => window.fixtureReturnConsumption,
      )
      assert.equal(consumption.length, 1)
      assert.ok(
        Math.abs(consumption[0].delta) <= 2,
        'Return checkpoint can be consumed only at the verified requested offset',
      )
      assert.deepEqual(consumption[0].local, place)
      assert.ok(report.returnGeometry.every(entry => entry.checkpointRetained))
      report.returnConsumption = consumption
      await page.evaluate(() => {
        window.scrollBy = window.fixtureOriginalReturnScroll
        Storage.prototype.removeItem = window.fixtureOriginalReturnRemove
        Storage.prototype.setItem = window.fixtureOriginalReturnWrite
        window.fixtureDelayReturnResize = false
      })
    },
  )
  await stable(
    'Profile cold reload retains anchor',
    page,
    sharon,
    place,
    async () => {
      await page.reload()
      await root(page, sharon)
        .locator('[data-skyanchor-key]')
        .first()
        .waitFor({timeout: 30000})
    },
  )
  const savedSharon = await snapshot(page, sharon)
  await page.getByRole('tab', {name: 'Replies', exact: true}).click()
  const replies = feed(authors[0], 'posts_with_replies')
  const repliesPlace = await move(page, replies, 8)
  await expect
    .poll(async () => (await cloud(replies))?.revision ?? 0)
    .toBeGreaterThan(0)
  assert.equal(
    await snapshot(page, sharon),
    savedSharon,
    'Inactive Posts tab cannot capture Replies scroll',
  )
  await followingUnchanged()
  await stable(
    'Profile Replies cold reopen and reselect retain anchor',
    page,
    replies,
    repliesPlace,
    async () => {
      await page.reload()
      await root(page, sharon)
        .locator('[data-skyanchor-key]')
        .first()
        .waitFor({timeout: 30000})
      await page.getByRole('tab', {name: 'Replies', exact: true}).click()
      await root(page, replies)
        .locator('[data-skyanchor-key]')
        .first()
        .waitFor({timeout: 30000})
    },
  )
  await page.getByRole('tab', {name: 'Posts', exact: true}).click()
  await page.waitForTimeout(1000)
  assert.equal(
    JSON.parse(await snapshot(page, sharon)).place.anchor,
    place.anchor,
  )
  const postsTop = await top(page, sharon, place)
  await page.getByRole('tab', {name: 'Media', exact: true}).click()
  const media = feed(authors[0], 'posts_with_media')
  await move(page, media, 7)
  await expect
    .poll(async () => (await cloud(media))?.revision ?? 0)
    .toBeGreaterThan(0)
  assert.equal(await snapshot(page, sharon), savedSharon)
  await page.getByRole('tab', {name: 'Posts', exact: true}).click()
  await page.waitForTimeout(900)
  assert.ok(
    Math.abs((await top(page, sharon, place)) - postsTop) <= 2,
    'Switching tabs restores the Posts within-row offset',
  )
  await followingUnchanged()
  await open(page, authors[1])
  const another = feed(authors[1])
  await move(page, another, 10)
  await expect
    .poll(async () => (await cloud(another))?.revision ?? 0)
    .toBeGreaterThan(0)
  assert.equal(await snapshot(page, sharon), savedSharon)
  await followingUnchanged()
  await page.goto(origin + '/')
  await page.getByTestId('skyanchor-reading-button').waitFor({timeout: 30000})
  await page.waitForTimeout(1000)
  await followingUnchanged()
  const followingPlace = JSON.parse(originalLocal).place
  const followingTop = await top(page, 'following', followingPlace)
  await open(phonePage, authors[0])
  await verifyReadingPanel(phonePage, report, sharon)
  await readingAction(phonePage, 'Resume other device', sharon)
  const remoteBeforeMove = JSON.parse((await cloud(sharon)).state)
  const phonePlace = await move(phonePage, sharon, 10, 145)
  await phonePage.evaluate(() => window.scrollBy(0, 80))
  await phonePage.waitForTimeout(200)
  await phonePage.evaluate(() => window.scrollBy(0, -80))
  await expect
    .poll(async () => JSON.parse(await snapshot(phonePage, sharon)).place)
    .toEqual(phonePlace)
  assert.notDeepEqual(
    phonePlace,
    remoteBeforeMove,
    'Phone motion must actually change the remote place',
  )
  await expect
    .poll(async () => (await cloud(sharon))?.state)
    .toBe(JSON.stringify(phonePlace))
  assert.equal(
    (await cloud(sharon)).device,
    await phonePage.evaluate(() => localStorage.getItem('skyanchor:device')),
    'Actual author save must be attributed to the phone device',
  )
  await stable(
    'WebKit profile cold resume with media retains anchor',
    phonePage,
    sharon,
    phonePlace,
    async () => {
      await phonePage.reload()
      await root(phonePage, sharon)
        .locator('[data-skyanchor-key]')
        .first()
        .waitFor({timeout: 30000})
    },
  )
  await readingAction(page, 'Check other device', 'following')
  await page.waitForTimeout(900)
  assert.ok(
    Math.abs((await top(page, 'following', followingPlace)) - followingTop) <=
      2,
    'Remote author progress cannot jump active Following',
  )
  await followingUnchanged()
  const beforeOffline = await cloud(sharon)
  await verifyViewport({page: phonePage, report, profile: true})
  assert.deepEqual(
    await cloud(sharon),
    beforeOffline,
    'Profile viewport changes do not alter the cloud row/revision',
  )
  const failedPoll = phonePage.waitForEvent('requestfailed', {
    predicate: request =>
      request.method() === 'GET' &&
      request.url() ===
        phoneService + '/xrpc/app.bsky.notification.listNotifications?limit=40',
    timeout: 35000,
  })
  await setConnectivity(phonePage.context(), true)
  await readingAction(phonePage, 'Save my place', sharon)
  await expect(toolbar(phonePage, sharon)).toContainText(
    'Offline: no write sent.',
  )
  await closeReadingPanel(phonePage)
  await expect(
    phonePage.getByTestId('skyanchor-reading-button'),
  ).toHaveAccessibleName(/Reading place: Sync error: Offline: no write sent/)
  await expect(
    phonePage.getByTestId('skyanchor-reading-indicator'),
  ).toBeVisible()
  assert.deepEqual(await cloud(sharon), beforeOffline)
  await phonePage.waitForTimeout(31000)
  await failedPoll
  const recoveredPoll = phonePage.waitForResponse(
    response =>
      response.status() === 200 &&
      response.request().method() === 'GET' &&
      response.url() ===
        phoneService + '/xrpc/app.bsky.notification.listNotifications?limit=40',
    {timeout: 35000},
  )
  await setConnectivity(phonePage.context(), false)
  await recoveredPoll
  report.checks.push(
    'A real WebKit notification poll fails inside the forced offline interval and recovers after reconnect without an unhandled rejection or changing saved author progress',
  )
  await open(page, authors[0])
  await readingAction(page, 'Check other device', sharon)
  await readingAction(page, 'Resume other device', sharon)
  const baseline = (await cloud(sharon)).revision
  await readingAction(page, 'Save my place', sharon)
  await expect
    .poll(async () => (await cloud(sharon)).revision)
    .toBeGreaterThan(baseline)
  const staleResponse = phonePage.waitForResponse(
    response =>
      response.status() === 409 &&
      new URL(response.url()).searchParams.get('feed') === sharon &&
      response.request().method() === 'PUT',
  )
  await readingAction(phonePage, 'Save my place', sharon)
  await staleResponse
  await expect(toolbar(phonePage, sharon)).toContainText('CAS conflict')
  await closeReadingPanel(phonePage)
  await expect(
    phonePage.getByTestId('skyanchor-reading-button'),
  ).toHaveAccessibleName(/Reading place: Sync error: CAS conflict/)
  await followingUnchanged()
  await page.goto(origin + '/')
  await page.getByTestId('skyanchor-reading-button').waitFor({timeout: 30000})
  await phonePage.goto(origin + '/')
  await phonePage
    .getByTestId('skyanchor-reading-button')
    .waitFor({timeout: 30000})
  report.checks.push(
    'Actual selected-DID Profile Posts/Replies/Media reading, header layout, buffered refresh/latest/Return, desktop/WebKit cold reload and tab/author navigation preserve independent Following local/cloud bytes; two browser contexts synchronize only the selected author without moving active Following, reject offline writes and visibly resolve stale author CAS.',
  )
}
