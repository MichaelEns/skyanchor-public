import assert from 'node:assert/strict'
import {expect, devices} from '@playwright/test'
import {installViewportFixture} from './viewport.mjs'

export async function verifyStartup({
  browser,
  phone,
  seedPage,
  origin,
  mockUpstream,
  did,
  report,
}) {
  await seedPage
    .locator('[data-skyanchor-key]')
    .filter({hasText: 'Fixture post 20.'})
    .first()
    .scrollIntoViewIfNeeded()
  await seedPage.evaluate(() => window.scrollBy(0, 80))
  await seedPage.waitForTimeout(500)
  const seed = await seedPage.context().storageState()
  const readingKey = 'skyanchor:following:v1:' + did
  const saved = seed.origins
    .find(entry => entry.origin === origin)
    .localStorage.find(entry => entry.name === readingKey).value
  const anchor = JSON.parse(saved).place.anchor
  const before = await seedPage.evaluate(
    key =>
      [...document.querySelectorAll('[data-skyanchor-key]')]
        .find(node => node.dataset.skyanchorKey === key)
        .getBoundingClientRect().top,
    anchor,
  )

  for (const scenario of [
    'geo',
    'geo-cached-adult',
    'refresh',
    'foreground',
    'age',
    'chunk',
    'locale',
    'fade-cancel',
    'fade-pause',
    'cached-geo',
  ]) {
    console.log(
      `Startup fixture: ${phone ? 'WebKit phone' : 'Chromium'} ${scenario}`,
    )
    const storageState =
      scenario === 'geo-cached-adult'
        ? await seedPage.context().storageState({indexedDB: true})
        : structuredClone(seed)
    const entries = storageState.origins.find(
      entry => entry.origin === origin,
    ).localStorage
    if (scenario === 'geo' || scenario === 'geo-cached-adult') {
      for (let index = entries.length - 1; index >= 0; index--) {
        if (
          /bsky_device\\(?:geolocationServiceResponse|mergedGeolocation)$/.test(
            entries[index].name,
          )
        )
          entries.splice(index, 1)
      }
    }
    if (scenario === 'geo-cached-adult') {
      const database = storageState.origins
        .find(entry => entry.origin === origin)
        .indexedDB.find(
          entry => entry.name === 'react-query-cache-age-assurance',
        )
      assert.ok(database, 'The fixture reuses the actual persisted AA database')
      const record = database.stores
        .find(entry => entry.name === database.name)
        .records.find(entry => entry.key === 'age-assurance-query-client')
      const cache = JSON.parse(record.value)
      const config = cache.clientState.queries.find(
        query => JSON.stringify(query.queryKey) === '["config"]',
      )
      const account = cache.clientState.queries.find(
        query =>
          JSON.stringify(query.queryKey) ===
          JSON.stringify(['otherRequiredData', did]),
      )
      assert.ok(
        config && account,
        'Real config and adult account queries must already be cached',
      )
      config.state.data = {
        regions: [
          {
            countryCode: 'GB',
            minAccessAge: 13,
            rules: [
              {
                $type:
                  'app.bsky.ageassurance.defs#configRegionRuleIfAssuredOverAge',
                age: 18,
                access: 'full',
              },
              {
                $type: 'app.bsky.ageassurance.defs#configRegionRuleDefault',
                access: 'safe',
              },
            ],
          },
        ],
      }
      assert.equal(account.state.data.birthdate.slice(0, 10), '1990-01-01')
      const serverStateKey = ['serverState', did]
      let serverState = cache.clientState.queries.find(
        query =>
          JSON.stringify(query.queryKey) === JSON.stringify(serverStateKey),
      )
      if (!serverState) {
        serverState = structuredClone(config)
        serverState.queryKey = serverStateKey
        serverState.queryHash = JSON.stringify(serverStateKey)
        cache.clientState.queries.push(serverState)
      }
      serverState.state.data = {
        state: {status: 'assured', access: 'full'},
        metadata: {accountCreatedAt: '2024-01-01T00:00:00.000Z'},
      }
      record.value = JSON.stringify(cache)
    }
    if (scenario === 'refresh' || scenario === 'foreground') {
      const entry = entries.find(entry => entry.name === 'BSKY_STORAGE')
      const data = JSON.parse(entry.value)
      for (const account of [
        ...data.session.accounts,
        data.session.currentAccount,
      ]) {
        if (!account) continue
        const parts = account.accessJwt.split('.')
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url'))
        payload.exp = Math.floor(Date.now() / 1000) - 3600
        parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url')
        account.accessJwt = parts.join('.')
      }
      entry.value = JSON.stringify(data)
    }
    if (scenario === 'age') {
      for (let index = entries.length - 1; index >= 0; index--)
        if (entries[index].name.includes('age-assurance'))
          entries.splice(index, 1)
    }
    const context = await browser.newContext({
      viewport: phone ? {width: 390, height: 844} : {width: 1280, height: 900},
      ...(phone
        ? {
            userAgent: devices['iPhone 13'].userAgent,
            isMobile: true,
            hasTouch: true,
            ignoreHTTPSErrors: true,
          }
        : {}),
      serviceWorkers: 'block',
      storageState,
    })
    let release
    const held = new Promise(resolve => {
      release = resolve
    })
    let hanging = true
    let reached = 0
    const heldRequests = new Set()
    const failures = []
    const pageErrors = []
    const unexpectedFailures = []
    let current
    try {
      await mockUpstream(context)
      if (scenario.startsWith('fade-')) {
        await context.addInitScript(scenario => {
          const animate = Element.prototype.animate
          Element.prototype.animate = function (frames, options) {
            const animation = animate.call(this, frames, options)
            if (
              this.tagName === 'DIV' &&
              options?.duration === 300 &&
              options?.fill === 'forwards'
            ) {
              window.fixtureSplashAnimation = animation
              animation.pause()
              if (scenario === 'fade-cancel')
                setTimeout(() => animation.cancel(), 50)
            }
            return animation
          }
        }, scenario)
      }
      if (phone) {
        await context.addInitScript(installViewportFixture)
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'platform', {get: () => 'iPhone'})
        })
      }
      const matches = url =>
        scenario === 'geo' ||
        scenario === 'geo-cached-adult' ||
        scenario === 'cached-geo'
          ? url.origin === origin &&
            url.pathname === '/api/skyanchor/geolocation/geolocation'
          : scenario === 'refresh' || scenario === 'foreground'
            ? url.pathname === '/xrpc/com.atproto.server.refreshSession'
            : scenario === 'age'
              ? url.pathname === '/xrpc/app.bsky.ageassurance.getConfig'
              : url.origin === origin &&
                (scenario === 'locale'
                  ? /\/_expo\/static\/js\/web\/messages-.*\.js$/.test(
                      url.pathname,
                    )
                  : scenario === 'chunk' &&
                    /\/_expo\/static\/js\/web\/index-.*\.js$/.test(
                      url.pathname,
                    ))
      await context.route('**/*', async route => {
        if (!hanging && route.request().isNavigationRequest()) release()
        if (hanging && matches(new URL(route.request().url()))) {
          reached++
          heldRequests.add(route.request())
          await held
        }
        await route.fallback()
      })
      current = await context.newPage()
      current.on('pageerror', error => pageErrors.push(error.message))
      current.on('requestfailed', request => {
        if (heldRequests.has(request)) {
          failures.push(request.failure()?.errorText)
        } else {
          unexpectedFailures.push({
            scenario,
            path: new URL(request.url()).pathname,
            failure: request.failure()?.errorText,
          })
        }
      })
      current.on('response', response => {
        const url = new URL(response.url())
        if (!(
          response.status() < 400 ||
          (response.status() === 400 &&
            url.pathname === '/xrpc/com.atproto.repo.getRecord' &&
            url.searchParams.get('collection') ===
              'chat.bsky.actor.declaration' &&
            url.searchParams.get('rkey') === 'self')
        ))
          pageErrors.push(
            `Unexpected startup HTTP ${response.status()} ${url.pathname}`,
          )
      })
      const started = Date.now()
      const thresholdMs = 20_000
      await current.goto(
        origin + (scenario === 'geo-cached-adult' ? '/moderation' : '/'),
        {waitUntil: 'commit'},
      )
      if (!scenario.startsWith('fade-'))
        await expect.poll(() => reached, {timeout: 5000}).toBeGreaterThan(0)
      if (scenario === 'foreground') {
        await current.clock.setSystemTime(new Date(Date.now() + 3_600_000))
        await current.evaluate(() => {
          document.dispatchEvent(new Event('visibilitychange'))
          window.dispatchEvent(new Event('pageshow'))
        })
      }
      const recovery = current.getByRole('button', {name: 'Retry', exact: true})
      const regionalRetry = current.getByRole('button', {
        name: 'Retry regional configuration',
        exact: true,
      })
      await expect(
        current
          .getByTestId('HomeScreen')
          .or(recovery)
          .or(regionalRetry)
          .filter({visible: true})
          .first(),
      ).toBeVisible({
        timeout: Math.max(1, thresholdMs - (Date.now() - started)),
      })
      const elapsed = Date.now() - started
      assert.ok(
        elapsed <= thresholdMs,
        'Recovery is bounded from document navigation, including script startup',
      )
      const bootPhase = await current.evaluate(
        () =>
          document.documentElement.dataset.skyanchorStartupPhase ?? 'scripts',
      )
      if (scenario === 'geo-cached-adult') {
        await expect(current.getByTestId('moderationScreen')).toBeVisible()
        const adultToggle = current.getByRole('checkbox', {
          name: 'Toggle to enable or disable adult content',
          exact: true,
        })
        await expect(
          current.getByText('Content filters', {exact: true}),
        ).toBeVisible()
        await expect(adultToggle).toHaveCount(0)
        await expect(regionalRetry).toBeVisible()
        await expect.poll(() => failures.length, {timeout: 5000}).toBe(1)
        assert.equal(
          await current.evaluate(key => localStorage.getItem(key), readingKey),
          saved,
          'Restricted startup must preserve the saved reading window',
        )
        report.checks.push(
          `${phone ? 'WebKit phone' : 'Chromium'}: cached adult and assured/full AA data cannot enable adult content after uncached geo times out; visible Retry remains available.`,
        )
      }
      if (scenario === 'age') {
        await expect
          .poll(() => failures.length, {timeout: 10_000})
          .toBeGreaterThan(0)
        await expect(current.getByTestId('HomeScreen')).toBeVisible()
      }
      if (['refresh', 'foreground', 'chunk', 'locale'].includes(scenario)) {
        await expect(recovery).toBeVisible()
        assert.equal(
          await current.evaluate(key => localStorage.getItem(key), readingKey),
          saved,
          'Blocked startup cannot overwrite the saved reading window',
        )
        assert.equal(
          await current.evaluate(() => localStorage.getItem('BSKY_STORAGE')),
          entries.find(entry => entry.name === 'BSKY_STORAGE').value,
          'Blocked startup cannot rewrite session credentials',
        )
      }
      if (scenario.startsWith('fade-')) {
        await expect
          .poll(() => current.evaluate(() => !!window.fixtureSplashAnimation))
          .toBe(true)
        await expect
          .poll(() =>
            current.evaluate(
              () => document.documentElement.dataset.skyanchorStartupPhase,
            ),
          )
          .toBe('ready')
        await expect(current.locator('#startup-failure')).toHaveCount(0)
      }
      hanging = false
      if (scenario === 'foreground')
        await current.clock.setSystemTime(new Date())
      if (await recovery.isVisible()) {
        if (scenario === 'chunk') {
          // WebKit can withhold animation frames while a deferred script hangs.
          const box = await recovery.boundingBox()
          assert.ok(
            box,
            'The accessible HTML Retry is painted before scripts load',
          )
          let timer
          try {
            await Promise.race([
              phone
                ? current.touchscreen.tap(
                    box.x + box.width / 2,
                    box.y + box.height / 2,
                  )
                : current.mouse.click(
                    box.x + box.width / 2,
                    box.y + box.height / 2,
                  ),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      new Error(
                        'HTML Retry input did not complete within 5 seconds',
                      ),
                    ),
                  5000,
                )
              }),
            ])
          } finally {
            clearTimeout(timer)
          }
        } else {
          await recovery.click({noWaitAfter: true})
        }
      }
      release()
      if (scenario === 'geo' || scenario === 'geo-cached-adult') {
        await current.evaluate(() => window.dispatchEvent(new Event('online')))
      }
      if (scenario === 'geo-cached-adult') {
        await expect(regionalRetry).toHaveCount(0)
        await expect(
          current.getByRole('checkbox', {
            name: 'Toggle to enable or disable adult content',
            exact: true,
          }),
        ).toBeEnabled()
        const confirmed = await current.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem('bsky_device\\geolocationServiceResponse'),
            ).data,
        )
        assert.equal(confirmed.countryCode, 'CA')
        assert.equal(confirmed.regionCode, 'ON')
        await current.goto(origin + '/')
      }
      await current.getByTestId('HomeScreen').waitFor({timeout: 20_000})
      await current.getByTestId('skyanchor-reading-button').waitFor()
      await expect
        .poll(
          () =>
            current.evaluate(
              ({key, before}) => {
                const node = [
                  ...document.querySelectorAll('[data-skyanchor-key]'),
                ].find(node => node.dataset.skyanchorKey === key)
                return node
                  ? Math.abs(node.getBoundingClientRect().top - before)
                  : Infinity
              },
              {key: anchor, before},
            ),
          {timeout: 10_000},
        )
        .toBeLessThanOrEqual(2)
      assert.deepEqual(pageErrors, [])
      assert.deepEqual(
        unexpectedFailures,
        [],
        'No unexpected startup request failures',
      )
      if (scenario === 'fade-pause') {
        const bytes = await current.evaluate(
          key => localStorage.getItem(key),
          readingKey,
        )
        await current.clock.setSystemTime(new Date(Date.now() + 86_400_000))
        await current.evaluate(() => {
          document.dispatchEvent(new Event('visibilitychange'))
          window.dispatchEvent(new Event('pageshow'))
        })
        await expect(current.getByTestId('HomeScreen')).toBeVisible()
        await expect(
          current.getByRole('button', {name: 'Retry', exact: true}),
        ).toHaveCount(0)
        assert.equal(
          await current.evaluate(key => localStorage.getItem(key), readingKey),
          bytes,
        )
      }
      report.startup ??= []
      report.startup.push({
        engine: phone ? 'webkit-phone' : 'chromium',
        scenario,
        boundedUIWithinMs: elapsed,
        thresholdMs,
        bootPhase,
        exactPlaceWithinCSSPx: 2,
        expectedHeldRequestFailures: failures.length,
      })
    } finally {
      hanging = false
      release()
      current?.removeAllListeners('requestfailed')
      current?.removeAllListeners('response')
      await context.close()
    }
  }
}
