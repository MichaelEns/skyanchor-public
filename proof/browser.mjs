import assert from 'node:assert/strict'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {createHash, createPublicKey, randomBytes, randomUUID} from 'node:crypto'
import {chromium, webkit, expect, devices} from '@playwright/test'
import {CID} from 'multiformats/cid'
import {api} from '@bsky/sdk'
import * as digest from 'multiformats/hashes/digest'
import {workerRuntime, didA, didB} from './runtime.mjs'
import {buildInputs} from '../scripts/skyanchor/inputs.mjs'
import {verifyComposer} from './composer.mjs'
import {
  verifyAutomaticSource,
  verifyHandoff,
  verifyReverseHandoff,
  verifyScrollInput,
  verifyDeviceCheckpoints,
  verifySyncRecovery,
} from './handoff.mjs'
import {verifyProfileReading} from './profile-reading.mjs'
import {verifyAuthContrast} from './auth-contrast.mjs'
import {verifyStartup} from './startup.mjs'
import {installViewportFixture, verifyViewport} from './viewport.mjs'
import {
  readingPanel,
  readingAction,
  closeReadingPanel,
  verifyReadingPanel,
  verifyNewContent,
  legacyReturnFixture,
  scrollReading,
  verifyThreadBack,
  verifySettlement,
} from './reading-panel.mjs'

const require = createRequire(import.meta.url)
const forge = require('node-forge')
const dist = path.resolve('dist')
assert.ok(
  fs.existsSync(path.join(dist, 'index.html')),
  'Build the production export first',
)
const provenance = JSON.parse(
  fs.readFileSync(path.join(dist, 'skyanchor-provenance.json'), 'utf8'),
)
assert.equal(
  provenance.failures.length,
  0,
  'Production artifact scan must pass',
)
const buildRecord = JSON.parse(
  fs.readFileSync(path.join(dist, 'skyanchor-build.json'), 'utf8'),
)
assert.ok(
  fs
    .readFileSync(path.join(dist, 'sw.js'), 'utf8')
    .includes(`/* SkyAnchor release ${buildRecord.inputs.sha256} */`),
  'Exported service-worker bytes are versioned with the exact production inputs',
)
assert.equal(
  buildInputs().sha256,
  buildRecord.inputs.sha256,
  'Production export must match current source inputs',
)
for (const artifact of provenance.artifacts) {
  assert.equal(
    createHash('sha256').update(fs.readFileSync(artifact.file)).digest('hex'),
    artifact.sha256,
    artifact.file,
  )
}
const pair = forge.pki.rsa.generateKeyPair(2048)
const cert = forge.pki.createCertificate()
cert.publicKey = pair.publicKey
cert.serialNumber = '01'
cert.validity.notBefore = new Date(Date.now() - 60_000)
cert.validity.notAfter = new Date(Date.now() + 3_600_000)
cert.setSubject([{name: 'commonName', value: 'localhost'}])
cert.setIssuer(cert.subject.attributes)
cert.setExtensions([
  {name: 'subjectAltName', altNames: [{type: 2, value: 'localhost'}]},
])
cert.sign(pair.privateKey, forge.md.sha256.create())
const fixtureSpki = createHash('sha256')
  .update(
    createPublicKey(forge.pki.publicKeyToPem(pair.publicKey)).export({
      type: 'spki',
      format: 'der',
    }),
  )
  .digest('base64')
let serviceWorkerRevision = 0
let worker
let origin
let apiHold
const apiHolds = new Set()
function holdApi(method, {cookie, scenario} = {}) {
  let entered, release
  const reached = new Promise(resolve => {
    entered = resolve
  })
  const done = new Promise(resolve => {
    release = resolve
  })
  const hold = {method, cookie, scenario, entered, reached, done, release}
  apiHolds.add(hold)
  apiHold = hold
  return hold
}
const served = new Set()
const server = https.createServer(
  {
    key: forge.pki.privateKeyToPem(pair.privateKey),
    cert: forge.pki.certificateToPem(cert),
  },
  async (request, response) => {
    try {
      const url = new URL(request.url, origin)
      if (url.pathname.startsWith('/api/skyanchor/')) {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const body = Buffer.concat(chunks)
        const result = await worker.runtime.dispatchFetch(url.href, {
          cf: {country: 'CA', regionCode: 'ON'},
          method: request.method,
          headers: request.headers,
          ...(body.length ? {body} : {}),
        })
        const responseBytes = Buffer.from(await result.arrayBuffer())
        if (
          apiHold?.method === request.method &&
          url.pathname === '/api/skyanchor/place' &&
          (!apiHold.cookie ||
            request.headers.cookie?.split('; ').includes(apiHold.cookie))
        ) {
          const hold = apiHold
          apiHold = undefined
          hold.request = {
            method: request.method,
            path: url.pathname,
            wallTime: Date.now(),
            status: result.status,
            scenario: hold.scenario,
          }
          hold.entered(hold.request)
          await hold.done
          apiHolds.delete(hold)
        }
        response.writeHead(result.status, Object.fromEntries(result.headers))
        response.end(responseBytes)
        return
      }
      let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      let file = path.resolve(dist, relative || 'index.html')
      if (!file.startsWith(dist + path.sep))
        throw new Error('Invalid static path')
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
        file = path.join(dist, 'index.html')
      served.add(path.relative(dist, file))
      const mime = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
      }
      const bytes = fs.readFileSync(file)
      response.writeHead(200, {
        'content-type': mime[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
        'content-security-policy': fs
          .readFileSync(path.join(dist, '_headers'), 'utf8')
          .match(/Content-Security-Policy: (.+)/)[1],
        'x-content-type-options': 'nosniff',
      })
      response.end(
        url.pathname === '/sw.js' && serviceWorkerRevision
          ? Buffer.concat([
              bytes,
              Buffer.from(`\n/* Fixture update ${serviceWorkerRevision} */\n`),
            ])
          : bytes,
      )
    } catch (error) {
      console.error('Fixture server failed', error)
      if (!response.headersSent) response.writeHead(500)
      response.end('Fixture failed')
    }
  },
)
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
origin = `https://localhost:${server.address().port}`
worker = await workerRuntime(origin)
console.log(
  `Fixture production HTTPS server ready; owning PID ${process.pid}; isolated D1 runtime ready`,
)
const cid = CID.createV1(
  0x71,
  digest.create(0x12, new Uint8Array(32).fill(7)),
).toString()
const now = Date.now()
const didSharon = 'did:plc:cccccccccccccccccccccccc'
const didAnother = 'did:plc:dddddddddddddddddddddddd'
const profile = did => ({
  $type: 'app.bsky.actor.defs#profileViewBasic',
  did,
  handle:
    did === didA
      ? 'reader.test'
      : did === didSharon
        ? 'sharon-fixture.test'
        : did === didAnother
          ? 'another-fixture.test'
          : 'other.test',
  displayName:
    did === didA
      ? 'Fixture Reader'
      : did === didSharon
        ? 'Fixture Sharon'
        : did === didAnother
          ? 'Fixture Another'
          : 'Other Reader',
  viewer: {
    muted: false,
    blockedBy: false,
    following: `at://${didA}/app.bsky.graph.follow/follow`,
  },
  labels: [],
})
const post = (number, extra = {}) => ({
  $type: 'app.bsky.feed.defs#postView',
  uri: `at://${didA}/app.bsky.feed.post/post${number}`,
  cid,
  author: profile(didA),
  record: {
    $type: 'app.bsky.feed.post',
    text: `Fixture post ${number}. A chronological reading window with meaningful content for the official client.`,
    createdAt: new Date(now - number * 60_000).toISOString(),
  },
  indexedAt: new Date(now - number * 60_000).toISOString(),
  replyCount: 0,
  repostCount: 0,
  likeCount: 0,
  quoteCount: 0,
  viewer: {threadMuted: false, embeddingDisabled: false},
  labels: [],
  ...extra,
})
const entries = Array.from({length: 100}, (_, index) => ({
  post: post(index + 1),
}))
const rootPost = post(110)
const parentPost = post(111, {
  record: {
    $type: 'app.bsky.feed.post',
    text: 'Fixture reply parent context',
    createdAt: new Date(now - 120 * 60_000).toISOString(),
    reply: {root: {uri: rootPost.uri, cid}, parent: {uri: rootPost.uri, cid}},
  },
})
entries[11] = {
  post: post(12, {
    record: {
      $type: 'app.bsky.feed.post',
      text: 'Fixture reply 12 with parent context',
      createdAt: new Date(now - 12 * 60_000).toISOString(),
      reply: {
        root: {uri: rootPost.uri, cid},
        parent: {uri: parentPost.uri, cid},
      },
    },
  }),
  reply: {root: rootPost, parent: parentPost},
}
entries[19] = {
  post: post(20),
  reason: {
    $type: 'app.bsky.feed.defs#reasonRepost',
    by: profile(didB),
    uri: `at://${didB}/app.bsky.feed.repost/repost20`,
    cid,
    indexedAt: new Date(now - 20 * 60_000).toISOString(),
  },
}
entries[69] = {
  post: post(70, {
    record: {
      $type: 'app.bsky.feed.post',
      text: 'Fixture deep repost reply handoff',
      createdAt: new Date(now - 70 * 60_000).toISOString(),
      reply: {
        root: {uri: rootPost.uri, cid},
        parent: {uri: parentPost.uri, cid},
      },
    },
  }),
  reply: {root: rootPost, parent: parentPost},
  reason: {
    $type: 'app.bsky.feed.defs#reasonRepost',
    by: profile(didB),
    uri: `at://${didB}/app.bsky.feed.repost/repost70`,
    cid,
    indexedAt: new Date(now - 70 * 60_000).toISOString(),
  },
}
let feed = [...entries]
const authorFeeds = new Map(
  [didSharon, didAnother].map(did => [
    did,
    Array.from({length: 100}, (_, index) => ({
      post: post(index + 200, {
        uri: `at://${did}/app.bsky.feed.post/author${index}`,
        author: profile(did),
        record: {
          $type: 'app.bsky.feed.post',
          text: `Author fixture ${index}. Independent chronological profile reading.`,
          createdAt: new Date(now - index * 60000).toISOString(),
        },
        ...(index === 3 ? {embed: entries[3].post.embed} : {}),
      }),
    })),
  ]),
)
const deleted = new Set()
const moderated = new Set()
const upstreamCalls = []
const unexpected = []
const errors = []
const anticipatedFailures = []
const networkEvents = []
const state = {lateImage: false}
entries[3].post.embed = {
  $type: 'app.bsky.embed.images#view',
  images: [
    {
      alt: 'Original fixture ocean rectangle',
      thumb: 'https://cdn.bsky.app/fixture/late.svg',
      fullsize: 'https://cdn.bsky.app/fixture/late.svg',
    },
  ],
}
for (const values of authorFeeds.values())
  for (const [index, item] of values.entries())
    if (index === 3 || index % 5 === 0) item.post.embed = entries[3].post.embed
