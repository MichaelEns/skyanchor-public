import assert from 'node:assert/strict'
import {devices, expect} from '@playwright/test'

const video = 'M7lc1UVf-VE'
const playerUri = `https://www.youtube-nocookie.com/embed/${video}?autoplay=1&playsinline=1&rel=0&start=90`
const legacyUri = `https://bsky.app/iframe/youtube.html?videoId=${video}&start=90`

export async function verifyYouTube({
  desktopBrowser,
  phoneBrowser,
  mockUpstream,
  signIn,
  entries,
  origin,
  report,
  real = false,
}) {
  report.youtube = []
  for (const browser of [desktopBrowser, phoneBrowser]) {
    const phone = browser === phoneBrowser
    const context = await browser.newContext({
      ...(phone
        ? {...devices['iPhone 13']}
        : {viewport: {width: 1280, height: 900}}),
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    try {
      const progressWrites = []
      context.on('request', request => {
        if (
          request.url() === origin + '/api/skyanchor/place' &&
          request.method() === 'PUT'
        ) {
          progressWrites.push(request.method())
        }
      })
      const upstream = await mockUpstream(context)
      upstream.setTimeline(
        entries.map((item, index) =>
          index === 0
            ? {
                ...item,
                post: {
                  ...item.post,
                  embed: {
                    $type: 'app.bsky.embed.external#view',
                    external: {
                      uri: `https://www.youtube.com/watch?v=${video}&t=1m30s`,
                      title: 'YouTube playback fixture',
                      description: 'Official YouTube API example',
                      thumb: 'https://cdn.bsky.app/fixture/youtube.svg',
                    },
                  },
                },
              }
            : index === 1
              ? {
                  ...item,
                  post: {
                    ...item.post,
                    embed: {
                      $type: 'app.bsky.embed.external#view',
                      external: {
                        uri: 'https://open.spotify.com/track/fixture',
                        title: 'Spotify playback fixture',
                        description: 'Unchanged provider fixture',
                      },
                    },
                  },
                }
              : item,
        ),
      )
      const requests = []
      const otherRequests = []
      const providerResponses = []
      if (real) {
        await context.route(
          /^https:\/\/(?:(?:[a-z0-9-]+\.)*(?:youtube\.com|ytimg\.com|googlevideo\.com)\/|www\.youtube-nocookie\.com\/(?:s\/|youtubei\/v1\/|api\/(?:stats\/|timedtext)|ptracking|error_204|embed\/establish_zw)|fonts\.gstatic\.com\/s\/(?:roboto\/|i\/youtube_)|www\.gstatic\.com\/youtube\/img\/|yt3\.ggpht\.com\/|www\.google\.com\/js\/th\/)/,
          async route => {
            const request = route.request()
            const frameUrl = request.frame().url()
            if (
              !frameUrl.startsWith('https://www.youtube-nocookie.com/embed/')
            ) {
              return route.fallback()
            }
            await route.continue()
          },
        )
        context.on('response', response => {
          const url = new URL(response.url())
          if (url.origin !== origin && !url.pathname.startsWith('/xrpc/')) {
            providerResponses.push({
              host: url.hostname,
              status: response.status(),
            })
          }
        })
      }
      await context.route(
        'https://open.spotify.com/embed/track/fixture',
        async route => {
          otherRequests.push(await route.request().allHeaders())
          await route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><p>Other provider controls ready</p>',
          })
        },
      )
      await context.route(
        /^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/M7lc1UVf-VE\?autoplay=1&playsinline=1&rel=0&start=90|bsky\.app\/iframe\/youtube\.html\?videoId=M7lc1UVf-VE&start=90)$/,
        async route => {
          const request = route.request()
          assert.ok([playerUri, legacyUri].includes(request.url()))
          assert.equal(request.method(), 'GET')
          requests.push({
            url: request.url(),
            referer: (await request.allHeaders()).referer,
          })
          if (real && request.url() === playerUri) {
            return route.continue()
          }
          await route.fulfill({
            contentType: 'text/html',
            headers:
              request.url() === legacyUri
                ? {'x-frame-options': 'SAMEORIGIN'}
                : {},
            body: '<!doctype html><title>Provider fixture</title><p>Provider controls ready</p>',
          })
        },
      )
      const page = await context.newPage()
      await signIn(page)
      await page.evaluate(() => {
        history.replaceState(
          history.state,
          '',
          '/?fixture-private=not-for-provider',
        )
      })
      const playbackUrl = page.url()
      const row = page.locator('[data-skyanchor-key]').first()
      const play = row.getByRole('button', {name: 'Play Video', exact: true})
      await expect(play).toBeVisible()
      assert.equal(requests.length, 0, 'No provider traffic before Play')
      await play.click()
      const consent = page.getByRole('dialog', {name: 'External Media'})
      await expect(consent).toBeVisible()
      assert.equal(requests.length, 0, 'Consent has not been accepted')
      await consent.getByRole('button', {name: 'Close active dialog'}).click()
      await expect(consent).toHaveCount(0)
      assert.equal(requests.length, 0, 'Cancel must not load the provider')
      await play.click()
      await consent
        .getByRole('button', {name: 'No thanks', exact: true})
        .click()
      await expect(play).toHaveCount(0)
      assert.equal(
        requests.length,
        0,
        'Declining consent hides without provider traffic',
      )
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('BSKY_STORAGE'))
        delete state.externalEmbeds.youtube
        localStorage.setItem('BSKY_STORAGE', JSON.stringify(state))
      })
      await page.reload()
      await expect(play).toBeVisible()
      await play.click()
      await consent
        .getByRole('button', {name: 'Enable this source only', exact: true})
        .click()
      await expect(consent).toHaveCount(0)
      await expect.poll(() => requests.length).toBe(1)
      assert.equal(
        requests[0].url,
        playerUri,
        'Activated YouTube must not use the SAMEORIGIN-denied Bluesky wrapper',
      )
      assert.equal(requests[0].referer, origin + '/')
      const frame = row.locator('iframe')
      await expect(frame).toHaveAttribute('referrerpolicy', 'origin')
      await expect(frame).toHaveAttribute(
        'allow',
        'autoplay; encrypted-media; fullscreen; picture-in-picture',
      )
      await expect(frame).toHaveAttribute('allowfullscreen', '')
      if (real) {
        const sample = () =>
          frame
            .contentFrame()
            .locator('body')
            .evaluate(() => {
              const video = document.querySelector('video')
              return {
                time: video?.currentTime ?? null,
                paused: video?.paused ?? null,
                readyState: video?.readyState ?? null,
                mediaError: video?.error?.code ?? null,
                providerError:
                  document.querySelector('.ytp-error-content-wrap')
                    ?.textContent ?? null,
              }
            })
        let before, after, limitation
        try {
          await frame.contentFrame().locator('body').waitFor({timeout: 30_000})
          await page.waitForTimeout(10_000)
          const providerPlay = frame
            .contentFrame()
            .locator('.ytp-large-play-button')
          if (await providerPlay.isVisible()) await providerPlay.click()
          before = await sample()
          await page.waitForTimeout(4000)
          after = await sample()
        } catch (error) {
          limitation = error.message.split('\n')[0]
        }
        const playing =
          !!after && after.time > before.time && after.paused === false
        if (!playing && !limitation) {
          limitation =
            after?.providerError || 'No advancing playable media element'
        }
        report.youtube.push({
          browser: phone ? 'phone WebKit' : 'desktop Chromium',
          realNetwork: true,
          actualPlayback: playing,
          before,
          after,
          limitation,
          providerResponses,
        })
        continue
      }
      await expect(
        frame.contentFrame().getByText('Provider controls ready'),
      ).toBeVisible()
      assert.equal(page.url(), playbackUrl, 'Play must not open the post')
      await page.evaluate(() => window.scrollTo(0, 3000))
      await expect(page.locator('iframe')).toHaveCount(0)
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(play).toBeVisible()
      assert.equal(requests.length, 1, 'Returning does not autoplay')
      await play.click()
      await expect(consent).toHaveCount(0)
      await expect.poll(() => requests.length).toBe(2)
      await expect(frame).toBeVisible()
      await page.getByTestId('skyanchor-reading-button').waitFor()
      await row.getByTestId('postText').click()
      await expect(page.locator('iframe')).toHaveCount(0)
      const threadUrl = page.url()
      assert.ok(
        new URL(threadUrl).pathname.includes('/post/'),
        'Post navigation exercises blur',
      )
      await page.getByRole('button', {name: 'Play Video', exact: true}).click()
      await expect.poll(() => requests.length).toBe(3)
      assert.equal(
        requests[2].referer,
        origin + '/',
        'A private post path is never sent to YouTube',
      )
      assert.equal(page.url(), threadUrl)
      await page.goBack()
      await expect(page.locator('iframe')).toHaveCount(0)
      await expect(play).toBeVisible()
      assert.equal(requests.length, 3, 'Back must not reactivate the player')
      await page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('BSKY_STORAGE'))
        state.externalEmbeds.youtube = 'hide'
        localStorage.setItem('BSKY_STORAGE', JSON.stringify(state))
      })
      await page.reload()
      await expect(
        page.getByRole('link', {name: 'YouTube playback fixture', exact: true}),
      ).toBeVisible()
      await expect(play).toHaveCount(0)
      assert.equal(requests.length, 3, 'Hidden source remains an external card')
      const otherRow = page.locator('[data-skyanchor-key]').nth(1)
      await otherRow.scrollIntoViewIfNeeded()
      assert.equal(otherRequests.length, 0)
      await otherRow
        .getByRole('button', {name: 'Play Video', exact: true})
        .click()
      await consent
        .getByRole('button', {name: 'Enable this source only', exact: true})
        .click()
      await expect.poll(() => otherRequests.length).toBe(1)
      assert.equal(
        otherRequests[0].referer,
        undefined,
        'Other providers remain no-referrer',
      )
      await expect(otherRow.locator('iframe')).not.toHaveAttribute(
        'referrerpolicy',
        'origin',
      )
      assert.deepEqual(
        progressWrites,
        [],
        'Media interactions never auto-save shared progress',
      )
      report.youtube.push({
        browser: phone ? 'phone WebKit' : 'desktop Chromium',
        requests,
        deterministicControls: true,
        actualPlayback: false,
        otherProviderNoReferrer: true,
      })
    } finally {
      await context.close()
    }
  }
  report.checks.push(
    real
      ? 'Real unauthenticated YouTube playback probe records media time advance or explicit provider/network limitation; a loaded frame alone is not playback.'
      : 'YouTube production UI: no pre-consent requests, cancel, accept, origin-only referrer, permissions, controls fixture, no parent navigation, offscreen/blur teardown, remembered show and hidden-source external fallback. Deterministic provider fixture is not real playback evidence.',
  )
}
