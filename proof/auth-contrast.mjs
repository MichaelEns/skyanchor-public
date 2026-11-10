import assert from 'node:assert/strict'
import {expect, devices} from '@playwright/test'

async function measure(locator) {
  return locator.evaluate(root => {
    const rgba = value => {
      const match = value.match(/^rgba?\(([^)]+)\)$/)
      if (!match) throw new Error('Unmeasurable rendered color: ' + value)
      const parts = match[1].split(/[, /]+/).map(Number)
      return [parts[0], parts[1], parts[2], parts[3] ?? 1]
    }
    const composite = (front, back) =>
      front
        .slice(0, 3)
        .map((channel, i) => channel * front[3] + back[i] * (1 - front[3]))
    const luminance = color => {
      const linear = color.slice(0, 3).map(channel => {
        const value = channel / 255
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const ratio = (a, b) => {
      const [high, low] = [luminance(a), luminance(b)].sort((a, b) => b - a)
      return (high + 0.05) / (low + 0.05)
    }
    const background = node => {
      const layers = []
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        const color = rgba(style.backgroundColor)
        layers.push(color)
        if (color[3] === 1) {
          let result = color.slice(0, 3)
          for (let i = layers.length - 2; i >= 0; i--)
            result = composite(layers[i], result)
          return result
        }
        if (style.backgroundImage !== 'none')
          throw new Error('Text lacks an opaque surface above artwork')
      }
      throw new Error('No rendered opaque background for ' + node.textContent)
    }
    const visible = node => {
      const rect = node.getBoundingClientRect()
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        getComputedStyle(node).visibility !== 'hidden'
      )
    }
    const measurements = []
    const record = (node, foreground, bg, threshold, kind, text) => {
      let opacity = 1
      for (let parent = node; parent; parent = parent.parentElement)
        opacity *= Number(getComputedStyle(parent).opacity)
      const color = rgba(foreground)
      color[3] *= opacity
      measurements.push({
        kind,
        text: text.slice(0, 80),
        foreground,
        background: bg,
        ratio: ratio(composite(color, bg), bg),
        threshold,
      })
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const seen = new Set()
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim()
      const node = walker.currentNode.parentElement
      if (!text || !visible(node) || seen.has(node)) continue
      seen.add(node)
      const style = getComputedStyle(node)
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700)
      record(
        node,
        style.webkitTextFillColor || style.color,
        background(node),
        large ? 3 : 4.5,
        'text',
        text,
      )
    }
    for (const input of root.querySelectorAll('input')) {
      if (!visible(input)) continue
      const chrome = input.nextElementSibling
      const bg = background(chrome)
      record(
        input,
        getComputedStyle(input).color,
        bg,
        4.5,
        'input text',
        input.getAttribute('aria-label'),
      )
      const style = getComputedStyle(chrome)
      record(
        chrome,
        style.borderTopColor,
        bg,
        3,
        'input boundary',
        input.getAttribute('aria-label'),
      )
    }
    for (const button of root.querySelectorAll(
      '[data-testid="signInButton"], [data-testid="createAccountButton"], [data-testid="loginNextButton"]',
    )) {
      if (!visible(button)) continue
      const style = getComputedStyle(button)
      const outside = background(button.parentElement)
      const fill = background(button)
      record(
        button,
        ratio(fill, outside) >= 3
          ? style.backgroundColor
          : style.borderTopColor,
        outside,
        3,
        'action boundary',
        button.getAttribute('aria-label'),
      )
    }
    for (const path of root.querySelectorAll('svg path')) {
      if (!visible(path) || path.closest('defs, clipPath, mask, pattern'))
        continue
      const style = getComputedStyle(path)
      const color =
        style.stroke !== 'none' && parseFloat(style.strokeWidth) > 0
          ? style.stroke
          : style.fill
      if (color === 'none') continue
      record(
        path,
        color,
        background(path),
        3,
        'icon/logo',
        path.closest('svg').getAttribute('aria-label') ||
          path.closest('svg').outerHTML.slice(0, 240),
      )
    }
    return measurements
  })
}

