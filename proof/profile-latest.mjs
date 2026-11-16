import assert from 'node:assert/strict'
import {devices, expect} from '@playwright/test'
import {
  closeReadingPanel,
  readingAction,
  readingPanel,
  scrollReading,
} from './reading-panel.mjs'

export async function verifyProfileLatest({
  desktopBrowser,
  phoneBrowser,
  mockUpstream,
  signIn,
  worker,
  author,
  original,
  origin,
  report,
  labeler,
}) {
  for (const [index, browser] of [desktopBrowser, phoneBrowser].entries()) {
    const owner = 'did:plc:' + (index ? 'recent' : 'latest').repeat(4)
    const identity = `author|${author}|posts_and_author_threads`
    const key = 'skyanchor:following:v1:' + owner + ':' + identity
    const returnKey = key.replace('skyanchor:following:', 'skyanchor:return:')
    const context = await browser.newContext({
      ...(index
        ? devices['iPhone 13']
        : {viewport: {width: 1280, height: 900}}),
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    let mode = 'original'
    let freshReads = 0
    let privatePuts = 0
    const fresh = original.map((item, i) => ({
      ...item,
      post: {
        ...item.post,
        uri: `at://${author}/app.bsky.feed.post/latest-${index}-${i}`,
        record: {
          ...item.post.record,
          text: `Fixture latest profile ${index} post ${i}.`,
        },
        ...(i === 0
          ? {
              labels: [
                {
                  src: labeler,
                  uri: `at://${author}/app.bsky.feed.post/latest-${index}-${i}`,
                  val: '!hide',
                  cts: new Date().toISOString(),
                },
              ],
            }
          : {}),
      },
    }))
    const values = new Map(
      [...original, ...fresh].map(item => [item.post.uri, item.post]),
    )
    try {
      await mockUpstream(context, owner)
      await context.route(
        '**/xrpc/app.bsky.feed.getAuthorFeed*',
        async route => {
          const url = new URL(route.request().url())
          if (mode === 'original' || url.searchParams.get('actor') !== author)
            return route.fallback()
          freshReads++
          if (mode === 'failure')
            return route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({
                error: 'Unavailable',
                message: 'Fixture latest unavailable',
              }),
            })
          const start = Number(url.searchParams.get('cursor') || 0)
          const limit = Number(url.searchParams.get('limit') || 30)
          const rows = mode === 'empty' ? [] : fresh.slice(start, start + limit)
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
              feed: rows,
              ...(rows.length && start + limit < fresh.length
                ? {cursor: String(start + limit)}
                : {}),
            }),
          })
        },
      )
      await context.route('**/xrpc/app.bsky.feed.getPosts*', async route => {
        const uris = new URL(route.request().url()).searchParams.getAll('uris')
        if (!uris.some(uri => uri.includes('/latest-'))) return route.fallback()
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            posts: uris.map(uri => values.get(uri)).filter(Boolean),
          }),
        })
      })
      const current = await context.newPage()
      const failures = []
      current.on('requestfailed', request =>
        failures.push({
          path: new URL(request.url()).pathname,
          error: request.failure()?.errorText,
        }),
      )
      current.on('response', response => {
        if (response.status() >= 400)
          failures.push({
            path: new URL(response.url()).pathname,
            status: response.status(),
          })
      })
      current.on('request', request => {
        if (
          request.method() === 'PUT' &&
          request.url().includes('/api/skyanchor/place')
        )
          privatePuts++
      })
      try {
        await signIn(current)
      } catch (error) {
        console.error(
          'Profile latest fixture sign-in failures:',
          JSON.stringify({index, failures}),
        )
        throw error
      }
      const followingKey = 'skyanchor:following:v1:' + owner
      await current.goto(origin + '/profile/sharon-fixture.test')
      const root = current
        .locator(`[data-skyanchor-feed="${identity}"]`)
        .filter({visible: true})
      await root.locator('[data-skyanchor-key]').nth(14).waitFor()
      const following = await current.evaluate(
        key => localStorage.getItem(key),
        followingKey,
      )
      await root
        .locator('[data-skyanchor-key]')
        .nth(14)
        .scrollIntoViewIfNeeded()
      await scrollReading(current, 70)
      await expect
        .poll(() => current.evaluate(key => localStorage.getItem(key), key))
        .not.toBeNull()
      await readingAction(current, 'Connect private sync', identity)
      await readingAction(current, 'Save my place', identity)
      await expect(current.getByTestId('skyanchor-source-state')).toContainText(
        'confirmed shared',
      )
      await closeReadingPanel(current)
      await current.waitForTimeout(1000)
      const bytes = () =>
        current.evaluate(
          ({key, returnKey}) => ({
            local: localStorage.getItem(key),
            back: localStorage.getItem(returnKey),
          }),
          {key, returnKey},
        )
      const baseline = await bytes()
      const cloud = async () => ({
        place: await worker.db
          .prepare('SELECT * FROM places WHERE did = ? AND feed = ?')
          .bind(owner, identity)
          .first(),
        history: (
          await worker.db
            .prepare(
              'SELECT * FROM reading_history WHERE did = ? AND feed = ? ORDER BY revision',
            )
            .bind(owner, identity)
            .all()
        ).results,
      })
      const cloudBefore = await cloud()
      const putsBefore = privatePuts
      const beforePlace = JSON.parse(baseline.local).place
      const geometry = () =>
        current.evaluate(identity => {
          const root = [
            ...document.querySelectorAll('[data-skyanchor-feed]'),
          ].find(
            node =>
              node.dataset.skyanchorFeed === identity &&
              node.getClientRects().length,
          )
          const bottom = document
            .querySelector('[data-testid="profileFeedTabs"]')
            .getBoundingClientRect().bottom
          const row = [...root.querySelectorAll('[data-skyanchor-key]')].find(
            node => node.getBoundingClientRect().bottom > bottom + 1,
          )
          return {
            key: row?.dataset.skyanchorKey,
            offset: row?.getBoundingClientRect().top - bottom,
          }
        }, identity)
      const originalGeometry = await geometry()
      mode = 'fresh'
      await readingAction(
        current,
        'Load new posts without moving your place',
        identity,
      )
      await expect(
        current.getByTestId('skyanchor-reading-button'),
      ).toHaveAccessibleName(/Could not connect all newer history/)
      assert.deepEqual(
        await bytes(),
        baseline,
        'Default bridge failure keeps the original context',
      )
      assert.equal((await geometry()).key, originalGeometry.key)
      await readingAction(current, 'Go to latest posts', identity)
      await expect(
        current.getByTestId('skyanchor-resume-result'),
      ).toContainText('Latest posts opened locally')
      await expect
        .poll(async () => (await geometry()).key)
        .toContain('/latest-')
      const latest = await geometry()
      assert.equal(
        latest.key.split('|')[0],
        fresh[1].post.uri,
        'Latest skips a currently hidden first post',
      )
      assert.ok(
        Math.abs(latest.offset) <= 2,
        `Latest post placement drift: ${latest.offset}`,
      )
      const afterLatest = await bytes()
      assert.equal(
        JSON.parse(afterLatest.back).snapshot.place.anchor,
        beforePlace.anchor,
      )
      assert.deepEqual(await cloud(), cloudBefore)
      assert.equal(
        privatePuts,
        putsBefore,
        'Going latest does not publish or mark fetched posts read',
      )
      mode = 'original'
      await readingAction(current, 'Return to my place', identity)
      await expect
        .poll(async () => (await geometry()).key)
        .toBe(originalGeometry.key)
      assert.ok(
        Math.abs((await geometry()).offset - originalGeometry.offset) <= 2,
      )
      await expect.poll(async () => (await bytes()).back).toBeNull()
      const restored = await bytes()
      mode = 'failure'
      await readingAction(current, 'Go to latest posts', identity)
      await expect(
        current.getByTestId('skyanchor-reading-button'),
      ).toHaveAccessibleName(/Could not open latest posts/)
      assert.deepEqual(await bytes(), restored)
      mode = 'empty'
      await readingAction(current, 'Go to latest posts', identity)
      await expect(
        current.getByTestId('skyanchor-reading-button'),
      ).toHaveAccessibleName(/No displayable posts/)
      assert.deepEqual(await bytes(), restored)
      assert.equal((await geometry()).key, originalGeometry.key)
      assert.ok(
        Math.abs((await geometry()).offset - originalGeometry.offset) <= 2,
      )
      const keptReturn = afterLatest.back
      await current.evaluate(
        ({returnKey, keptReturn}) =>
          localStorage.setItem(returnKey, keptReturn),
        {returnKey, keptReturn},
      )
      mode = 'fresh'
      await readingAction(current, 'Go to latest posts', identity)
      await expect(
        current.getByTestId('skyanchor-resume-result'),
      ).toContainText('Latest posts opened locally')
      assert.equal(
        (await bytes()).back,
        keptReturn,
        'An existing Return is never overwritten',
      )
      await expect
        .poll(async () => JSON.parse((await bytes()).local).place.anchor)
        .toContain('/latest-')
      await current.reload()
      await root.locator('[data-skyanchor-key]').first().waitFor()
      await expect
        .poll(async () => (await geometry()).key)
        .toContain('/latest-')
      assert.equal((await bytes()).back, keptReturn)
      assert.deepEqual(await cloud(), cloudBefore)
      assert.equal(privatePuts, putsBefore)
      assert.equal(
        await current.evaluate(key => localStorage.getItem(key), followingKey),
        following,
      )
      const panel = await readingPanel(current, identity)
      await expect(panel).toContainText('newest displayable post')
      report.measurements.push({
        name: `${index ? 'Phone WebKit' : 'Chromium'} profile latest context`,
        offsetCSSPx: latest.offset,
        freshReads,
        noPrivateProgressWrites: true,
      })
      report.checks.push(
        `${index ? 'Phone WebKit' : 'Chromium'} stale author bridge fails without moving; explicit latest uses a fresh moderated window, settles within 2px, preserves Return/cloud/history/Following and survives reload; failed/empty latest rolls back.`,
      )
      await closeReadingPanel(current)
      await current.goto(origin + '/settings')
      await current
        .getByRole('button', {name: 'Sign out', exact: true})
        .first()
        .click()
      await current.getByText('Sign out?', {exact: true}).waitFor()
      await current
        .getByRole('button', {name: 'Sign out', exact: true})
        .last()
        .click()
      await expect
        .poll(
          async () =>
            (
              await worker.db
                .prepare('SELECT COUNT(*) AS count FROM sessions WHERE did = ?')
                .bind(owner)
                .first()
            ).count,
        )
        .toBe(0)
    } finally {
      await context.close()
    }
  }
}