function token(did, scope = 'com.atproto.access') {
  const value = [
    Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString(
      'base64url',
    ),
    Buffer.from(
      JSON.stringify({
        sub: did,
        scope,
        exp: Math.floor(Date.now() / 1000) + 3600,
        aud: 'did:web:bsky.social',
      }),
    ).toString('base64url'),
    randomBytes(32).toString('base64url'),
  ].join('.')
  return value
}
const sessionTokens = new Map()
const regionalPds = 'https://shimeji.us-east.host.bsky.network'
async function mockUpstream(context, owner = didA) {
  const issuedAccess = []
  let failRefresh = false
  let timeline
  let threadReply = entries[22].post
  let timelineHold
  const timelineRequests = []
  const timelineResponses = []
  const recordModerated = new Set()
  const recordDeleted = new Set()
  const revalidationResponses = []
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin) return route.continue()
    if (request.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-headers':
            request.headers()['access-control-request-headers'] ||
            'authorization,content-type,atproto-proxy,atproto-accept-labelers',
          'access-control-allow-methods':
            request.headers()['access-control-request-method'] || 'GET, POST',
          'access-control-allow-credentials': 'true',
          'access-control-max-age': '600',
        },
      })
    const nsid = url.pathname.split('/xrpc/')[1]
    const currentDid =
      sessionTokens.get(
        request.headers()['authorization']?.replace(/^Bearer /, ''),
      ) || owner
    upstreamCalls.push({
      nsid,
      url: url.origin + url.pathname,
      method: request.method(),
      ...(nsid === 'app.bsky.feed.getFeedGenerator' ||
      nsid === 'app.bsky.feed.getFeed'
        ? {feed: url.searchParams.get('feed')}
        : {}),
    })
    let result
    let status = 200
    if (
      request.method() === 'GET' &&
      url.href === 'https://public.api.bsky.app/xrpc/_health'
    )
      result = {version: 'fixture-appview'}
    else if (url.hostname === 'ip.bsky.app')
      result = {countryCode: 'CA', regionCode: 'BC', city: 'Fixture'}
    else if (url.hostname === 'app-config.workers.bsky.app')
      result = {liveNow: {allow: [], exceptions: []}}
    else if (url.hostname === 'live-events.workers.bsky.app')
      result = {feeds: []}
    else if (
      url.hostname === 'cardyb.bsky.app' &&
      url.pathname === '/v1/extract'
    )
      result = {
        error: '',
        url: url.searchParams.get('url'),
        title: 'Fixture link',
        description: 'Mocked composer link metadata',
      }
    else if (nsid === 'app.bsky.draft.getDrafts') result = {drafts: []}
    else if (
      url.hostname === 'cdn.bsky.app' &&
      url.pathname.startsWith('/fixture/')
    ) {
      if (state.lateImage)
        await new Promise(resolve => setTimeout(resolve, 800))
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#287c87"/></svg>',
      })
    } else if (nsid === 'com.atproto.server.describeServer')
      result = {
        did: 'did:web:bsky.social',
        availableUserDomains: ['.test'],
        inviteCodeRequired: false,
      }
    else if (nsid === 'com.atproto.identity.resolveHandle')
      result = {
        did:
          url.searchParams.get('handle') === 'mod-authority.test'
            ? api.moderation.did
            : url.searchParams.get('handle') === 'sharon-fixture.test'
              ? didSharon
              : url.searchParams.get('handle') === 'another-fixture.test'
                ? didAnother
                : url.searchParams.get('handle') === 'other.test'
                  ? didB
                  : owner,
      }
    else if (url.hostname === 'plc.directory')
      result = {
        id: owner,
        alsoKnownAs: ['at://reader.test'],
        service: [
          {
            id: '#atproto_pds',
            type: 'AtprotoPersonalDataServer',
            serviceEndpoint: regionalPds,
          },
        ],
      }
    else if (
      nsid === 'com.atproto.server.createSession' ||
      nsid === 'com.atproto.server.refreshSession'
    ) {
      if (nsid === 'com.atproto.server.refreshSession' && failRefresh)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'UpstreamFailure',
            message: 'Fixture renewal unavailable',
          }),
        })
      const loginDid =
        nsid === 'com.atproto.server.createSession' &&
        request.postDataJSON().identifier === 'other@example.test'
          ? didB
          : currentDid
      const jwt = token(loginDid),
        refresh = token(loginDid, 'com.atproto.refresh')
      worker.register(jwt, loginDid, url.origin)
      issuedAccess.push(jwt)
      sessionTokens.set(jwt, loginDid)
      sessionTokens.set(refresh, loginDid)
      result = {
        did: loginDid,
        handle: loginDid === didB ? 'other.test' : 'reader.test',
        accessJwt: jwt,
        refreshJwt: refresh,
        email: 'fixture@example.test',
        emailConfirmed: true,
        active: true,
        didDoc: {
          id: loginDid,
          alsoKnownAs: [
            loginDid === didB ? 'at://other.test' : 'at://reader.test',
          ],
          service: [
            {
              id: '#atproto_pds',
              type: 'AtprotoPersonalDataServer',
              serviceEndpoint: url.origin,
            },
          ],
        },
      }
    } else if (nsid === 'com.atproto.server.getSession')
      result = {
        did: currentDid,
        handle: currentDid === didB ? 'other.test' : 'reader.test',
        email: 'fixture@example.test',
        emailConfirmed: true,
        active: true,
      }
    else if (nsid === 'app.bsky.ageassurance.getConfig') result = {regions: []}
    else if (nsid === 'app.bsky.ageassurance.getState')
      result = {
        state: {status: 'unknown', access: 'full'},
        metadata: {accountCreatedAt: '2024-01-01T00:00:00.000Z'},
      }
    else if (nsid === 'app.bsky.actor.getPreferences')
      result = {
        preferences: [
          {
            $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
            items: [
              {
                id: '3lfixture',
                type: 'timeline',
                value: 'following',
                pinned: true,
              },
              ...(timeline !== undefined
                ? [
                    {
                      id: '3lpollfixture',
                      type: 'feed',
                      value:
                        'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot',
                      pinned: true,
                    },
                  ]
                : []),
            ],
          },
          {
            $type: 'app.bsky.actor.defs#personalDetailsPref',
            birthDate: '1990-01-01T00:00:00.000Z',
          },
          {
            $type: 'app.bsky.actor.defs#bskyAppStatePref',
            queuedNudges: [],
            nuxs: [
              'GroupChatsAnnouncement',
              'InviteFriendsAnnouncement',
              'IPadBetaAnnouncement',
            ].map(id => ({id, completed: true})),
          },
          {
            $type: 'app.bsky.actor.defs#feedViewPref',
            feed: 'home',
            hideReplies: false,
            hideReposts: false,
          },
        ],
      }
    else if (nsid === 'app.bsky.actor.putPreferences') result = {}
    else if (nsid === 'app.bsky.feed.getTimeline') {
      const occurrence = item =>
        JSON.stringify([
          item.post.uri,
          item.reason?.by?.did,
          item.reason?.indexedAt,
          item.reply?.root?.uri,
          item.reply?.parent?.uri,
        ])
      const all = (timeline ?? feed).filter(
        item => timeline !== undefined || !deleted.has(item.post.uri),
      )
      const cursor = url.searchParams.get('cursor')
      const index = cursor?.startsWith('after:')
        ? all.findIndex(item => occurrence(item) === cursor.slice(6)) + 1
        : Number(cursor || 0)
      if (cursor?.startsWith('after:') && index === 0)
        throw new Error('Fixture cursor occurrence is no longer available')
      const limit = Number(url.searchParams.get('limit') || 30)
      timelineRequests.push({index, limit})
      const values = all.slice(index, index + limit)
      result = {
        feed: values,
        ...(index + limit < all.length
          ? {cursor: 'after:' + occurrence(values.at(-1))}
          : {}),
      }
      if (
        timelineHold &&
        limit === timelineHold.limit &&
        (timelineHold.index === undefined || index === timelineHold.index)
      ) {
        const hold = timelineHold
        timelineHold = undefined
        hold.entered()
        await hold.done
      }
      timelineResponses.push({index, limit, hasOlder: !!result.cursor})
    } else if (
      nsid === 'app.bsky.feed.getFeed' &&
      url.searchParams.get('feed') ===
        'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot'
    ) {
      result = {feed: entries.slice(0, 30)}
    } else if (
      nsid === 'app.bsky.feed.getFeed' &&
      url.searchParams.get('feed') ===
        'at://did:plc:qrz3lhbyuxbeilrc6nekdqme/app.bsky.feed.generator/9889d7c6d1f9'
    ) {
      result = {feed: entries.slice(0, 30)}
    } else if (
      nsid === 'app.bsky.feed.getFeedGenerator' &&
      url.searchParams.get('feed') ===
        'at://did:plc:qrz3lhbyuxbeilrc6nekdqme/app.bsky.feed.generator/9889d7c6d1f9'
    ) {
      result = {
        view: {
          uri: url.searchParams.get('feed'),
          cid,
          did: 'did:web:fixture-feed.test',
          creator: {...profile(didA), $type: 'app.bsky.actor.defs#profileView'},
          displayName: 'Fixture encoded trending feed',
          description: 'Public route regression fixture',
          indexedAt: new Date(now).toISOString(),
          likeCount: 0,
        },
        isOnline: true,
        isValid: true,
      }
    } else if (
      timeline !== undefined &&
      nsid === 'app.bsky.feed.getFeedGenerators' &&
      url.searchParams.getAll('feeds').length === 1 &&
      url.searchParams.get('feeds') ===
        'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot'
    ) {
      result = {
        feeds: [
          {
            uri: url.searchParams.get('feeds'),
            cid,
            did: 'did:web:fixture-feed.test',
            creator: {
              ...profile(didA),
              $type: 'app.bsky.actor.defs#profileView',
            },
            displayName: 'Discover',
            indexedAt: new Date(now).toISOString(),
            likeCount: 0,
          },
        ],
      }
    } else if (
      timeline !== undefined &&
      nsid === 'app.bsky.unspecced.getSuggestedUsersForDiscover' &&
      url.searchParams.get('limit') === '10'
    ) {
      result = {actors: []}
    } else if (nsid === 'app.bsky.feed.getPosts') {
      const uris = url.searchParams.getAll('uris')
      const all = [
        ...(timeline ?? feed).map(item => item.post),
        ...(timeline ?? feed).flatMap(item => [
          ...(item.reply?.root?.record ? [item.reply.root] : []),
          ...(item.reply?.parent?.record ? [item.reply.parent] : []),
        ]),
        ...[...authorFeeds.values()].flat().map(item => item.post),
        rootPost,
        parentPost,
      ]
      result = {
        posts: uris.flatMap(uri => {
          const value = all.find(post => post.uri === uri)
          return !value ||
            recordDeleted.has(uri) ||
            (timeline === undefined && deleted.has(uri))
            ? []
            : [
                {
                  ...value,
                  labels:
                    recordModerated.has(uri) ||
                    (timeline === undefined && moderated.has(uri))
                      ? [
                          {
                            src: api.moderation.did,
                            uri,
                            val: '!hide',
                            cts: new Date().toISOString(),
                          },
                        ]
                      : (value.labels ?? []),
                },
              ]
        }),
      }
      revalidationResponses.push({
        requested: uris,
        posts: result.posts.map(value => ({
          uri: value.uri,
          labels: value.labels,
        })),
        sharedModerated: uris.filter(uri => moderated.has(uri)),
        sharedDeleted: uris.filter(uri => deleted.has(uri)),
        isolatedTimeline: timeline !== undefined,
      })
    } else if (nsid === 'app.bsky.feed.getPostThread') {
      const uri = url.searchParams.get('uri')
      result = {
        thread: {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: feed.find(item => item.post.uri === uri)?.post || post(1),
          replies: [],
        },
      }
    } else if (nsid === 'app.bsky.actor.getProfile')
      result = {
        ...profile(url.searchParams.get('actor') || didA),
        $type: 'app.bsky.actor.defs#profileViewDetailed',
        followersCount: 10,
        followsCount: 10,
        postsCount: 100,
        createdAt: '2024-01-01T00:00:00Z',
        associated: {chat: {allowIncoming: 'following'}},
      }
    else if (nsid === 'app.bsky.actor.getProfiles')
      result = {
        profiles: url.searchParams.getAll('actors').map(actor => ({
          ...profile(actor),
          $type: 'app.bsky.actor.defs#profileViewDetailed',
        })),
      }
    else if (nsid === 'app.bsky.feed.getAuthorFeed') {
      const actor = url.searchParams.get('actor')
      const index = Number(url.searchParams.get('cursor') || 0)
      const limit = Number(url.searchParams.get('limit') || 30)
      const all = authorFeeds.get(actor) ?? []
      const values =
        url.searchParams.get('filter') === 'posts_with_media'
          ? all.filter(item => item.post.embed?.images)
          : all
      result = {
        feed: values.slice(index, index + limit),
        ...(index + limit < values.length
          ? {cursor: String(index + limit)}
          : {}),
      }
    } else if (nsid === 'app.bsky.actor.searchActorsTypeahead')
      result = {actors: [profile(didA)]}
    else if (nsid === 'app.bsky.notification.getUnreadCount')
      result = {count: 0}
    else if (nsid === 'app.bsky.notification.listNotifications')
      result = {notifications: []}
    else if (nsid === 'app.bsky.graph.getMutes') result = {mutes: []}
    else if (nsid === 'app.bsky.graph.getFollows')
      result = {subject: profile(didA), follows: []}
    else if (nsid === 'app.bsky.graph.getSuggestedFollowsByActor')
      result = {suggestions: []}
    else if (nsid === 'app.bsky.unspecced.getPostThreadV2') {
      const anchor = url.searchParams
        .get('anchor')
        .replace('at://reader.test/', `at://${didA}/`)
        .replace('at://sharon-fixture.test/', `at://${didSharon}/`)
        .replace('at://another-fixture.test/', `at://${didAnother}/`)
      const value =
        (timeline ?? feed).find(item => item.post.uri === anchor)?.post ??
        [...authorFeeds.values()].flat().find(item => item.post.uri === anchor)
          ?.post
      if (!value)
        throw new Error('Requested thread anchor is absent from fixture')
      result = {
        thread: [
          {
            uri: anchor,
            depth: 0,
            value: {
              $type: 'app.bsky.unspecced.defs#threadItemPost',
              post: value,
              moreParents: false,
              moreReplies: 0,
              opThread: false,
              hiddenByThreadgate: false,
              mutedByViewer: false,
            },
          },
          ...(timeline !== undefined &&
          !anchor.endsWith('/' + threadReply.uri.split('/').at(-1))
            ? [
                {
                  uri: threadReply.uri,
                  depth: 1,
                  value: {
                    $type: 'app.bsky.unspecced.defs#threadItemPost',
                    post: threadReply,
                    moreParents: false,
                    moreReplies: 0,
                    opThread: false,
                    hiddenByThreadgate: false,
                    mutedByViewer: false,
                  },
                },
              ]
            : []),
        ],
        hasOtherReplies: false,
      }
    } else if (nsid === 'app.bsky.graph.getBlocks') result = {blocks: []}
    else if (
      nsid === 'app.bsky.graph.getListMutes' ||
      nsid === 'app.bsky.graph.getListBlocks'
    )
      result = {lists: []}
    else if (nsid === 'app.bsky.labeler.getServices')
      result = {
        views: url.searchParams.getAll('dids').map(did => ({
          $type: 'app.bsky.labeler.defs#labelerViewDetailed',
          uri: `at://${did}/app.bsky.labeler.service/self`,
          cid,
          creator: {...profile(did), handle: 'mod-authority.test'},
          policies: {labelValues: [], labelValueDefinitions: []},
          indexedAt: new Date(now).toISOString(),
        })),
      }
    else if (nsid === 'app.bsky.unspecced.getConfig')
      result = {checkEmailConfirmed: false, topicsEnabled: true}
    else if (nsid === 'app.bsky.unspecced.getSuggestedFeeds')
      result = {feeds: []}
    else if (
      nsid === 'app.bsky.unspecced.getSuggestedUsers' ||
      nsid === 'app.bsky.actor.getSuggestions'
    )
      result = {actors: []}
    else if (nsid === 'app.bsky.unspecced.getTrendingTopics')
      result = {topics: [], suggested: []}
    else if (nsid === 'app.bsky.unspecced.getTrends')
      result = {
        recIdStr: 'fixture-route-trend',
        trends: [
          {
            topic: 'Fixture encoded trending feed',
            displayName: 'Fixture encoded trending feed',
            link: '/profile/did%3Aplc%3Aqrz3lhbyuxbeilrc6nekdqme/feed/9889d7c6d1f9',
            startedAt: new Date(now).toISOString(),
            postCount: 20,
            status: 'hot',
            actors: [],
          },
        ],
      }
    else if (nsid === 'chat.bsky.convo.listConvos') result = {convos: []}
    else if (nsid === 'chat.bsky.convo.getConvoAvailability')
      result = {canChat: true}
    else if (nsid === 'chat.bsky.convo.getLog')
      result = {logs: [], cursor: 'fixture-empty-log'}
    else if (nsid === 'chat.bsky.convo.getUnreadCounts')
      result = {unreadAcceptedConvos: 0, unreadRequestConvos: 0}
    else if (nsid === 'com.atproto.repo.getRecord') {
      status = 400
      result = {error: 'RecordNotFound', message: 'No fixture declaration'}
    } else {
      unexpected.push({url: request.url(), method: request.method()})
      status = 400
      result = {
        error: 'FixtureUnsupported',
        message: 'No response defined for ' + request.url(),
      }
    }
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(result),
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
      },
    })
  })
  return {
    expireAccess: () => issuedAccess.forEach(value => worker.expire(value)),
    failRefresh: value => {
      failRefresh = value
    },
    issuedAccess,
    setTimeline: value => {
      timeline = value
    },
    setThreadReply: value => {
      threadReply = value
    },
    timelineRequests,
    timelineResponses,
    revalidationResponses,
    sharedRecordState: uri => ({
      uri,
      moderated: moderated.has(uri),
      deleted: deleted.has(uri),
      labels: moderated.has(uri) ? ['!hide'] : [],
    }),
    setRecordModerated: (uri, hidden) =>
      hidden ? recordModerated.add(uri) : recordModerated.delete(uri),
    setRecordDeleted: (uri, missing) =>
      missing ? recordDeleted.add(uri) : recordDeleted.delete(uri),
    holdTimeline: (limit = 1, index) => {
      let entered, release
      const reached = new Promise(resolve => {
        entered = resolve
      })
      const done = new Promise(resolve => {
        release = resolve
      })
      timelineHold = {entered, done, limit, index}
      return {reached, release}
    },
  }
}
const report = {
  productionBundle: true,
  sourceSha256: buildRecord.inputs.sha256,
  served: [],
  measurements: [],
  checks: [],
  unexpected,
  errors,
  contexts: [],
}
let desktopBrowser,
  phoneBrowser,
  desktop,
  phone,
  page,
  pwaContext,
  freshPhoneContext