export async function verifyAuthContrast({
  desktopBrowser,
  phoneBrowser,
  origin,
  mockUpstream,
  seed,
  report,
}) {
  report.contrast = []
  for (const [browser, viewport] of [
    [desktopBrowser, {width: 1280, height: 900}],
    [phoneBrowser, {width: 390, height: 844}],
  ]) {
    for (const theme of ['light', 'dim', 'dark']) {
      const context = await browser.newContext({
        ...(viewport.width === 390 ? devices['iPhone 13'] : {}),
        viewport,
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
      })
      let page
      try {
        await mockUpstream(context)
        await context.addInitScript(
          ({seed, theme}) => {
            localStorage.setItem(
              'BSKY_STORAGE',
              JSON.stringify({
                ...seed,
                colorMode: theme === 'light' ? 'light' : 'dark',
                darkTheme: theme === 'dim' ? 'dim' : 'dark',
                session: {accounts: []},
              }),
            )
          },
          {seed, theme},
        )
        page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(origin + '/')
        report.contrastPhase = `${theme}/${viewport.width}/welcome`
        await page.getByTestId('welcomeModal').waitFor({timeout: 30000})
        await page.getByTestId('welcomeModal').evaluate(async node => {
          await Promise.all(
            node
              .getAnimations({subtree: true})
              .filter(
                animation =>
                  animation.effect.getComputedTiming().iterations !== Infinity,
              )
              .map(animation => animation.finished),
          )
        })
        const closeGeometry = await page
          .getByTestId('welcomeModal')
          .getByRole('button', {name: 'Close welcome modal', exact: true})
          .evaluate(button => {
            const svg = button.querySelector('svg')
            if (!svg) throw new Error('Welcome Close has no rendered SVG')
            return {
              viewBox: svg.getAttribute('viewBox'),
              paths: [...svg.querySelectorAll('path')].map(path => {
                if (!(path instanceof SVGPathElement))
                  throw new Error('Close glyph must use actual SVG paths')
                const start = path.getPointAtLength(0)
                const end = path.getPointAtLength(path.getTotalLength())
                const box = path.getBBox()
                const style = getComputedStyle(path)
                return {
                  d: path.getAttribute('d'),
                  start: [start.x, start.y],
                  end: [end.x, end.y],
                  box: [box.x, box.y, box.width, box.height],
                  strokeWidth: style.strokeWidth,
                  fill: style.fill,
                  strokeLinecap: style.strokeLinecap,
                  strokeLinejoin: style.strokeLinejoin,
                }
              }),
            }
          })
        assert.equal(closeGeometry.viewBox, '0 0 24 24')
        assert.equal(closeGeometry.paths.length, 2)
        const expectedClose = [
          {d: 'M18 6 6 18', start: [18, 6], end: [6, 18]},
          {d: 'm6 6 12 12', start: [6, 6], end: [18, 18]},
        ]
        for (const [index, actual] of closeGeometry.paths.entries()) {
          const expected = expectedClose[index]
          assert.equal(actual.d, expected.d)
          for (const field of ['start', 'end', 'box']) {
            const values = field === 'box' ? [6, 6, 12, 12] : expected[field]
            actual[field].forEach((value, i) =>
              assert.ok(
                Math.abs(value - values[i]) <= 0.01,
                `Welcome Close ${theme}/${viewport.width} path ${index} ${field}[${i}] ${value} != ${values[i]}`,
              ),
            )
          }
          assert.equal(actual.fill, 'none')
          assert.equal(actual.strokeWidth, '2px')
          assert.equal(actual.strokeLinecap, 'round')
          assert.equal(actual.strokeLinejoin, 'round')
        }
        report.closeGeometry ??= []
        report.closeGeometry.push({
          theme,
          viewport: viewport.width,
          ...closeGeometry,
        })
        const assertContrast = async (surface, state) => {
          await surface.evaluate(async node => {
            await document.fonts.ready
            await Promise.all(
              node
                .getAnimations({subtree: true})
                .filter(
                  animation =>
                    animation.effect.getComputedTiming().iterations !==
                    Infinity,
                )
                .map(animation => animation.finished),
            )
            await new Promise(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            )
          })
          const values = await measure(surface)
          assert.ok(
            values.length > 0,
            'Contrast assertion must measure real visible content',
          )
          report.contrast.push({
            theme,
            viewport: viewport.width,
            state,
            measurements: values,
          })
          for (const value of values)
            assert.ok(
              value.ratio >= value.threshold,
              `${theme}/${viewport.width}/${state}: ${value.kind} "${value.text}" ${value.ratio.toFixed(2)} < ${value.threshold}`,
            )
        }
        await assertContrast(page.getByTestId('welcomeModal'), 'welcome')
        await page.screenshot({
          path: `proof-auth-${theme}-${viewport.width}-welcome.png`,
        })
        const welcomeSignin = page
          .getByTestId('welcomeModal')
          .getByRole('button', {name: 'Sign in', exact: true})
        if (viewport.width !== 390) {
          await welcomeSignin.hover()
          await assertContrast(
            page.getByTestId('welcomeModal'),
            'welcome hover',
          )
        }
        await welcomeSignin.focus()
        await assertContrast(page.getByTestId('welcomeModal'), 'welcome focus')
        await welcomeSignin.click()
        await page.getByTestId('loginUsernameInput').waitFor()
        await page.getByTestId('loginNextButton').waitFor()
        await page.getByTestId('loginPasswordInput').fill('not-a-real-password')
        await page.getByTestId('loginUsernameInput').focus()
        await assertContrast(page.getByTestId('signIn'), 'login username focus')
        await page.getByTestId('loginPasswordInput').focus()
        await assertContrast(page.getByTestId('signIn'), 'login password focus')
        await page
          .getByRole('button', {name: 'Forgot password?', exact: true})
          .hover()
        await assertContrast(page.getByTestId('signIn'), 'login hover')
        await expect(page.locator('input')).toHaveCount(2)
        await page.screenshot({
          path: `proof-auth-${theme}-${viewport.width}-login.png`,
        })
        await page.goto(origin + '/?splash=true')
        await page.getByTestId('signInButton').waitFor()
        await assertContrast(page.locator('body'), 'signed-out splash')
        assert.deepEqual(errors, [])
      } catch (error) {
        if (page && !page.isClosed()) {
          await page.screenshot({
            path: `proof-auth-${theme}-${viewport.width}-failure.png`,
          })
          report.contrastFailure = {
            theme,
            viewport,
            text: await page.locator('body').innerText(),
          }
        }
        throw error
      } finally {
        await context.close()
      }
    }
  }
  report.checks.push(
    'Production welcome/login/splash contrast measured across light/dim/dark desktop and WebKit phone: normal text >=4.5, large text and essential icons/input boundaries >=3, including hover/focus; real two-field sign-in form without login or account writes.',
  )
}
