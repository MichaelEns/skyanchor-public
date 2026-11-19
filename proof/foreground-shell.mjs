import assert from 'node:assert/strict'
import {devices, expect} from '@playwright/test'
import {installViewportFixture} from './viewport.mjs'

export async function verifyForegroundShell({
  phoneBrowser,
  mockUpstream,
  signIn,
  origin,
  report,
}) {
  const context = await phoneBrowser.newContext({
    ...devices['iPhone 13'],
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  })
  await context.addInitScript(installViewportFixture)
  await mockUpstream(context, 'did:plc:' + 'shella'.repeat(4))
  const page = await context.newPage()
  try {
    await signIn(page, 'reader.test')
    const footer = page.getByTestId('mobileBottomBar')
    const compose = page.getByTestId('composeFAB')
    const arrow = page.getByTestId('loadLatestBtn')
    await expect(compose).toBeVisible()
    await expect(arrow).toBeVisible()
    await page.waitForTimeout(1800)
    const saved = () =>
      page.evaluate(() => ({
        y: scrollY,
        places: Object.fromEntries(
          Object.entries(localStorage).filter(([key]) =>
            /^skyanchor:(following|return|revision|historic-local)/.test(key),
          ),
        ),
      }))
    const geometry = () =>
      page.evaluate(() => {
        const rect = id =>
          document
            .querySelector(`[data-testid="${id}"]`)
            .getBoundingClientRect()
        const footer = rect('mobileBottomBar')
        return {
          footerTop: footer.top,
          footerBottom: footer.bottom,
          composeBottom: rect('composeFAB').bottom,
          arrowBottom: rect('loadLatestBtn').bottom,
          visibleBottom: visualViewport.offsetTop + visualViewport.height,
        }
      })
    const before = await saved()
    for (const [name, height] of [
      ['collapsed footer measurement', 0],
      ['stale tall footer measurement', 360],
    ]) {
      await page.waitForTimeout(1800)
      await footer.evaluate((node, height) => {
        // Reproduce a stale native onLayout report without changing the real footer.
        node.__reactLayoutHandler({nativeEvent: {layout: {height}}})
      }, height)
      await page.waitForTimeout(100)
      const stale = await geometry()
      assert.ok(
        Math.abs(stale.footerTop - stale.composeBottom - 16) > 20,
        'The fixture must first reproduce the displaced button',
      )
      await page.evaluate(() => {
        dispatchEvent(new Event('focus'))
        dispatchEvent(new Event('pageshow'))
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await expect
        .poll(
          async () => {
            const actual = await geometry()
            return Math.max(
              Math.abs(actual.footerTop - actual.composeBottom - 16),
              Math.abs(actual.footerTop - actual.arrowBottom - 16),
            )
          },
          {timeout: 3000},
        )
        .toBeLessThanOrEqual(2)
      assert.deepEqual(
        await saved(),
        before,
        'Foreground geometry must not save or scroll the feed',
      )
      report.measurements.push({
        name: `Phone WebKit ${name}`,
        stale,
        recovered: await geometry(),
      })
    }

    for (const [name, height, offsetTop] of [
      ['late keyboard-sized viewport', 430, 25],
      ['late expanded viewport', 914, 20],
    ]) {
      await page.evaluate(
        ({height, offsetTop}) => {
          window.fixtureViewport({height, offsetTop, scale: 1})
        },
        {height, offsetTop},
      )
      await page.waitForTimeout(100)
      await page.evaluate(() => {
        dispatchEvent(new Event('pageshow'))
        document.dispatchEvent(new Event('visibilitychange'))
        // iOS may update its metrics after the foreground event without another resize.
        setTimeout(() => window.fixtureViewportSilent(undefined), 180)
      })
      await expect
        .poll(
          async () => {
            const actual = await geometry()
            return Math.max(
              Math.abs(actual.footerBottom - actual.visibleBottom),
              Math.abs(actual.footerTop - actual.composeBottom - 16),
              Math.abs(actual.footerTop - actual.arrowBottom - 16),
            )
          },
          {timeout: 3000},
        )
        .toBeLessThanOrEqual(2)
      await page.waitForTimeout(450)
      const actual = await geometry()
      assert.ok(Math.abs(actual.footerBottom - actual.visibleBottom) <= 2)
      assert.deepEqual(await saved(), before)
      report.measurements.push({
        name: `Phone WebKit ${name}`,
        recovered: await geometry(),
      })
    }
    await compose.click()
    const dialog = page.getByTestId('composePostView')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click()
    await expect(dialog).toHaveCount(0)
    await expect(arrow.getByRole('button')).toBeVisible()
    report.checks.push(
      'Phone WebKit foreground remeasures real footer height after stale low/high onLayout reports and late silent visual-viewport restoration; both buttons settle 16px above navigation within 2px without changing scroll or reading bytes. Simulated lifecycle, not physical iOS suspension.',
    )
  } finally {
    await context.close()
  }
}
