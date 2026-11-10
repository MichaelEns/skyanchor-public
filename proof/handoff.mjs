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
}) {
  const did = 'did:plc:eeeeeeeeeeeeeeeeeeeeeeee'
  const contexts = []
  const failures = []
  const records = []
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
      const controls = await mockUpstream(context, did)
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
    // Load real successive timeline pages; B and C keep their different, fresh windows.
    for (let i = 0; i < 3; i++) {
      const count = await a.locator('[data-skyanchor-key]').count()
      if (await a.locator('[data-skyanchor-key*="/post70|"]').count()) break
      await a.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      )
      await expect
        .poll(() => a.locator('[data-skyanchor-key]').count())
        .toBeGreaterThan(count)
    }
    const target = a.locator('[data-skyanchor-key*="/post70|repost:"]').last()
    await target.scrollIntoViewIfNeeded()
    await target.evaluate(node =>
      window.scrollBy(0, node.getBoundingClientRect().top + 37),
    )
    await expect
      .poll(async () => (await local(a))?.anchor.includes('/post70|repost:'))
      .toBe(true)
    await readingAction(a, 'Connect private sync')
    await expect(
      a.getByRole('button', {name: 'Save my place', exact: true}),
    ).toBeVisible()
    await closeReadingPanel(a)
    const first = await confirmation(a)
    const place = JSON.parse(first.state)
    assert.ok(place.anchor.includes('/post70|repost:did:'))
    assert.ok(place.anchor.includes('|reply:at://'))
    for (const page of [b, c]) {
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
      await readingAction(page, 'Connect private sync')
      await expect(
        page.getByRole('button', {name: 'Resume other device', exact: true}),
      ).toBeVisible()
      assert.equal(await page.evaluate(() => window.scrollY), y)
      await closeReadingPanel(page)
    }
    await resume(b, place)
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
    const missingUri = JSON.parse(third.state).anchor.split('|')[0]
    deleted.add(missingUri)
    try {
      const before = await local(b)
      const checkpoint = await b.evaluate(
        did => localStorage.getItem('skyanchor:return:v1:' + did),
        did,
      )
      await offer(b)
      await readingAction(b, 'Resume other device')
      await readingPanel(b)
      await expect(
        b.getByText(/Could not restore the exact saved occurrence/),
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
      persistedRegionalReload: true,
      errors: failures,
    }
    report.checks.push(
      'Three independent browser profiles (email entryway, WebKit regional handle, cold persisted regional desktop) hand off a deep exact repost/reply occurrence outside fresh windows through real D1 CAS. Offers never jump or write; expired access/cookie renewal and failure recovery preserve local state.',
    )
  } finally {
    for (const context of contexts) await context.close()
  }
}
