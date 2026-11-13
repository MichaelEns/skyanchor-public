import assert from 'node:assert/strict'
import {test} from 'node:test'
import path from 'node:path'
import {build} from 'esbuild'

async function parser(web) {
  const built = await build({
    entryPoints: [path.join('src', 'lib', 'strings', 'embed-player.ts')],
    bundle: true,
    format: 'esm',
    write: false,
    define: {
      __DEV__: 'false',
      'window.location.host': '"fixture.test"',
      'window.location.hostname': '"fixture.test"',
    },
    plugins: [
      {
        name: 'platform-fixture',
        setup(builder) {
          builder.onResolve({filter: /^(react-native|#\/env)$/}, args => ({
            path: args.path,
            namespace: 'fixture',
          }))
          builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({
            contents:
              args.path === '#/env'
                ? `export const IS_WEB = ${web}`
                : 'export const Dimensions = {get: () => ({width: 1280, height: 900})}',
          }))
        },
      },
    ],
  })
  return import(
    'data:text/javascript;base64,' +
      Buffer.from(built.outputFiles[0].text).toString('base64')
  )
}

const video = 'M7lc1UVf-VE'
test('Web YouTube uses a bounded privacy-enhanced embed for watch, short, live and share URLs', async () => {
  const {parseEmbedPlayerFromUrl: parse, getPlayerAspect} = await parser(true)
  const forms = [
    `https://www.youtube.com/watch?v=${video}`,
    `https://youtube.com/watch?v=${video}`,
    `https://m.youtube.com/watch?v=${video}`,
    `https://music.youtube.com/watch?v=${video}`,
    `https://youtu.be/${video}`,
    `https://youtube.com/live/${video}`,
    `https://youtube.com/shorts/${video}`,
  ]
  for (const url of forms) {
    const result = parse(url)
    assert.equal(
      result.playerUri,
      `https://www.youtube-nocookie.com/embed/${video}?autoplay=1&playsinline=1&rel=0&start=0`,
    )
    assert.equal(
      result.type,
      url.includes('/shorts/') ? 'youtube_short' : 'youtube_video',
    )
  }
  assert.equal(parse(forms.at(-1)).hideDetails, true)
  assert.notDeepEqual(
    getPlayerAspect({type: 'youtube_short', width: 390, hasThumb: true}),
    getPlayerAspect({type: 'youtube_video', width: 390, hasThumb: true}),
  )
  for (const [input, seconds] of [
    ['90', 90],
    ['90s', 90],
    ['1m30s', 90],
    ['1h2m3s', 3723],
    ['-1', 0],
    ['1.5', 0],
    ['Infinity', 0],
    ['1&autoplay=0', 0],
    ['999999999999999999999999h', 0],
    ['', 0],
  ]) {
    assert.equal(
      new URL(
        parse(forms[0] + '&t=' + encodeURIComponent(input)).playerUri,
      ).searchParams.get('start'),
      String(seconds),
    )
  }
  for (const url of [
    `https://youtube.com.evil.test/watch?v=${video}`,
    `https://evil.test/?v=${video}`,
    `https://youtu.be.evil.test/${video}`,
    `https://youtube.com@evil.test/watch?v=${video}`,
    `https://evil@youtube.com/watch?v=${video}`,
    `https://youtube.com:444/watch?v=${video}`,
    `ftp://youtube.com/watch?v=${video}`,
    'https://youtube.com/watch?v=short',
    'https://youtu.be/',
    'https://youtube.com/shorts/',
    'https://youtube.com/watch?v=M7lc1UVf-%26E',
    'https://youtu.be/M7lc1UVf-%26E',
    'not a URL',
  ]) {
    assert.equal(parse(url), undefined, url)
  }
})

test('Native YouTube wrapper and other providers retain their existing sources', async () => {
  const web = await parser(true)
  const native = await parser(false)
  assert.equal(
    native.parseEmbedPlayerFromUrl(`https://youtu.be/${video}?t=1m30s`)
      .playerUri,
    `https://bsky.app/iframe/youtube.html?videoId=${video}&start=90`,
  )
  assert.equal(
    native.parseEmbedPlayerFromUrl('https://youtube.com/watch?v=videoId')
      .playerUri,
    'https://bsky.app/iframe/youtube.html?videoId=videoId&start=0',
  )
  for (const url of [
    'https://open.spotify.com/track/fixture',
    'https://vimeo.com/123456',
    'https://soundcloud.com/fixture/track',
  ]) {
    assert.deepEqual(
      web.parseEmbedPlayerFromUrl(url),
      native.parseEmbedPlayerFromUrl(url),
    )
  }
})