async function runBrowserProof() {
  desktopBrowser = await chromium.launch({
    ...(process.env.SKYANCHOR_BROWSER_CHANNEL
      ? {channel: process.env.SKYANCHOR_BROWSER_CHANNEL}
      : {}),
    args: [`--ignore-certificate-errors-spki-list=${fixtureSpki}`],
  })
  report.desktopBrowser = {
    channel: process.env.SKYANCHOR_BROWSER_CHANNEL ?? 'chromium',
    version: desktopBrowser.version(),
  }
  phoneBrowser = await webkit.launch()
  desktop = await desktopBrowser.newContext({
    viewport: {width: 1280, height: 900},
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  })
  phone = await phoneBrowser.newContext({
    viewport: {width: 390, height: 844},
    userAgent: devices['iPhone 13'].userAgent,
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  })
  // Windows WebKit retains Win32 even with mobile emulation; match iPhone keymaps.
  await phone.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', {get: () => 'iPhone'})
  })
  await phone.addInitScript(installViewportFixture)
  await desktop.addInitScript(() => {
    Object.defineProperty(window, 'visualViewport', {
      value: undefined,
      configurable: true,
    })
  })
  report.contexts = [
    'Chromium desktop 1280x900; service workers blocked so all upstream traffic is intercepted',
    'WebKit simulated phone 390x844; not a physical iPhone; service workers blocked for mock isolation',
  ]
  await Promise.all([mockUpstream(desktop), mockUpstream(phone)])
  page = await desktop.newPage()
  const phonePage = await phone.newPage()
  for (const current of [page, phonePage]) {
    const label = current === phonePage ? 'webkit' : 'chromium'
    const isPollRequest = request =>
      /^https:\/\/bsky\.social\/xrpc\/(?:chat\.bsky\.convo\.getLog|app\.bsky\.notification\.listNotifications)(?:\?|$)/.test(
        request.url(),
      )
    current.on('framenavigated', frame => {
      if (frame === current.mainFrame())
        networkEvents.push({
          event: 'navigation',
          page: label,
          url: frame.url(),
          time: Date.now(),
        })
    })
    current.on('requestfinished', request => {
      if (isPollRequest(request))
        networkEvents.push({
          event: 'finished',
          page: label,
          url: request.url(),
          time: Date.now(),
        })
    })
    current.on('pageerror', error => {
      errors.push(error.message)
      networkEvents.push({
        event: 'pageerror',
        page: current === phonePage ? 'webkit' : 'chromium',
        url: current.url(),
        message: error.message,
        stack: error.stack,
        time: Date.now(),
      })
    })
    current.on('requestfailed', request =>
      networkEvents.push({
        event: 'failed',
        page: current === phonePage ? 'webkit' : 'chromium',
        url: request.url(),
        error: request.failure()?.errorText,
        time: Date.now(),
      }),
    )
    current.on('request', request => {
      if (isPollRequest(request))
        networkEvents.push({
          event: 'request',
          page: current === phonePage ? 'webkit' : 'chromium',
          url: request.url(),
          origin: request.headers().origin,
          method: request.method(),
          time: Date.now(),
        })
    })
    current.on('response', response => {
      const expectedFailure = anticipatedFailures.find(
        expected =>
          expected.page === current &&
          expected.remaining > 0 &&
          expected.status === response.status() &&
          response.url() === origin + '/api/skyanchor/place' &&
          response.request().method() === 'GET',
      )
      if (expectedFailure) {
        expectedFailure.remaining--
        report.expectedHttpFailures ??= []
        report.expectedHttpFailures.push({
          status: response.status(),
          reason: expectedFailure.reason,
          page: current === phonePage ? 'webkit' : 'chromium',
        })
        return
      }
      if (
        response.status() >= 400 &&
        !response.url().includes('com.atproto.repo.getRecord') &&
        !(
          response.status() === 409 &&
          response.url().startsWith(origin + '/api/skyanchor/')
        )
      )
        errors.push(`${response.status()} ${response.url().split('?')[0]}`)
    })
  }
  async function setConnectivity(context, offline) {
    networkEvents.push({
      event: 'connectivity',
      page: context === phone ? 'webkit' : 'chromium',
      offline,
      time: Date.now(),
    })
    await context.setOffline(offline)
  }
  async function signIn(
    current,
    identifier = 'fixture@example.test',
    welcomeState,
  ) {
    const storageState = await current.context().storageState()
    const welcomeShown =
      storageState.origins
        .find(entry => entry.origin === origin)
        ?.localStorage.some(
          entry => entry.name === 'welcomeModalShown' && entry.value === 'true',
        ) ?? false
    if (welcomeState === 'shown') assert.equal(welcomeShown, true)
    if (welcomeState === 'transition' || welcomeState === 'auth-entry') {
      const time = new Date()
      await current.clock.install({time})
      await current.clock.pauseAt(new Date(time.getTime() + 1000))
    }
    await current.goto(origin + '/')
    const welcome = current.getByTestId('welcomeModal')
    const outerSignIn = current
      .locator(
        'body:not(:has([data-testid="welcomeModal"])) :is([data-testid="signInButton"], [role="navigation"] [role="button"][aria-label="Sign in"])',
      )
      .filter({visible: true})
    const modalSignIn = welcome.getByRole('button', {
      name: 'Sign in',
      exact: true,
    })
    const signInAction = modalSignIn.or(outerSignIn).filter({visible: true})
    const assertSignInAction = async modal => {
      await expect(signInAction).toHaveCount(1)
      await expect(modal ? modalSignIn : outerSignIn).toHaveCount(1)
      await expect(modal ? outerSignIn : modalSignIn).toHaveCount(0)
    }
    const useModal =
      welcomeState === 'open' ||
      welcomeState === 'transition' ||
      (!welcomeState && !welcomeShown)
    if (welcomeState === 'open' || (!welcomeState && !welcomeShown)) {
      await welcome.waitFor()
      await assertSignInAction(true)
    }
    if (welcomeState === 'shown' || (!welcomeState && welcomeShown)) {
      await outerSignIn.waitFor()
      await expect(welcome).toHaveCount(0)
      await assertSignInAction(false)
    }
    if (welcomeState === 'auth-entry') {
      await outerSignIn.waitFor()
      await expect(welcome).toHaveCount(0)
      await assertSignInAction(false)
    }
    if (welcomeState === 'transition') {
      await outerSignIn.waitFor()
      await expect(welcome).toHaveCount(0)
      await assertSignInAction(false)
      await current.clock.runFor(1100)
      await current.clock.resume()
      await welcome.waitFor({timeout: 30_000})
      await assertSignInAction(true)
    }
    if (welcomeState === 'dismissed') {
      await welcome.waitFor()
      await welcome
        .getByRole('button', {name: 'Close welcome modal', exact: true})
        .click()
      await expect(welcome).toHaveCount(0)
      await assertSignInAction(false)
    }
    await current.evaluate(() => {
      window.fixtureSignInAction = undefined
      document.addEventListener(
        'click',
        event => {
          const button =
            event.target instanceof Element
              ? event.target.closest('[role="button"], button')
              : undefined
          if (
            button?.getAttribute('aria-label') === 'Sign in' ||
            button?.getAttribute('data-testid') === 'signInButton'
          ) {
            window.fixtureSignInAction = button.closest(
              '[data-testid="welcomeModal"]',
            )
              ? 'welcome'
              : 'outer'
          }
        },
        {capture: true},
      )
    })
    await (useModal ? modalSignIn : outerSignIn).click({timeout: 30_000})
    {
      const action = await current.evaluate(() => window.fixtureSignInAction)
      assert.equal(action, useModal ? 'welcome' : 'outer')
      report.signInWelcome ??= []
      report.signInWelcome.push({
        state: welcomeState ?? (welcomeShown ? 'shown' : 'fresh'),
        welcomeShown,
        action,
      })
    }
    const addAccount = current.getByTestId('chooseAddAccountBtn')
    await current
      .getByTestId('loginUsernameInput')
      .or(addAccount)
      .filter({visible: true})
      .first()
      .waitFor()
    if (await addAccount.isVisible()) await addAccount.click()
    await current.getByTestId('loginUsernameInput').fill(identifier)
    await expect(current.getByTestId('loginUsernameInput')).toBeVisible()
    await expect(current.getByTestId('loginPasswordInput')).toBeVisible()
    await current
      .getByTestId('loginPasswordInput')
      .fill(randomBytes(20).toString('hex'))
    if (welcomeState === 'auth-entry') {
      await current.clock.runFor(2000)
      await expect(welcome).toHaveCount(0)
      await expect(current.getByTestId('loginUsernameInput')).toBeVisible()
      await expect(current.getByTestId('loginPasswordInput')).toBeVisible()
      await current.clock.resume()
    }
    await current.getByTestId('loginNextButton').click()
    try {
      await current.getByTestId('HomeScreen').waitFor({timeout: 30_000})
    } catch (error) {
      console.log(
        'Actual official UI at failed Home transition:',
        await current.locator('body').innerText(),
      )
      await current.screenshot({path: 'proof-login-failure.png'})
      throw error
    }
    await current
      .locator('[data-skyanchor-key]')
      .first()
      .waitFor({timeout: 30_000})
    await current.waitForTimeout(500)
  }
  if (process.argv.includes('--sync-recovery-only')) {
    await verifySyncRecovery({
      phoneBrowser,
      mockUpstream,
      signIn,
      worker,
      report,
    })
    assert.deepEqual(unexpected, [])
    report.passed = true
    return
  }
  if (process.argv.includes('--reverse-only')) {
    await verifyReverseHandoff({
      desktopBrowser,
      phoneBrowser,
      mockUpstream,
      signIn,
      worker,
      report,
      holdApi,
    })
    assert.deepEqual(unexpected, [])
    report.passed = true
    return
  }
  if (process.argv.includes('--device-checkpoints-only')) {
    await verifyDeviceCheckpoints({
      desktopBrowser,
      phoneBrowser,
      mockUpstream,
      signIn,
      worker,
      report,
      holdApi,
      entries,
    })
    assert.deepEqual(unexpected, [])
    report.passed = true
    return
  }
  if (process.argv.includes('--scroll-input-only')) {
    await verifyScrollInput({
      phoneBrowser,
      mockUpstream,
      signIn,
      worker,
      report,
    })
    assert.deepEqual(unexpected, [])
    report.passed = true
    return
  }
  if (process.argv.includes('--handoff-only')) {
    await verifyDeviceCheckpoints({
      desktopBrowser,
      phoneBrowser,
      mockUpstream,
      signIn,
      worker,
      report,
      holdApi,
      entries,
    })
    await verifyAutomaticSource({
      desktopBrowser,
      phoneBrowser,
      origin,
      mockUpstream,
      signIn,
      worker,
      report,
      holdApi,
    })
    await verifyReverseHandoff({
      desktopBrowser,
      phoneBrowser,
      mockUpstream,
      signIn,
      worker,
      report,
      holdApi,
    })
    await verifyHandoff({
      desktopBrowser,
      phoneBrowser,
      origin,
      mockUpstream,
      signIn,
      worker,
      report,
      deleted,
      entries,
      post,
      holdApi,
    })
    assert.deepEqual(unexpected, [])
    report.passed = true
    return
  }
  await signIn(page, 'fixture@example.test', 'open')
  await signIn(phonePage, 'reader.test')
  if (process.argv.includes('--new-content-only')) {
    await verifyNewContent({
      desktopBrowser,
      phoneBrowser,
      origin,
      mockUpstream,
      signIn,
      worker,
      report,
      entries,
      post,
      installViewportFixture,
    })
    assert.deepEqual(unexpected, [])
    report.passed = true
    return
  }
  if (process.argv.includes('--thread-back-only')) {
    await verifyThreadBack({
      desktopBrowser,
      phoneBrowser,
      mockUpstream,
      signIn,
      report,
      installViewportFixture,
      worker,
      entries,
    })
    assert.deepEqual(unexpected, [])
    report.passed = true
    return
  }
  if (process.argv.includes('--settlement-only')) {
    await verifySettlement({
      phoneBrowser,
      mockUpstream,
      signIn,
      worker,
      report,
      entries,
    })
    assert.deepEqual(unexpected, [])
    report.passed = true
    return
  }
  if (process.argv.includes('--profile-only')) {
    await scrollReading(page, 400)
    const connected = page.waitForResponse(
      response =>
        response.url() === origin + '/api/skyanchor/session' &&
        response.request().method() === 'POST',
    )
    await readingAction(page, 'Connect private sync')
    assert.equal((await connected).status(), 200)
    await expect
      .poll(async () =>
        worker.db
          .prepare(
            "SELECT revision FROM places WHERE did = ? AND feed = 'following'",
          )
          .bind(didA)
          .first(),
      )
      .not.toBeNull()
    await expect(page.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await closeReadingPanel(page)
    await readingAction(phonePage, 'Connect private sync')
    await expect(
      phonePage.getByRole('button', {name: 'Check other device', exact: true}),
    ).toBeEnabled()
    await closeReadingPanel(phonePage)
    await verifyProfileReading({
      page,
      phonePage,
      origin,
      worker,
      did: didA,
      authors: [didSharon, didAnother],
      report,
      setConnectivity,
      phoneService: regionalPds,
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(unexpected, [])
    report.passed = true
    return
  }
  assert.ok(
    upstreamCalls.some(
      call =>
        call.nsid === 'com.atproto.server.createSession' &&
        call.url === regionalPds + '/xrpc/com.atproto.server.createSession',
    ),
    'Actual handle sign-in authenticates at the resolved regional PDS',
  )
  for (const welcomeState of [
    'transition',
    'dismissed',
    'auth-entry',
    'shown',
  ]) {
    const noWelcomeContext = await desktopBrowser.newContext({
      viewport: {width: 1280, height: 900},
      serviceWorkers: 'block',
    })
    try {
      await mockUpstream(noWelcomeContext)
      const noWelcomePage = await noWelcomeContext.newPage()
      noWelcomePage.on('pageerror', error => errors.push(error.message))
      noWelcomePage.on('response', response => {
        if (
          response.status() >= 400 &&
          !response.url().includes('com.atproto.repo.getRecord')
        )
          errors.push(`${response.status()} ${response.url().split('?')[0]}`)
      })
      if (welcomeState === 'shown') {
        await noWelcomePage.goto(origin + '/')
        await noWelcomePage.getByTestId('welcomeModal').waitFor()
        await noWelcomePage
          .getByRole('button', {name: 'Close welcome modal', exact: true})
          .click()
        await expect(noWelcomePage.getByTestId('welcomeModal')).toHaveCount(0)
      }
      await signIn(noWelcomePage, 'fixture@example.test', welcomeState)
    } finally {
      await noWelcomeContext.close()
    }
  }
  report.checks.push(
    'Production sign-in resolves a new gesture only after the actual welcome phase is ready: fresh/open, late presentation after an initial outer lookup, real dismissal, previously shown preference across navigation, or isolated pre-timer auth entry. Each phase has one eligible action and completes two-field fake-account Home navigation; advancing the clock with login fields visible never presents welcome over auth entry.',
  )
  await verifyViewport({page: phonePage, report})
  const healthCallsBefore = upstreamCalls.filter(
    call => call.nsid === '_health',
  ).length
  const healthProbe = await page.evaluate(async () => {
    const response = await fetch('https://public.api.bsky.app/xrpc/_health', {
      cache: 'no-store',
    })
    return {status: response.status, body: await response.json()}
  })
  assert.deepEqual(healthProbe, {
    status: 200,
    body: {version: 'fixture-appview'},
  })
  assert.ok(
    upstreamCalls.filter(
      call =>
        call.nsid === '_health' &&
        call.url === 'https://public.api.bsky.app/xrpc/_health' &&
        call.method === 'GET',
    ).length > healthCallsBefore,
    'The exact public AppView connectivity GET must reach the fixture',
  )
  report.checks.push(
    'Fixed public AppView GET /xrpc/_health connectivity probe returns the version JSON used by checkIsOnline; all unknown upstream routes remain errors.',
  )
  await verifyAuthContrast({
    desktopBrowser,
    phoneBrowser,
    origin,
    mockUpstream,
    seed: await page.evaluate(() =>
      JSON.parse(localStorage.getItem('BSKY_STORAGE')),
    ),
    report,
  })
  report.checks.push(
    'Actual production official Home signed in through PasswordSession in two independent browser contexts',
  )
  await verifyReadingPanel(page, report)
  await verifyReadingPanel(phonePage, report)
  for (const [browser, seedPage, isPhone] of [
    [desktopBrowser, page, false],
    [phoneBrowser, phonePage, true],
  ])
    await verifyStartup({
      browser,
      phone: isPhone,
      seedPage,
      origin,
      mockUpstream,
      did: didA,
      report,
      worker,
    })
  const initialKeys = await page
    .locator('[data-skyanchor-key]')
    .evaluateAll(nodes => nodes.map(node => node.dataset.skyanchorKey))
  assert.ok(
    initialKeys.some(
      key => key.includes('|repost:' + didB + ':') && key.includes('/post20|'),
    ),
    'Actual Home exposes distinct repost occurrence identity',
  )
  assert.ok(
    initialKeys.some(
      key =>
        key.includes('|reply:') &&
        key.includes('/post111|') &&
        key.includes('|context:at://' + didA + '/app.bsky.feed.post/post12'),
    ),
    'Actual Home exposes reply-parent and feed-context identity',
  )
  report.checks.push(
    'Actual Following rows include repost occurrence and reply-parent context keys',
  )
  await page.screenshot({path: 'proof-desktop.png', fullPage: false})
  await phonePage.screenshot({path: 'proof-phone.png', fullPage: false})
  if (process.env.SKYANCHOR_SMOKE_ONLY !== '1') {
    await phonePage
      .locator('[data-skyanchor-key]')
      .filter({hasText: 'Fixture post 20.'})
      .first()
      .scrollIntoViewIfNeeded()
    await phonePage.evaluate(() => window.scrollBy(0, 80))
    await phonePage.waitForTimeout(250)
    const phonePlace = await phonePage.evaluate(
      did =>
        JSON.parse(localStorage.getItem('skyanchor:following:v1:' + did)).place,
      didA,
    )
    const phoneTop = () =>
      phonePage.evaluate(
        key =>
          [...document.querySelectorAll('[data-skyanchor-key]')]
            .find(node => node.dataset.skyanchorKey === key)
            ?.getBoundingClientRect().top,
        phonePlace.anchor,
      )
    await phonePage.waitForLoadState('networkidle')
    const phoneBefore = await phoneTop()
    await phonePage.reload()
    await phonePage.getByTestId('HomeScreen').waitFor()
    await phonePage.getByTestId('skyanchor-reading-button').waitFor()
    await phonePage.waitForTimeout(1200)
    const phoneAfter = await phoneTop()
    assert.equal(
      typeof phoneAfter,
      'number',
      'WebKit cold-resume occurrence still exists',
    )
    const phoneDelta = Math.abs(phoneAfter - phoneBefore)
    report.measurements.push({
      name: 'WebKit phone-sized cold resume',
      before: phoneBefore,
      after: phoneAfter,
      deltaCSSPx: phoneDelta,
      thresholdCSSPx: 2,
    })
    assert.ok(
      phoneDelta <= 2,
      `WebKit cold-resume drift ${phoneDelta}px exceeds 2px`,
    )
    const row = page
      .locator('[data-skyanchor-key]')
      .filter({hasText: 'Fixture post 20.'})
      .first()
    await row.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, 160))
    await page.waitForTimeout(250)
    const saved = await page.evaluate(
      did =>
        JSON.parse(localStorage.getItem('skyanchor:following:v1:' + did)).place,
      didA,
    )
    const top = () =>
      page.evaluate(
        key =>
          [...document.querySelectorAll('[data-skyanchor-key]')]
            .find(node => node.dataset.skyanchorKey === key)
            ?.getBoundingClientRect().top,
        saved.anchor,
      )
    const before = await top()
    async function stable(name, action) {
      await action()
      await page.waitForTimeout(600)
      const after = await top()
      assert.equal(typeof after, 'number', `${name}: anchor still present`)
      const delta = Math.abs(after - before)
      report.measurements.push({
        name,
        before,
        after,
        deltaCSSPx: delta,
        thresholdCSSPx: 2,
      })
      assert.ok(delta <= 2, `${name}: drift ${delta}px exceeds 2px`)
    }
    feed = [{post: post(0)}, ...feed]
    await stable('Refresh fetches without replacing window', async () => {
      await readingAction(page, 'Refresh')
      await readingPanel(page)
      await expect(page.getByTestId('skyanchor-new')).toHaveCount(0)
      await closeReadingPanel(page)
    })
    await stable('Resize preserves within-post offset', () =>
      page.setViewportSize({width: 1120, height: 820}),
    )
    await stable(
      'Thread navigation and browser back preserve place',
      async () => {
        await row.locator('a[href*="/post/post20"]').first().click()
        await page.waitForURL(/\/post\/post20/)
        await expect(
          page.getByTestId('postThreadItem-by-reader.test'),
        ).toContainText('Fixture post 20.')
        await page.goBack()
        await page.getByTestId('skyanchor-reading-button').waitFor()
      },
    )
    await stable(
      'Profile navigation and browser back preserve place',
      async () => {
        await row
          .locator('a[href*="/profile/"]')
          .filter({hasText: 'Fixture Reader'})
          .first()
          .click()
        await page.waitForURL(/\/profile\//)
        await page.goBack()
        await page.getByTestId('skyanchor-reading-button').waitFor()
      },
    )
    state.lateImage = true
    await stable('Cold reopen restores occurrence and offset', async () => {
      await page.reload()
      await page.getByTestId('HomeScreen').waitFor()
      await page.getByTestId('skyanchor-reading-button').waitFor()
      await page.locator('[data-skyanchor-key]').first().waitFor()
      await page.waitForTimeout(1200)
    })
    report.checks.push(
      'Delayed upstream image completes after cold restore without anchor drift',
    )
    await legacyReturnFixture(page, didA)
    await readingPanel(page)
    await expect(
      page.getByRole('button', {name: 'Return to my place', exact: true}),
    ).toBeVisible()
    await closeReadingPanel(page)
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
    const checkpoint = await page.evaluate(
      did => JSON.parse(localStorage.getItem('skyanchor:return:v1:' + did)),
      didA,
    )
    assert.equal(checkpoint.version, 1)
    assert.equal(checkpoint.snapshot.place.anchor, saved.anchor)
    await page.reload()
    await readingPanel(page)
    await expect(
      page.getByRole('button', {name: 'Return to my place', exact: true}),
    ).toBeVisible()
    await stable('Cold legacy Return restores prior window', () =>
      readingAction(page, 'Return to my place'),
    )
    report.checks.push(
      'Refresh, resize, reopen, latest and return anchor checks',
    )
    await readingAction(page, 'Connect private sync')
    await expect(
      page.getByRole('button', {name: 'Save my place', exact: true}),
    ).toBeVisible()
    await readingAction(page, 'Check other device')
    const initialCloud = await worker.db
      .prepare(
        "SELECT revision FROM places WHERE did = ? AND feed = 'following'",
      )
      .bind(didA)
      .first()
    await closeReadingPanel(page)
    await scrollReading(page, 45)
    const cloudPlace = () =>
      worker.db
        .prepare('SELECT state, revision FROM places WHERE did = ?')
        .bind(didA)
        .first()
    await expect
      .poll(async () => {
        const row = await cloudPlace()
        const cloud = row?.state
        const local = await page.evaluate(
          did =>
            JSON.stringify(
              JSON.parse(localStorage.getItem('skyanchor:following:v1:' + did))
                .place,
            ),
          didA,
        )
        return (
          !!cloud &&
          row.revision > (initialCloud?.revision ?? 0) &&
          cloud === local
        )
      })
      .toBe(true)
    const automaticallySaved = JSON.parse((await cloudPlace()).state)
    await readingAction(phonePage, 'Connect private sync')
    await expect(
      phonePage.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeVisible()
    const phoneViewport = await phoneTop()
    assert.ok(
      Math.abs(phoneViewport - phoneBefore) <= 2,
      'Remote offer must not move phone',
    )
    const desktopTop = await top()
    await closeReadingPanel(phonePage)
    await expect(
      phonePage.getByTestId('skyanchor-reading-button'),
    ).toHaveAccessibleName(/Reading place: Other device place available/)
    await readingAction(phonePage, 'Resume other device')
    report.remoteResumeGeometry = await phonePage.evaluate(
      ({did, target}) => ({
        target,
        local: JSON.parse(localStorage.getItem('skyanchor:following:v1:' + did))
          .place,
        header: document
          .querySelector('[data-testid="mobileHomeHeader"]')
          .getBoundingClientRect().bottom,
        row: [...document.querySelectorAll('[data-skyanchor-key]')]
          .filter(node => node.dataset.skyanchorKey === target.anchor)
          .map(node => ({
            top: node.getBoundingClientRect().top,
            bottom: node.getBoundingClientRect().bottom,
          })),
      }),
      {did: didA, target: automaticallySaved},
    )
    await expect
      .poll(() =>
        phonePage.evaluate(
          did =>
            JSON.stringify(
              JSON.parse(localStorage.getItem('skyanchor:following:v1:' + did))
                .place,
            ),
          didA,
        ),
      )
      .toBe(JSON.stringify(automaticallySaved))
    await expect(
      phonePage.getByTestId('skyanchor-resume-result'),
    ).toContainText('Resumed the other device')
    await expect
      .poll(async () => {
        const top = await phonePage.evaluate(
          key =>
            [...document.querySelectorAll('[data-skyanchor-key]')]
              .find(node => node.dataset.skyanchorKey === key)
              ?.getBoundingClientRect().top,
          automaticallySaved.anchor,
        )
        return Math.abs(
          top - (automaticallySaved.offset + phoneBefore - phonePlace.offset),
        )
      })
      .toBeLessThanOrEqual(2)
    const previousRevision = (await cloudPlace()).revision
    await phonePage.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
    await scrollReading(phonePage, 55)
    await expect
      .poll(async () => (await cloudPlace()).revision)
      .toBeGreaterThan(previousRevision)
    const phoneAutomatic = await phonePage.evaluate(
      did =>
        JSON.parse(localStorage.getItem('skyanchor:following:v1:' + did)).place,
      didA,
    )
    assert.deepEqual(
      JSON.parse((await cloudPlace()).state),
      phoneAutomatic,
      'Actual phone movement automatically reaches D1 without Save',
    )
    await readingAction(page, 'Check other device')
    await expect(
      page.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeVisible()
    assert.ok(
      Math.abs((await top()) - desktopTop) <= 2,
      'Other device update must not move desktop viewport',
    )
    await readingAction(page, 'Save my place')
    await expect(page.getByText(/CAS conflict:/)).toBeVisible()
    await desktop.setOffline(true)
    await readingAction(page, 'Save my place')
    await expect(page.getByText(/Offline: no write sent/)).toBeVisible()
    await desktop.setOffline(false)
    report.checks.push(
      'Opt-in automatic desktop and phone movement saves reach real D1 without Save; explicit Resume adopts occurrence/offset, remote offers preserve viewport; actual stale CAS and offline refusal pass',
    )
    await readingAction(page, 'Keep mine')
    await expect(
      page.getByText('Private reading place saved.', {exact: true}),
    ).toBeVisible()
    await closeReadingPanel(page)
    const pendingRevision = (await cloudPlace()).revision
    const pendingWrite = holdApi('PUT')
    await scrollReading(page, 35)
    await Promise.race([
      pendingWrite.reached,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Automatic delayed write did not reach D1')),
          10_000,
        ),
      ),
    ])
    await scrollReading(page, 45)
    await new Promise(resolve => setTimeout(resolve, 900))
    pendingWrite.release()
    await expect
      .poll(async () => (await cloudPlace()).revision)
      .toBeGreaterThan(pendingRevision + 1)
    assert.deepEqual(
      JSON.parse((await cloudPlace()).state),
      await page.evaluate(
        did =>
          JSON.parse(localStorage.getItem('skyanchor:following:v1:' + did))
            .place,
        didA,
      ),
      'Pending movement saves the latest captured place, not the delayed older capture',
    )
    const staleRead = holdApi('GET')
    await readingAction(page, 'Check other device')
    await Promise.race([
      staleRead.reached,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Delayed read did not reach D1')),
          10_000,
        ),
      ),
    ])
    await readingAction(phonePage, 'Check other device')
    await expect(
      phonePage.getByRole('button', {name: 'Keep mine', exact: true}),
    ).toBeVisible()
    await readingAction(phonePage, 'Keep mine')
    await expect(
      phonePage.getByText('Private reading place saved.', {exact: true}),
    ).toBeVisible()
    const staleTop = await top()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(
      page.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeVisible()
    staleRead.release()
    await expect(
      page.getByRole('button', {name: 'Keep mine', exact: true}),
    ).toBeEnabled()
    await expect(page.getByTestId('skyanchor-connection-status')).toHaveText(
      'Other device decision needed',
    )
    assert.ok(
      Math.abs((await top()) - staleTop) <= 2,
      'Delayed older response cannot move the viewport or erase a newer remote offer',
    )
    await readingAction(page, 'Keep mine')
    await expect(
      page.getByText('Private reading place saved.', {exact: true}),
    ).toBeVisible()
    const oldCookie = (await desktop.cookies(origin)).find(
      cookie => cookie.name === '__Host-skyanchor',
    ).value
    anticipatedFailures.push(
      {
        page,
        status: 401,
        remaining: 1,
        reason:
          'Expired desktop sync cookie must be refused before automatic renewal',
      },
      {
        page: phonePage,
        status: 401,
        remaining: 1,
        reason:
          'Expired phone sync cookie must be refused before automatic renewal',
      },
    )
    await worker.db
      .prepare('UPDATE sessions SET expires = 0 WHERE did = ?')
      .bind(didA)
      .run()
    await readingAction(page, 'Check other device')
    await expect
      .poll(
        async () =>
          (await desktop.cookies(origin)).find(
            cookie => cookie.name === '__Host-skyanchor',
          )?.value,
      )
      .not.toBe(oldCookie)
    await readingAction(phonePage, 'Check other device')
    await expect
      .poll(
        async () =>
          (
            await worker.db
              .prepare(
                'SELECT COUNT(*) AS count FROM sessions WHERE did = ? AND expires > ?',
              )
              .bind(didA, Date.now())
              .first()
          ).count,
      )
      .toBe(2)
    assert.ok(
      Math.abs((await top()) - staleTop) <= 2,
      'Automatic session renewal does not resume a different place',
    )
    report.checks.push(
      'Delayed automatic write drains the latest pending capture; older GET completion is rejected after a newer foreground offer; expired ten-minute cookies automatically renew on both devices without viewport movement',
    )
    const activeCookie = (await desktop.cookies(origin)).find(
      cookie => cookie.name === '__Host-skyanchor',
    ).value
    const replacement = await worker.runtime.dispatchFetch(
      origin + '/api/skyanchor/session',
      {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          authorization: 'Bearer ' + worker.token(didB),
          cookie: '__Host-skyanchor=' + activeCookie,
        },
        body: JSON.stringify({device: randomUUID()}),
      },
    )
    assert.equal(replacement.status, 200)
    const replacementCookie = replacement.headers
      .get('set-cookie')
      .match(/__Host-skyanchor=([^;]+)/)[1]
    await replacement.arrayBuffer()
    await desktop.addCookies([
      {
        name: '__Host-skyanchor',
        value: replacementCookie,
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ])
    anticipatedFailures.push({
      page,
      status: 403,
      remaining: 1,
      reason:
        'Other account replacement cookie must be refused by current account CSRF before renewal',
    })
    await readingAction(page, 'Check other device')
    await expect
      .poll(
        async () =>
          (await desktop.cookies(origin)).find(
            cookie => cookie.name === '__Host-skyanchor',
          )?.value,
      )
      .not.toBe(replacementCookie)
    assert.equal(
      await worker.db
        .prepare('SELECT state FROM places WHERE did = ?')
        .bind(didB)
        .first(),
      null,
      'An old account CSRF cannot read or upload progress under a replacement account cookie',
    )
    assert.ok(Math.abs((await top()) - staleTop) <= 2)
    report.checks.push(
      'A real replacement D1 cookie for another account is refused by old-account CSRF even on GET; automatic reauthentication restores the active account without exposing or writing the other account state',
    )
    const trendPath =
      '/profile/did%3Aplc%3Aqrz3lhbyuxbeilrc6nekdqme/feed/9889d7c6d1f9'
    const trendLink = page
      .locator(`a[href="${trendPath}"]`)
      .filter({visible: true})
      .first()
    await expect(trendLink).toBeVisible()
    await closeReadingPanel(page)
    await page.waitForTimeout(1000)
    const followingBeforeTrend = await page.evaluate(() => ({
      y: scrollY,
      places: Object.fromEntries(
        Object.entries(localStorage).filter(([key]) =>
          /^skyanchor:(following|return|revision)/.test(key),
        ),
      ),
    }))
    const cloudBeforeTrend = await cloudPlace()
    const opened = desktop.waitForEvent('page')
    await trendLink.click({button: 'middle'})
    const trendPage = await opened
    const verifyTrendPage = async current => {
      await expect(current.getByTestId('customFeedScreen')).toBeVisible()
      try {
        await expect(
          current.getByText('Fixture post 1.', {exact: false}).first(),
        ).toBeVisible()
      } finally {
        report.trendRouteSurface = {
          url: current.url(),
          titleVisible: await current
            .getByText('Fixture encoded trending feed', {exact: true})
            .first()
            .isVisible(),
        }
      }
      await expect(
        current.getByText('Invalid DID or handle', {exact: false}),
      ).toHaveCount(0)
      await expect(current.getByTestId('customFeedScreenError')).toHaveCount(0)
    }
    await verifyTrendPage(trendPage)
    assert.equal(new URL(trendPage.url()).pathname, trendPath)
    await trendPage.reload()
    await verifyTrendPage(trendPage)
    const pasted = await desktop.newPage()
    await pasted.goto(origin + trendPath + '?feedCacheKey=fixture%2Bcache')
    await verifyTrendPage(pasted)
    assert.equal(
      new URL(pasted.url()).searchParams.get('feedCacheKey'),
      'fixture+cache',
    )
    const ctrlOpened = desktop.waitForEvent('page')
    await trendLink.click({modifiers: ['Control']})
    const ctrlPage = await ctrlOpened
    await verifyTrendPage(ctrlPage)
    assert.deepEqual(
      await page.evaluate(() => ({
        y: scrollY,
        places: Object.fromEntries(
          Object.entries(localStorage).filter(([key]) =>
            /^skyanchor:(following|return|revision)/.test(key),
          ),
        ),
      })),
      followingBeforeTrend,
      'New tabs cannot mutate original Following viewport/local state',
    )
    assert.deepEqual(
      await cloudPlace(),
      cloudBeforeTrend,
      'Public CustomFeed new tabs cannot mutate Following cloud row/revision',
    )
    await Promise.all([trendPage.close(), pasted.close(), ctrlPage.close()])
    await trendLink.click()
    await verifyTrendPage(page)
    await page.goBack()
    await page.getByTestId('skyanchor-reading-button').waitFor()
    await page.waitForTimeout(1000)
    assert.deepEqual(await cloudPlace(), cloudBeforeTrend)
    await page.goForward()
    await verifyTrendPage(page)
    await page.goBack()
    await page.getByTestId('skyanchor-reading-button').waitFor()
    await page.waitForTimeout(1000)
    assert.deepEqual(await cloudPlace(), cloudBeforeTrend)
    const generatorCalls = upstreamCalls.filter(
      call =>
        call.nsid === 'app.bsky.feed.getFeedGenerator' &&
        call.feed ===
          'at://did:plc:qrz3lhbyuxbeilrc6nekdqme/app.bsky.feed.generator/9889d7c6d1f9',
    )
    assert.ok(
      generatorCalls.length >= 3,
      'Cold CustomFeed calls must contain the decoded actor and rkey',
    )
    report.checks.push(
      'Actual Sidebar Trending encoded CustomFeed middle/Control-click opens real new tabs; cold paste/reload/left-click/back loads decoded public feed, preserving original Following local/cloud revision and viewport.',
    )
    await verifyProfileReading({
      page,
      phonePage,
      origin,
      worker,
      did: didA,
      authors: [didSharon, didAnother],
      report,
      setConnectivity,
      phoneService: regionalPds,
    })
    await legacyReturnFixture(page, didA)
    const longLived = await page.evaluate(
      did =>
        JSON.parse(localStorage.getItem('skyanchor:return:v1:' + did)).snapshot
          .place,
      didA,
    )
    moderated.add(longLived.anchor.split('|')[0])
    report.longReturnModeration = {
      uri: longLived.anchor.split('|')[0],
      label: '!hide',
      labeler: api.moderation.did,
    }
    const callsBeforeReturn = upstreamCalls.filter(
      call => call.nsid === 'app.bsky.feed.getPosts',
    ).length
    await readingAction(page, 'Return to my place')
    await readingPanel(page)
    await expect(page.getByTestId('skyanchor-fallback')).toContainText(
      /missing|moderated/,
    )
    assert.ok(
      upstreamCalls.filter(call => call.nsid === 'app.bsky.feed.getPosts')
        .length > callsBeforeReturn,
      'Return refetches current moderation/content rather than using stale cache',
    )
    assert.equal(
      await page
        .locator('[data-skyanchor-key]')
        .evaluateAll(
          (nodes, key) =>
            nodes.filter(node => node.dataset.skyanchorKey === key).length,
          longLived.anchor,
        ),
      0,
    )
    const hiddenSubject = entries
      .map(item => item.post)
      .find(post => post.uri === longLived.anchor.split('|')[0])
    assert.ok(hiddenSubject, 'The moderated occurrence has a real fixture post')
    await expect(
      page.getByText(hiddenSubject.record.text, {exact: true}),
    ).not.toBeVisible()
    report.checks.push(
      'Long-lived Return revalidates current !hide moderation and visibly falls back; stale cached post is not displayed',
    )
    await closeReadingPanel(page)
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
        ),
    )
    await page.evaluate(() =>
      window.dispatchEvent(new Event('skyanchor-save-now')),
    )
    await expect
      .poll(() =>
        page.evaluate(
          did =>
            JSON.parse(localStorage.getItem('skyanchor:following:v1:' + did))
              .place.anchor,
          didA,
        ),
      )
      .not.toBe(longLived.anchor)
    const coldAnchor = await page.evaluate(
      did =>
        JSON.parse(localStorage.getItem('skyanchor:following:v1:' + did)).place
          .anchor,
      didA,
    )
    deleted.add(coldAnchor.split('|')[0])
    report.coldReturnDeletion = {uri: coldAnchor.split('|')[0]}
    await page.reload()
    await readingPanel(page)
    await expect(page.getByTestId('skyanchor-fallback')).toContainText(
      /missing|moderated/,
    )
    report.checks.push('Deleted saved anchor yields visible neighbor fallback')
    await page.goto(origin + '/settings')
    await page
      .getByRole('button', {name: 'Sign out', exact: true})
      .first()
      .click()
    await page.getByText('Sign out?', {exact: true}).waitFor()
    await page
      .getByRole('button', {name: 'Sign out', exact: true})
      .last()
      .click()
    await expect(
      page.locator('[data-testid="noSessionView"]:visible').first(),
    ).toBeVisible()
    await expect(page.getByTestId('skyanchor-toolbar')).toHaveCount(0)
    assert.equal(
      await page.evaluate(
        did => localStorage.getItem('skyanchor:following:v1:' + did),
        didA,
      ),
      null,
      'Actual UI signout clears DID reading history',
    )
    assert.equal(
      await page.evaluate(
        did =>
          Object.keys(localStorage).some(key =>
            [
              'skyanchor:following:v1:',
              'skyanchor:return:v1:',
              'skyanchor:revision:',
            ].some(prefix => key.startsWith(prefix + did + ':author|')),
          ),
        didA,
      ),
      false,
      'Signout clears every author/filter local snapshot, Return checkpoint and revision for the signed-out owner',
    )
    await expect
      .poll(
        async () =>
          (
            await worker.db
              .prepare('SELECT COUNT(*) AS count FROM sessions')
              .first()
          ).count,
      )
      .toBe(1)
    report.checks.push(
      'Actual Settings signout clears local account history and revokes only the owning private session',
    )
    await signIn(page, 'other@example.test')
    await readingAction(page, 'Connect private sync')
    await expect(
      page.getByRole('button', {name: 'Save my place', exact: true}),
    ).toBeVisible()
    await expect(page.getByTestId('skyanchor-conflict')).toHaveCount(0)
    assert.equal(
      await worker.db
        .prepare('SELECT state FROM places WHERE did = ?')
        .bind(didB)
        .first(),
      null,
      'A new authenticated account cannot read another DID cloud place',
    )
    await readingAction(page, 'Save my place')
    await expect(
      page.getByText('Private reading place saved.', {exact: true}),
    ).toBeVisible()
    assert.ok(
      await worker.db
        .prepare('SELECT state FROM places WHERE did = ?')
        .bind(didB)
        .first(),
      'Browser save is bound to the independently verified second account',
    )
    assert.equal(
      await page.evaluate(
        did => localStorage.getItem('skyanchor:following:v1:' + did),
        didA,
      ),
      null,
      'Switching to a second account does not resurrect signed-out account cache',
    )
    report.checks.push(
      'Second actual Home login and browser cloud save are isolated by verified DID',
    )
    const localBeforeDelete = await page.evaluate(
      did => localStorage.getItem('skyanchor:following:v1:' + did),
      didB,
    )
    await readingAction(page, 'Delete cloud progress and disconnect')
    await expect(
      page.getByText(
        'Cloud progress deleted and sync disconnected. Your local reading place is unchanged.',
        {exact: true},
      ),
    ).toBeVisible()
    const tombstone = await worker.db
      .prepare('SELECT revision, state FROM places WHERE did = ?')
      .bind(didB)
      .first()
    assert.ok(tombstone.revision > 0)
    assert.equal(tombstone.state, null)
    assert.equal(
      await page.evaluate(
        did => localStorage.getItem('skyanchor:following:v1:' + did),
        didB,
      ),
      localBeforeDelete,
    )
    await expect(
      page.getByRole('button', {name: 'Connect private sync', exact: true}),
    ).toBeVisible()
    assert.equal(
      await page.evaluate(
        did => localStorage.getItem('skyanchor:sync-enabled:' + did),
        didB,
      ),
      null,
    )
    report.checks.push(
      'Actual cloud deletion disconnects only this device, leaves a revision tombstone and preserves local reading progress',
    )
    await closeReadingPanel(page)
    await closeReadingPanel(phonePage)
  }
  await verifySyncRecovery({
    phoneBrowser,
    mockUpstream,
    signIn,
    worker,
    report,
  })
  await verifyDeviceCheckpoints({
    desktopBrowser,
    phoneBrowser,
    mockUpstream,
    signIn,
    worker,
    report,
    holdApi,
    entries,
  })
  await verifyAutomaticSource({
    desktopBrowser,
    phoneBrowser,
    origin,
    mockUpstream,
    signIn,
    worker,
    report,
    holdApi,
  })
  await verifyHandoff({
    desktopBrowser,
    phoneBrowser,
    origin,
    mockUpstream,
    signIn,
    worker,
    report,
    deleted,
    entries,
    post,
    holdApi,
  })
  await verifyReverseHandoff({
    desktopBrowser,
    phoneBrowser,
    mockUpstream,
    signIn,
    worker,
    report,
    holdApi,
  })
  await verifyScrollInput({phoneBrowser, mockUpstream, signIn, worker, report})
  await verifyNewContent({
    desktopBrowser,
    phoneBrowser,
    origin,
    mockUpstream,
    signIn,
    worker,
    report,
    entries,
    post,
    installViewportFixture,
  })
  await verifySettlement({
    phoneBrowser,
    mockUpstream,
    signIn,
    worker,
    report,
    entries,
  })
  await verifyThreadBack({
    desktopBrowser,
    phoneBrowser,
    mockUpstream,
    signIn,
    report,
    installViewportFixture,
    worker,
    entries,
  })
  report.composer = [
    await verifyComposer(page, false),
    await verifyComposer(phonePage, true),
  ]
  report.checks.push(
    'Production Tiptap 3 custom composer passes desktop/phone paste, emoji, multiline, undo/redo, mention/tag/link, composition and navigation checks without publishing; own-__proto__ DOMSerializer advisory payload cannot inherit executable attributes.',
  )
  assert.ok(
    anticipatedFailures.every(expected => expected.remaining === 0),
    'Every precisely scoped expiry/account-rejection response must actually occur',
  )
  assert.equal(
    errors.length,
    0,
    'No production runtime errors or unexpected HTTP failures',
  )
  assert.equal(
    unexpected.length,
    0,
    'All fixture upstream requests are explicitly mocked',
  )
  freshPhoneContext = await phoneBrowser.newContext({
    ...devices['iPhone 13'],
    ignoreHTTPSErrors: true,
  })
  await mockUpstream(freshPhoneContext)
  const freshPhonePage = await freshPhoneContext.newPage()
  freshPhonePage.on('pageerror', error => errors.push(error.message))
  await freshPhonePage.goto(origin + '/?splash=true')
  await freshPhonePage.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect(
    freshPhonePage.getByRole('button', {
      name: 'Update SkyAnchor safely',
      exact: true,
    }),
  ).toHaveCount(0)
  await freshPhonePage
    .getByRole('button', {name: 'Sign in', exact: true})
    .click()
  await expect(freshPhonePage.locator('input')).not.toHaveCount(0)
  await freshPhoneContext.close()
  freshPhoneContext = undefined
  pwaContext = await desktopBrowser.newContext()
  await mockUpstream(pwaContext)
  const pwaPage = await pwaContext.newPage()
  pwaPage.on('pageerror', error => errors.push(error.message))
  const supportResponse = await pwaPage.goto(origin + '/skyanchor.html')
  assert.equal(supportResponse.status(), 200)
  await expect(
    pwaPage.getByRole('heading', {name: 'Privacy and retention', exact: true}),
  ).toBeVisible()
  await expect(
    pwaPage.getByRole('link', {name: 'SkyAnchor public issues', exact: true}),
  ).toHaveAttribute(
    'href',
    'https://github.com/MichaelEns/skyanchor-public/issues',
  )
  await expect(
    pwaPage.getByRole('link', {
      name: 'Bluesky provider privacy policy',
      exact: true,
    }),
  ).toHaveAttribute('href', 'https://bsky.social/about/support/privacy-policy')
  await pwaPage.goto(origin + '/?splash=true')
  await expect(
    pwaPage.locator('[data-testid="noSessionView"]:visible').first(),
  ).toBeVisible()
  const pwaResult = await pwaPage.evaluate(async () => {
    const manifest = await (await fetch('/manifest.webmanifest')).json()
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration)
      throw new Error('Logged-out app root did not register its service worker')
    await navigator.serviceWorker.ready
    const denied = await fetch('/api/skyanchor/place')
    const result = {
      name: manifest.name,
      icons: manifest.icons.map(icon => icon.sizes),
      privateStatus: denied.status,
      noStore: denied.headers.get('cache-control'),
      caches: await caches.keys(),
    }
    return result
  })
  assert.equal(pwaResult.name, 'SkyAnchor')
  assert.deepEqual(pwaResult.icons.sort(), ['192x192', '512x512'])
  assert.equal(pwaResult.privateStatus, 401)
  assert.equal(pwaResult.noStore, 'no-store')
  assert.deepEqual(pwaResult.caches, [])
  await expect
    .poll(() => pwaPage.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true)
  await expect(
    pwaPage.getByRole('button', {name: 'Update SkyAnchor safely', exact: true}),
  ).toHaveCount(0)
  await pwaPage.getByRole('button', {name: 'Sign in', exact: true}).click()
  await expect(pwaPage.locator('input')).not.toHaveCount(0)
  await pwaPage.goto(origin + '/?splash=true')
  serviceWorkerRevision = 1
  await pwaPage.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration) throw new Error('PWA registration disappeared')
    await registration.update()
  })
  await expect(
    pwaPage.getByRole('button', {name: 'Update SkyAnchor safely', exact: true}),
  ).toBeVisible()
  await expect
    .poll(() =>
      pwaPage.evaluate(
        async () =>
          !!(await navigator.serviceWorker.getRegistration('/'))?.waiting,
      ),
    )
    .toBe(true)
  await pwaPage.getByRole('button', {name: 'Not now', exact: true}).click()
  await expect(
    pwaPage.getByRole('button', {name: 'Update SkyAnchor safely', exact: true}),
  ).toHaveCount(0)
  await pwaPage.reload()
  await expect(
    pwaPage.getByRole('button', {name: 'Update SkyAnchor safely', exact: true}),
  ).toBeVisible()
  await pwaPage.evaluate(() => {
    window.addEventListener(
      'skyanchor-save-now',
      event => {
        event.detail.failed = true
      },
      {once: true},
    )
  })
  await pwaPage
    .getByRole('button', {name: 'Update SkyAnchor safely', exact: true})
    .click()
  await expect(
    pwaPage.getByText(
      'Could not save your reading place. Update was not applied.',
      {exact: true},
    ),
  ).toBeVisible()
  assert.equal(
    await pwaPage.evaluate(
      async () =>
        !!(await navigator.serviceWorker.getRegistration('/'))?.waiting,
    ),
    true,
    'Update must remain waiting when capture reports failure',
  )
  await Promise.all([
    pwaPage.waitForEvent('load'),
    pwaPage
      .getByRole('button', {name: 'Update SkyAnchor safely', exact: true})
      .click(),
  ])
  await expect(
    pwaPage.locator('[data-testid="noSessionView"]:visible').first(),
  ).toBeVisible()
  await expect
    .poll(() =>
      pwaPage.evaluate(
        async () =>
          !!(await navigator.serviceWorker.getRegistration('/'))?.waiting,
      ),
    )
    .toBe(false)
  await pwaPage.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration) throw new Error('Updated PWA registration disappeared')
    await registration.unregister()
  })
  assert.equal(errors.length, 0, 'No PWA runtime errors')
  assert.equal(
    unexpected.length,
    0,
    'PWA fixture requests are explicitly mocked',
  )
  report.checks.push(
    'Logged-out Chromium app root registers PWA; manifest/icons, private API denied/no-store, zero caches, capture-failure refusal, waiting update prompt and explicit activation/reload passed. Exported SW carries the production input hash; the fixture appends a second revision to simulate a subsequent release without changing app inputs.',
  )
  report.fixtureTrust =
    'Chromium trusts only the ephemeral fixture key SPKI; no global certificate bypass, persisted key or system trust-store change. Does not prove production certificate installation.'
  report.passed = true
}
try {
  await runBrowserProof()
} catch (error) {
  report.passed = false
  report.failure = error.stack
  if (page && !page.isClosed()) {
    report.failureUI = await page.locator('body').innerText()
    await page.screenshot({path: 'proof-failure.png'})
  }
  throw error
} finally {
  for (const hold of apiHolds) hold.release()
  report.served = [...served]
  report.upstreamCalls = upstreamCalls
  report.networkEvents = networkEvents
  fs.writeFileSync(
    process.argv.includes('--handoff-only')
      ? 'proof-handoff-report.json'
      : 'proof-browser-report.json',
    JSON.stringify(report, null, 2) + '\n',
  )
  await Promise.all([
    desktop?.close(),
    phone?.close(),
    pwaContext?.close(),
    freshPhoneContext?.close(),
  ])
  await Promise.all([desktopBrowser?.close(), phoneBrowser?.close()])
  await worker.dispose()
  await new Promise(resolve => server.close(resolve))
  console.log(
    `Fixture servers and browser contexts closed by owning PID ${process.pid}`,
  )
}
