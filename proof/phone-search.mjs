import assert from 'node:assert/strict'
import {devices, expect} from '@playwright/test'

export async function verifyPhoneSearch({
  phoneBrowser,
  mockUpstream,
  signIn,
  origin,
  report,
}) {
  for (const scale of ['0', '-1', '1']) {
    const context = await phoneBrowser.newContext({
      ...devices['iPhone 13'],
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    try {
      await context.addInitScript(scale => {
        localStorage.setItem(
          'bsky_device\\fontScale',
          JSON.stringify({data: scale}),
        )
      }, scale)
      await mockUpstream(context, 'did:plc:' + 'search'.repeat(4))
      const page = await context.newPage()
      await signIn(page, 'reader.test')
      await page.goto(origin + '/search')
      const input = page.getByTestId('searchScreenInput')
      await expect(input).toBeVisible()
      const fontSize = await input.evaluate(node =>
        parseFloat(getComputedStyle(node).fontSize),
      )
      assert.ok(
        fontSize >= 16,
        `iPhone search font ${fontSize}px at text scale ${scale} must avoid focus auto-zoom`,
      )
      const viewport = await page
        .locator('meta[name="viewport"]')
        .getAttribute('content')
      assert.ok(
        !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/i.test(viewport),
        'Pinch zoom must remain permitted',
      )
      await input.tap()
      await input.fill('reader')
      const option = page
        .getByRole('option')
        .filter({hasText: 'Fixture Reader'})
        .first()
      await expect(option).toBeVisible()
      await option.tap()
      await page.waitForURL(/\/profile\//)
      assert.equal(
        await input
          .evaluate(node => node === document.activeElement)
          .catch(() => false),
        false,
      )
      assert.ok(
        await page.evaluate(
          () => !(document.activeElement instanceof HTMLInputElement),
        ),
        'Search must release focus and keyboard before opening a profile',
      )
      report.measurements.push({
        name: 'Phone WebKit search input',
        scale,
        fontSizeCSSPx: fontSize,
      })
    } finally {
      await context.close()
    }
  }
  report.checks.push(
    'Phone WebKit search uses at least 16px after small/default/large text scaling, blurs before profile selection and keeps pinch zoom allowed. Headless WebKit does not reproduce physical iOS keyboard zoom.',
  )
}
