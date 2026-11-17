import assert from 'node:assert/strict'
import {devices, expect} from '@playwright/test'
import {
  readingAction,
  readingPanel,
  closeReadingPanel,
  scrollReading,
} from './reading-panel.mjs'

export async function verifyLocalSaving({
  desktopBrowser,
  phoneBrowser,
  mockUpstream,
  signIn,
  worker,
  report,
}) {
  for (const [index, browser] of [desktopBrowser, phoneBrowser].entries()) {
    const did = 'did:plc:' + (index ? 'phonea' : 'localc').repeat(4)
    const context = await browser.newContext({
      ...(index
        ? devices['iPhone 13']
        : {viewport: {width: 1280, height: 900}}),
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    try {
      await mockUpstream(context, did)
      await context.addInitScript(() => {
        const set = Storage.prototype.setItem
        window.fixtureSaveMode = 'normal'
        window.fixtureSaveAttempts = []
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith('skyanchor:following:v1:')) {
            window.fixtureSaveAttempts.push({
              key,
              size: value.length,
              mode: window.fixtureSaveMode,
            })
            if (
              window.fixtureSaveMode === 'denied' ||
              (window.fixtureSaveMode === 'limited' && value.length > 6000)
            )
              throw new DOMException(
                'Fixture on-device storage pressure',
                'QuotaExceededError',
              )
          }
          return set.call(this, key, value)
        }
      })
      const page = await context.newPage()
      let puts = 0
      page.on('request', request => {
        if (
          new URL(request.url()).pathname === '/api/skyanchor/place' &&
          request.method() === 'PUT'
        )
          puts++
      })
      await signIn(page, 'reader.test')
      await readingAction(page, 'Connect private sync')
      await expect(
        page.getByRole('button', {name: 'Save my place', exact: true}),
      ).toBeEnabled()
      await readingAction(page, 'Save my place')
      await expect(page.getByTestId('skyanchor-source-state')).toContainText(
        'confirmed shared',
      )
      await closeReadingPanel(page)
      await page.waitForTimeout(1000)
      const key = 'skyanchor:following:v1:' + did
      const local = () => page.evaluate(key => localStorage.getItem(key), key)
      const data = async () => ({
        place: await worker.db
          .prepare("SELECT * FROM places WHERE did = ? AND feed = 'following'")
          .bind(did)
          .first(),
        history: (
          await worker.db
            .prepare(
              'SELECT * FROM reading_history WHERE did = ? ORDER BY revision',
            )
            .bind(did)
            .all()
        ).results,
      })
      const before = await local()
      const cloudBefore = await data()
      const putBefore = puts
      const retained = await page.evaluate(did => {
        const key = 'skyanchor:return:v1:' + did
        localStorage.setItem(key, 'fixture-retain-return')
        localStorage.setItem('fixture-unrelated-progress', 'retain-other')
        return localStorage.getItem(key)
      }, did)
      await page.evaluate(() => {
        window.fixtureSaveMode = 'denied'
      })
      await scrollReading(page, 600)
      await readingPanel(page)
      await expect(
        page.getByTestId('skyanchor-local-save-error'),
      ).toContainText('On-device storage could not save even this post')
      await expect(page.getByTestId('skyanchor-source-state')).toContainText(
        'not saved locally',
      )
      await readingAction(page, 'Save my place')
      await expect(page.getByTestId('skyanchor-toolbar')).toContainText(
        'On-device storage could not save even this post',
      )
      assert.equal(await local(), before)
      assert.deepEqual(await data(), cloudBefore)
      assert.equal(
        puts,
        putBefore,
        'No cloud write can claim an unsaved local position',
      )
      await closeReadingPanel(page)
      const geometry = () =>
        page.evaluate(() => {
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
          return {
            key: row?.dataset.skyanchorKey,
            top: row?.getBoundingClientRect().top,
          }
        })
      const visibleBefore = await geometry()
      await page.evaluate(() => dispatchEvent(new Event('resize')))
      await page.waitForTimeout(350)
      const visibleAfter = await geometry()
      assert.equal(
        visibleAfter.key,
        visibleBefore.key,
        'Local failure must not pull back to an older durable anchor',
      )
      assert.ok(Math.abs(visibleAfter.top - visibleBefore.top) <= 2)
      await page.evaluate(() => {
        window.fixtureSaveMode = 'limited'
      })
      await scrollReading(page, 90)
      await expect.poll(async () => await local()).not.toBe(before)
      const recovered = JSON.parse(await local())
      assert.ok(recovered.feed.length >= 1 && recovered.feed.length < 90)
      assert.ok(
        recovered.feed.some(
          item => item.post.uri === recovered.place.anchor.split('|')[0],
        ),
      )
      await readingPanel(page)
      await expect(page.getByTestId('skyanchor-local-save-error')).toHaveCount(
        0,
      )
      await readingAction(page, 'Save my place')
      await expect(page.getByTestId('skyanchor-source-state')).toContainText(
        'Current local place confirmed shared',
      )
      const saved = await data()
      assert.ok(saved.place.revision > cloudBefore.place.revision)
      assert.equal(saved.place.state, JSON.stringify(recovered.place))
      assert.equal(
        saved.place.device,
        await page.evaluate(() => localStorage.getItem('skyanchor:device')),
      )
      assert.equal(
        await page.evaluate(
          did => localStorage.getItem('skyanchor:return:v1:' + did),
          did,
        ),
        retained,
      )
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem('fixture-unrelated-progress'),
        ),
        'retain-other',
      )
      // Remove only the synthetic invalid Return sentinel before exercising a cold reopen.
      await page.evaluate(
        did => localStorage.removeItem('skyanchor:return:v1:' + did),
        did,
      )
      await page.evaluate(() => {
        window.fixtureSaveMode = 'normal'
      })
      await closeReadingPanel(page)
      await page.reload()
      await page.getByTestId('skyanchor-reading-button').waitFor()
      await expect
        .poll(async () => JSON.parse(await local()).place.anchor)
        .toBe(recovered.place.anchor)
      assert.equal((await data()).place.state, JSON.stringify(recovered.place))
      report.measurements.push({
        name: `${index ? 'Phone WebKit' : 'Chromium'} on-device save recovery`,
        reducedRecords: recovered.feed.length,
        localBytes: (await local()).length,
        noFailedLocalPUTs: true,
      })
      report.checks.push(
        `${index ? 'Phone WebKit' : 'Chromium'} denied local storage is explicit and prevents cloud writes; a smaller exact-occurrence cache saves under quota without evicting other state, clears the error and explicitly shares the correct place.`,
      )
      await page.goto(new URL('/settings', page.url()).href)
      await page
        .getByRole('button', {name: 'Sign out', exact: true})
        .first()
        .click()
      await page.getByText('Sign out?', {exact: true}).waitFor()
      await page
        .getByRole('button', {name: 'Sign out', exact: true})
        .last()
        .click()
      await expect
        .poll(
          async () =>
            (
              await worker.db
                .prepare('SELECT COUNT(*) AS count FROM sessions WHERE did = ?')
                .bind(did)
                .first()
            ).count,
        )
        .toBe(0)
    } finally {
      await context.close()
    }
  }
}
