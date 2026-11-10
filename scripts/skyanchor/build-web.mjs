import {spawnSync} from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs'
import path from 'node:path'
import {buildInputs} from './inputs.mjs'
import {pnpmCommand, spawnPnpm} from './pnpm-cli.mjs'
import {createHash} from 'node:crypto'
import {runtimePackages} from './runtime-packages.mjs'
import {
  browserArtifactEvidence,
  dependencySourceEvidence,
  verifyNoAssetRedirects,
  verifySourceNotices,
} from './bundle-evidence.mjs'

const root = process.cwd()
const preparation = spawnPnpm(pnpmCommand(), ['skyanchor:prepare'], {
  stdio: 'inherit',
})
if (preparation.error) throw preparation.error
if (preparation.status !== 0)
  throw new Error('Web build-dependency preparation failed')
verifyNoAssetRedirects(path.join(root, 'public'))
verifySourceNotices(root)
const inputs = buildInputs()
const env = {
  ...process.env,
  EXPO_PUBLIC_ENV: 'production',
  EAS_BUILD_PLATFORM: 'web',
  EXPO_NO_TELEMETRY: '1',
  EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH: '1',
  EXPO_UNSTABLE_TREE_SHAKING: '1',
  EXPO_PUBLIC_BUNDLE_IDENTIFIER: spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).stdout.trim(),
}
for (const key of Object.keys(env)) {
  if (
    /SENTRY|BITDRIFT|GROWTHBOOK|METRICS|GCP_PROJECT|^EXPO_ATLAS$|^RN_SRC_EXT$|^BSKY_PROFILE$/.test(
      key,
    )
  )
    delete env[key]
}
const result = spawnSync(
  process.execPath,
  [
    '--max-old-space-size=4096',
    path.join(root, 'node_modules', 'expo', 'bin', 'cli'),
    'export',
    '--platform',
    'web',
    '--dump-sourcemap',
    '--max-workers',
    '1',
    ...(process.argv.includes('--clear') ? ['--clear'] : []),
  ],
  {env, stdio: 'inherit'},
)
if (result.status !== 0) process.exit(result.status ?? 1)
if (buildInputs().sha256 !== inputs.sha256)
  throw new Error(
    'Build inputs changed during export; rebuild without concurrent source edits',
  )
const dist = path.join(root, 'dist')
verifyNoAssetRedirects(dist)
const walk = directory =>
  readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(file) : [file]
  })
const maps = walk(dist).filter(file => file.endsWith('.map'))
if (!maps.length)
  throw new Error('Export did not provide runtime source evidence')
function mapSources(map) {
  if (Array.isArray(map.sections))
    return map.sections.flatMap(section => mapSources(section.map))
  if (!Array.isArray(map.sources))
    throw new Error('Invalid export source evidence')
  return map.sources
}
const mapRecords = maps.map(file => JSON.parse(readFileSync(file, 'utf8')))
const sources = mapRecords.flatMap(mapSources)
const dependencySources = dependencySourceEvidence(mapRecords)
const browserPackages = runtimePackages(sources)
for (const file of maps) unlinkSync(file)
const fonts = path.join(dist, 'assets', 'assets', 'fonts', 'inter')
let html = readFileSync(path.join(dist, 'index.html'), 'utf8')
for (const prefix of ['InterVariable', 'InterVariable-Italic']) {
  const file = readdirSync(fonts).find(
    name => name.startsWith(prefix + '.') && name.endsWith('.woff2'),
  )
  if (!file) throw new Error(`Missing exported ${prefix} font`)
  html = html.replaceAll(`${prefix}.woff2`, file)
}
writeFileSync(path.join(dist, 'index.html'), html)
const serviceWorker = path.join(dist, 'sw.js')
writeFileSync(
  serviceWorker,
  readFileSync(serviceWorker, 'utf8') +
    `\n/* SkyAnchor release ${inputs.sha256} */\n`,
)
const inlineHashes = [
  ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
]
  .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2])
  .map(
    match =>
      `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`,
  )
const csp = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${inlineHashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss: blob:",
  "media-src 'self' https: blob: data:",
  "worker-src 'self' blob:",
  'frame-src https:',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ')
writeFileSync(
  path.join(dist, '_headers'),
  `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=31536000
  Permissions-Policy: geolocation=(), payment=(), usb=()
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-store
/_expo/static/*
  Cache-Control: public, max-age=31536000, immutable
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
)
writeFileSync(
  path.join(dist, 'skyanchor-build.json'),
  JSON.stringify(
    {
      upstream: JSON.parse(
        readFileSync(
          path.join(root, 'scripts', 'skyanchor', 'upstream-provenance.json'),
          'utf8',
        ),
      ).upstream,
      head: env.EXPO_PUBLIC_BUNDLE_IDENTIFIER,
      inputs,
    },
    null,
    2,
  ) + '\n',
)
mkdirSync(path.join(dist, 'licenses'), {recursive: true})
for (const [source, target] of [
  ['LICENSE', 'LICENSE.txt'],
  ['NOTICE.md', 'NOTICE.md'],
  [path.join('licenses', 'APACHE-2.0.txt'), 'APACHE-2.0.txt'],
  [path.join('assets', 'fonts', 'inter', 'OFL.txt'), 'OFL.txt'],
  [path.join('assets', 'icons', 'flags', 'LICENSE'), 'flags-MIT.txt'],
  [path.join('node_modules', 'lucide-static', 'LICENSE'), 'lucide-ISC.txt'],
  [
    path.join('node_modules', '@react-navigation', 'elements', 'LICENSE'),
    'react-navigation-MIT.txt',
  ],
  [
    path.join('node_modules', '@tiptap', 'core', 'LICENSE.md'),
    'tiptap-MIT.txt',
  ],
  [path.join('node_modules', 'zod', 'LICENSE'), 'zod-MIT.txt'],
  [path.join('patches', 'zod-security.json'), 'zod-backport.json'],
])
  copyFileSync(path.join(root, source), path.join(dist, 'licenses', target))
const artifacts = browserArtifactEvidence()
writeFileSync(
  path.join(dist, 'skyanchor-runtime.json'),
  JSON.stringify(
    {
      inputs: inputs.sha256,
      browser: browserPackages,
      dependencySources,
      sourceMaps: maps.length,
      artifacts,
      bundles: artifacts.filter(file => file.file.endsWith('.js')),
    },
    null,
    2,
  ) + '\n',
)
await import('./scan.mjs')
writeFileSync(
  path.join(root, 'proof-browser-artifacts.json'),
  JSON.stringify(
    {
      inputs: inputs.sha256,
      artifacts: browserArtifactEvidence(root, true),
    },
    null,
    2,
  ) + '\n',
)
