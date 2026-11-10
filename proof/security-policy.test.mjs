import assert from 'node:assert/strict'
import {test} from 'node:test'
import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {generateTasks} from '../node_modules/lint-staged/lib/generateTasks.js'
import {buildInputs} from '../scripts/skyanchor/inputs.mjs'
import {
  assessBuildUsage,
  usagePolicy,
} from '../scripts/skyanchor/security-policy.mjs'

const known = usagePolicy.reviews.uuid.advisories[0]
const advisory = {
  id: known.supplierId,
  cwe: known.cwe,
  url: known.url,
  github_advisory_id: known.id,
  module_name: known.package,
  severity: known.severity,
  title: known.title,
  vulnerable_versions: known.vulnerable,
  patched_versions: known.patched,
  findings: known.versions.map(version => ({version})),
}
const inventory = {sha256: usagePolicy.reviews.uuid.inventorySha256}
const context = {
  lock: usagePolicy.lockSha256,
  boundary: usagePolicy.boundarySha256,
  bundled: false,
}

test('Normal staged Oxlint coverage equals declared app lint roots for relative and absolute paths', () => {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  assert.equal(
    fs.readFileSync('.husky/pre-commit', 'utf8').trim(),
    'pnpm exec lint-staged --concurrent false',
  )
  const declared = manifest.scripts.lint
    .split('&&')[0]
    .trim()
    .split(/\s+/)
    .slice(2)
  assert.deepEqual(declared, ['src', 'modules'])
  const patterns = Object.entries(manifest['lint-staged'])
    .filter(([, commands]) =>
      commands.some(command => command.startsWith('oxlint ')),
    )
    .map(([pattern]) => pattern)
  assert.deepEqual(patterns, ['{src,modules}/**/*.{js,jsx,ts,tsx}'])
  const paths = [
    'src/index.ts',
    'src/features/skyanchor/domain.ts',
    'src/state/session/index.tsx',
    'src/screens/Example.web.tsx',
    'modules/example/index.js',
    'modules/example/nested/view.jsx',
    'scripts/skyanchor/verify.mjs',
    'bskylink/src/index.ts',
    'dev-env/test-pds.ts',
    'plugins/example.js',
    '__mocks__/example.ts',
  ]
  const files = paths.map(file => ({
    filepath: path.resolve(...file.split('/')),
    status: 'A',
  }))
  const tasks = generateTasks({
    config: {[patterns[0]]: manifest['lint-staged'][patterns[0]]},
    cwd: process.cwd(),
    files,
  })
  assert.equal(tasks.length, 1)
  assert.deepEqual(
    tasks[0].fileList.map(file => file.filepath),
    files
      .filter((_, index) =>
        declared.some(root => paths[index].startsWith(root + '/')),
      )
      .map(file => file.filepath.replaceAll('\\', '/')),
  )
  assert.deepEqual(manifest['lint-staged']['*{.js,.jsx,.ts,.tsx,.css}'], [
    'prettier --cache --write --ignore-unknown',
  ])
  assert.deepEqual(
    manifest['lint-staged']['assets/icons/{ui,brands,community,custom}/*.svg'],
    ['svgo'],
  )
})

test('Fresh CI prepares real catalogs before verification and production input snapshots', () => {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  assert.equal(
    manifest.scripts['skyanchor:prepare'],
    'pnpm lexicons:generate && pnpm intl:compile-if-needed --ci',
  )
  for (const file of ['verify.mjs', 'build-web.mjs']) {
    const source = fs.readFileSync('scripts/skyanchor/' + file, 'utf8')
    const preparation = source.indexOf("['skyanchor:prepare']")
    const snapshot = source.indexOf(
      file === 'verify.mjs'
        ? 'inputs: buildInputs()'
        : 'const inputs = buildInputs()',
    )
    assert.ok(preparation >= 0 && snapshot > preparation)
    assert.match(source, /preparation\.status !== 0/)
  }
  assert.match(
    fs.readFileSync('scripts/skyanchor/catalogs.mjs', 'utf8'),
    /process\.argv\.includes\('--ci'\)/,
  )
})

test('Canonical LF checkout policy remains hash-bound without forcing binary text conversion', () => {
  const result = spawnSync(
    'git',
    [
      'check-attr',
      'text',
      'eol',
      '--',
      'scripts/skyanchor/pnpm-cli.mjs',
      'assets/app-icons/android_icon_core_aurora.png',
    ],
    {encoding: 'utf8'},
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.match(/: text: auto/g)?.length, 2)
  assert.equal(result.stdout.match(/: eol: lf/g)?.length, 2)
  assert.ok(usagePolicy.boundaryFiles.includes('.gitattributes'))
  assert.ok(
    buildInputs().sources.some(source => source.file === '.gitattributes'),
  )
})

test('Reviewed tool use cannot authorize a new or mutated advisory', () => {
  assert.match(assessBuildUsage(advisory, inventory, context), /^Reviewed/)
  for (const mutation of [
    {id: 1},
    {cwe: 'CWE-unknown'},
    {url: 'https://example.test/different-advisory'},
    {patched_versions_unpublished: true},
    {github_advisory_id: 'GHSA-new-advisory'},
    {severity: 'critical'},
    {title: 'Different exploit'},
    {vulnerable_versions: '<99'},
    {patched_versions: '>=99'},
    {findings: [{version: '8.3.3'}]},
    {module_name: 'unreviewed-dependency'},
  ]) {
    assert.match(
      assessBuildUsage({...advisory, ...mutation}, inventory, context),
      /^UNRESOLVED/,
    )
  }
})

test('Runtime exposure and consumer, lock or release-boundary drift fail closed', () => {
  for (const mutation of [
    {bundled: true},
    {lock: 'different-lock'},
    {boundary: 'new-public-input'},
  ]) {
    assert.match(
      assessBuildUsage(advisory, inventory, {...context, ...mutation}),
      /^UNRESOLVED/,
    )
  }
  assert.match(
    assessBuildUsage(advisory, {sha256: 'new-consumer'}, context),
    /^UNRESOLVED/,
  )
})
