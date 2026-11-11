import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {
  dependencySourceEvidence,
  verifyDependencySources,
  browserArtifactEvidence,
  verifyBrowserArtifacts,
  verifyNoAssetRedirects,
  verifyFreeWorkerConfig,
  verifySourceNotices,
} from '../scripts/skyanchor/bundle-evidence.mjs'
import {
  verifyRequiredZodRuntime,
  verifyZodFindingPaths,
  isReviewedZodAdvisory,
} from '../scripts/skyanchor/zod-runtime-evidence.mjs'
import {patchMetadata} from '../scripts/skyanchor/zod-fixture.mjs'
import {
  pnpmInvocation,
  selectPnpmCandidate,
  spawnPnpm,
} from '../scripts/skyanchor/pnpm-cli.mjs'
import {createRequire} from 'node:module'
import ts from 'typescript'
import {spawnSync} from 'node:child_process'
import {verify, X509Certificate} from 'node:crypto'
import {parse, parseAllDocuments, stringify} from 'yaml'

test('Expo certificate consumer round-trips generated keys, X.509 and CSR with the installed forge', () => {
  const require = createRequire(import.meta.url)
  const certificates = require('@expo/code-signing-certificates')
  const keyPair = certificates.convertKeyPairPEMToKeyPair(
    certificates.convertKeyPairToPEM(certificates.generateKeyPair()),
  )
  const now = Date.now()
  const certificate = certificates.convertCertificatePEMToCertificate(
    certificates.convertCertificateToCertificatePEM(
      certificates.generateSelfSignedCodeSigningCertificate({
        keyPair,
        validityNotBefore: new Date(now - 60_000),
        validityNotAfter: new Date(now + 3_600_000),
        commonName: 'fixture.example.test',
      }),
    ),
  )
  certificates.validateSelfSignedCertificate(certificate, keyPair)
  const pem = certificates.convertCertificateToCertificatePEM(certificate)
  const parsed = new X509Certificate(pem)
  assert.ok(parsed.verify(parsed.publicKey))
  const message = Buffer.from('Synthetic local certificate compatibility')
  const signature = certificates.signBufferRSASHA256AndVerify(
    keyPair.privateKey,
    certificate,
    message,
  )
  assert.ok(
    verify(
      'sha256',
      message,
      parsed.publicKey,
      Buffer.from(signature, 'base64'),
    ),
  )
  assert.equal(
    verify(
      'sha256',
      Buffer.from('Changed synthetic message'),
      parsed.publicKey,
      Buffer.from(signature, 'base64'),
    ),
    false,
  )
  const csr = certificates.convertCSRPEMToCSR(
    certificates.convertCSRToCSRPEM(
      certificates.generateCSR(keyPair, 'fixture.example.test'),
    ),
  )
  assert.ok(csr.verify())
  assert.equal(csr.subject.getField('CN').value, 'fixture.example.test')
})

test('Only the Expo export child receives bounded 4 GiB heap and one Metro worker without dropping source evidence', () => {
  const source = fs.readFileSync(
    path.join('scripts', 'skyanchor', 'build-web.mjs'),
    'utf8',
  )
  const tree = ts.createSourceFile(
    'build-web.mjs',
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  const calls = []
  const visit = node => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === 'spawnSync'
    )
      calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  const exports = calls.filter(
    call => call.arguments[0]?.getText(tree) === 'process.execPath',
  )
  assert.equal(exports.length, 1)
  const args = exports[0].arguments[1]
  assert.ok(ts.isArrayLiteralExpression(args))
  const literals = args.elements
    .filter(ts.isStringLiteral)
    .map(element => element.text)
  assert.equal(args.elements[0].getText(tree), "'--max-old-space-size=4096'")
  assert.equal(
    args.elements[1].getText(tree),
    "path.join(root, 'node_modules', 'expo', 'bin', 'cli')",
  )
  assert.deepEqual(literals, [
    '--max-old-space-size=4096',
    'export',
    '--platform',
    'web',
    '--dump-sourcemap',
    '--max-workers',
    '1',
  ])
  assert.match(
    args.elements.at(-1).getText(tree),
    /process\.argv\.includes\('--clear'\)/,
  )
  assert.match(source, /const env = \{\s*\.\.\.process\.env,/)
  assert.doesNotMatch(source, /NODE_OPTIONS\s*[:=]/)
  assert.match(source, /EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH: '1'/)
  assert.match(source, /EXPO_UNSTABLE_TREE_SHAKING: '1'/)
})

test('Both hosted workflows resolve multiple runner pnpm paths to one version-checked CMD/Node CLI', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'skyanchor-multiple-pnpm-'),
  )
  try {
    const cli = path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    fs.mkdirSync(path.dirname(cli), {recursive: true})
    fs.writeFileSync(cli, "console.log('11.28.5')\n")
    fs.writeFileSync(
      path.join(root, 'node_modules', 'pnpm', 'package.json'),
      JSON.stringify({
        name: 'pnpm',
        version: '11.28.5',
        bin: {pnpm: 'bin/pnpm.cjs'},
        exports: {'.': './package.json'},
      }),
    )
    const shim = path.join(root, 'node_modules', '.bin', 'pnpm.cmd')
    fs.mkdirSync(path.dirname(shim), {recursive: true})
    const extensionless = path.join(root, 'pnpm')
    fs.copyFileSync(
      path.join('proof', 'fixtures', 'pnpm-npm-generated.cmd'),
      shim,
    )
    fs.writeFileSync(extensionless, '')
    const candidates = [
      extensionless,
      path.join(root, 'missing', 'pnpm.exe'),
      shim,
      cli,
      shim,
    ]
    const selected = process.platform === 'win32' ? shim : cli
    assert.equal(selectPnpmCandidate(candidates, root), selected)
    assert.throws(() => selectPnpmCandidate([]), /No supported/)
    assert.throws(
      () => selectPnpmCandidate([candidates.join(' ')]),
      /No supported/,
    )
    assert.throws(() => selectPnpmCandidate('not an array'), /array/)
    const untrusted = path.join(root, 'untrusted', 'pnpm.mjs')
    fs.mkdirSync(path.dirname(untrusted), {recursive: true})
    fs.writeFileSync(
      untrusted,
      "throw new Error('Untrusted launcher executed')\n",
    )
    assert.throws(
      () => selectPnpmCandidate([untrusted], path.dirname(shim)),
      /No supported/,
    )
    const workflows = ['skyanchor-candidate.yml', 'skyanchor-upstream.yml'].map(
      name =>
        parse(fs.readFileSync(path.join('.github', 'workflows', name), 'utf8')),
    )
    const snippets = workflows.map(
      workflow =>
        Object.values(workflow.jobs)
          .flatMap(job => job.steps)
          .find(step => step.name === 'Resolve installed pnpm executable').run,
    )
    for (const workflow of workflows) {
      const setup = Object.values(workflow.jobs)
        .flatMap(job => job.steps)
        .find(step => step.uses?.startsWith('pnpm/action-setup@'))
      assert.equal(setup.with.standalone, false)
      assert.equal(setup.with.version, '11.28.5')
    }
    assert.equal(snippets[0], snippets[1])
    assert.match(snippets[0], /binary\.Count -ne 1/)
    if (process.platform === 'win32') {
      const output = path.join(root, 'github-env')
      const script = `
        function Get-Command { $env:TEST_PNPM_CANDIDATES | ConvertFrom-Json | ForEach-Object { [pscustomobject]@{Source=$_} } }
        ${snippets[0]}
      `
      const result = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH:
              path.dirname(process.execPath) +
              path.delimiter +
              process.env.PATH,
            TEST_PNPM_CANDIDATES: JSON.stringify(candidates),
            PNPM_HOME: root,
            GITHUB_ENV: output,
          },
        },
      )
      assert.equal(result.status, 0, result.stderr)
      assert.equal(
        fs.readFileSync(output, 'utf8').trim(),
        'SKYANCHOR_PNPM_BINARY=' + selected,
      )
    }
    fs.writeFileSync(cli, "console.log('11.28.4')\n")
    assert.throws(
      () => selectPnpmCandidate(candidates, root),
      /exactly 11.28.5/,
    )
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})

test('Real npm CMD shims launch active pnpm despite stale bootstrap metadata in both hosted snippets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor pnpm fixture-'))
  const source = path.resolve('proof', 'tooling', 'package')
  const installed = fs.existsSync(path.join(source, 'package.json'))
    ? source
    : path.dirname(path.dirname(process.env.npm_execpath))
  const manifest = JSON.parse(
    fs.readFileSync(path.join(installed, 'package.json'), 'utf8'),
  )
  const originalEntry = path.join(installed, ...manifest.bin.pnpm.split('/'))
  const originalBytes = fs.readFileSync(originalEntry)
  const assertOwned = file => {
    const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file))
    assert.ok(
      relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      `Fixture copy must be physically contained before mutation: ${file}`,
    )
    assert.notEqual(fs.realpathSync(file), fs.realpathSync(originalEntry))
  }
  try {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'pnpm-launch-fixture', private: true}),
    )
    assert.equal(manifest.name, 'pnpm')
    assert.equal(manifest.version, '11.28.5')
    assert.equal(manifest.bin.pnpm, 'bin/pnpm.mjs')
    const home = path.join(root, 'node_modules', '.bin')
    const packageRoot = path.join(home, 'pnpm')
    const linkedSource = path.join(root, 'linked-installed-pnpm')
    fs.symlinkSync(
      installed,
      linkedSource,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    fs.cpSync(linkedSource, packageRoot, {recursive: true, dereference: true})
    assertOwned(packageRoot)
    assert.notEqual(fs.realpathSync(packageRoot), fs.realpathSync(installed))
    const bootstrap = path.join(root, 'node_modules', 'pnpm')
    fs.mkdirSync(bootstrap, {recursive: true})
    fs.writeFileSync(
      path.join(bootstrap, 'package.json'),
      JSON.stringify({
        name: 'pnpm',
        version: '11.25.0',
        exports: {'.': './package.json'},
      }),
    )
    const bin = path.join(home, 'bin')
    fs.mkdirSync(bin, {recursive: true})
    const shim = path.join(bin, 'pnpm.cmd')
    fs.copyFileSync(
      path.join('proof', 'fixtures', 'pnpm-npm-generated.cmd'),
      shim,
    )
    const entry = path.join(packageRoot, ...manifest.bin.pnpm.split('/'))
    assertOwned(entry)
    assert.deepEqual(fs.readFileSync(entry), originalBytes)
    assert.deepEqual(pnpmInvocation(shim), {
      command: shim,
      args: [],
    })
    assert.equal(
      selectPnpmCandidate(
        [path.join(bin, 'missing', 'pnpm.exe'), entry, shim],
        home,
      ),
      process.platform === 'win32' ? shim : entry,
    )
    const result = spawnSync(process.execPath, [entry, '--version'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), '11.28.5')
    if (process.platform === 'win32') {
      const helper = path.join(root, 'scripts', 'skyanchor', 'pnpm-cli.mjs')
      fs.mkdirSync(path.dirname(helper), {recursive: true})
      fs.copyFileSync(path.join('scripts', 'skyanchor', 'pnpm-cli.mjs'), helper)
      const require = createRequire(import.meta.url)
      const crossSpawn = require.resolve('cross-spawn')
      const crossRequire = createRequire(crossSpawn)
      const which = crossRequire.resolve('which')
      for (const [name, resolved] of [
        ['cross-spawn', crossSpawn],
        ['path-key', crossRequire.resolve('path-key')],
        ['which', which],
        ['isexe', createRequire(which).resolve('isexe')],
        ['shebang-command', crossRequire.resolve('shebang-command')],
        [
          'shebang-regex',
          createRequire(crossRequire.resolve('shebang-command')).resolve(
            'shebang-regex',
          ),
        ],
      ]) {
        const manifestPath = createRequire(resolved).resolve(
          name + '/package.json',
        )
        fs.cpSync(
          path.dirname(manifestPath),
          path.join(root, 'node_modules', name),
          {recursive: true, dereference: true},
        )
        assertOwned(path.join(root, 'node_modules', name))
      }
      const args = [
        'exec',
        'node',
        '-e',
        'console.log(JSON.stringify(process.argv.slice(1)))',
        'space value',
        'a&b',
        'x|y',
        'a^b',
        '(parentheses)',
        '"quoted"',
        '%PATH%',
        '',
      ]
      const escaped = spawnPnpm(pnpmInvocation(shim), args, {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH:
            path.dirname(process.execPath) + path.delimiter + process.env.PATH,
        },
      })
      assert.equal(escaped.status, 0, escaped.stderr || escaped.stdout)
      assert.deepEqual(JSON.parse(escaped.stdout.trim()), args.slice(4))
      const ordinaryBin = path.join(root, 'standard', 'node_modules', '.bin')
      fs.mkdirSync(ordinaryBin, {recursive: true})
      fs.cpSync(installed, path.join(path.dirname(ordinaryBin), 'pnpm'), {
        recursive: true,
        dereference: true,
      })
      assertOwned(path.join(path.dirname(ordinaryBin), 'pnpm'))
      assertOwned(
        path.join(
          path.dirname(ordinaryBin),
          'pnpm',
          ...manifest.bin.pnpm.split('/'),
        ),
      )
      const ordinaryShim = path.join(ordinaryBin, 'pnpm.cmd')
      fs.copyFileSync(
        path.join('proof', 'fixtures', 'pnpm-npm-generated.cmd'),
        ordinaryShim,
      )
      const ordinary = spawnPnpm(pnpmInvocation(ordinaryShim), args, {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH:
            path.dirname(process.execPath) + path.delimiter + process.env.PATH,
        },
      })
      assert.equal(ordinary.status, 0, ordinary.stderr || ordinary.stdout)
      assert.deepEqual(JSON.parse(ordinary.stdout.trim()), args.slice(4))
      for (const name of [
        'skyanchor-candidate.yml',
        'skyanchor-upstream.yml',
      ]) {
        const workflow = parse(
          fs.readFileSync(path.join('.github', 'workflows', name), 'utf8'),
        )
        const snippet = Object.values(workflow.jobs)
          .flatMap(job => job.steps)
          .find(step => step.name === 'Resolve installed pnpm executable').run
        const output = path.join(root, name + '.env')
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) =>
              !['path', 'npm_execpath', 'skyanchor_pnpm_binary'].includes(
                key.toLowerCase(),
              ),
          ),
        )
        const execution = spawnSync(
          'pwsh',
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(
              `if ((& (Join-Path $env:PNPM_HOME 'pnpm.cmd') --version).Trim() -ne '11.28.5') { throw 'Real npm shim execution failed' }\n${snippet}`,
              'utf16le',
            ).toString('base64'),
          ],
          {
            cwd: root,
            encoding: 'utf8',
            env: {
              ...env,
              PATH:
                bin +
                path.delimiter +
                path.dirname(process.execPath) +
                path.delimiter +
                process.env.PATH,
              PNPM_HOME: bin,
              npm_execpath: 'C:\\unrelated\\npm-cli.js',
              GITHUB_ENV: output,
            },
          },
        )
        assert.equal(execution.status, 0, execution.stderr)
        assert.equal(
          fs.readFileSync(output, 'utf8').trim(),
          'SKYANCHOR_PNPM_BINARY=' + shim,
        )
      }
    }
    assertOwned(entry)
    fs.writeFileSync(entry, "console.log('11.28.4')\n")
    assert.throws(
      () =>
        selectPnpmCandidate(
          [process.platform === 'win32' ? shim : entry],
          home,
        ),
      /exactly 11.28.5/,
    )
    assert.deepEqual(fs.readFileSync(originalEntry), originalBytes)
  } finally {
    fs.rmSync(root, {recursive: true})
    assert.deepEqual(
      fs.readFileSync(originalEntry),
      originalBytes,
      'Original installed CLI bytes must survive fixture mutation and cleanup',
    )
  }
})

test('Dereferenced fixture copies isolate linked bin directories and linked entries before writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor-linked-cli-'))
  try {
    const source = path.join(root, 'supplier')
    const linked = path.join(root, 'linked-package')
    const copy = path.join(root, 'copy')
    fs.mkdirSync(path.join(source, 'bin'), {recursive: true})
    fs.mkdirSync(linked)
    const original = path.join(source, 'bin', 'pnpm.mjs')
    const bytes = Buffer.from("console.log('11.28.5')\n")
    fs.writeFileSync(original, bytes)
    fs.symlinkSync(
      path.join(source, 'bin'),
      path.join(linked, 'bin'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    // POSIX also exercises a direct file link; Windows uses an unprivileged junction.
    if (process.platform !== 'win32') {
      fs.renameSync(original, path.join(source, 'bin', 'actual.mjs'))
      fs.symlinkSync(path.join(source, 'bin', 'actual.mjs'), original, 'file')
    }
    fs.cpSync(linked, copy, {recursive: true, dereference: true})
    const entry = path.join(copy, 'bin', 'pnpm.mjs')
    const relative = path.relative(
      fs.realpathSync(copy),
      fs.realpathSync(entry),
    )
    assert.ok(
      relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    )
    assert.notEqual(fs.realpathSync(entry), fs.realpathSync(original))
    assert.deepEqual(fs.readFileSync(entry), bytes)
    fs.writeFileSync(entry, "console.log('11.28.4')\n")
    assert.deepEqual(fs.readFileSync(original), bytes)
    fs.rmSync(copy, {recursive: true})
    assert.deepEqual(fs.readFileSync(original), bytes)
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})

test('Every retained Dependabot schedule has an explicit seven-day cooldown and monitoring remains scheduled', () => {
  const config = parse(
    fs.readFileSync(path.join('.github', 'dependabot.yml'), 'utf8'),
  )
  assert.deepEqual(
    config.updates.map(update => update['package-ecosystem']),
    ['npm', 'github-actions'],
  )
  for (const update of config.updates)
    assert.ok(update.cooldown['default-days'] >= 7)
  assert.equal(config.updates[0]['open-pull-requests-limit'], 0)
  const workflow = parse(
    fs.readFileSync(
      path.join('.github', 'workflows', 'skyanchor-candidate.yml'),
      'utf8',
    ),
  )
  assert.ok(workflow.on.schedule.length)
  assert.ok(
    workflow.jobs.verify.steps.some(
      step => step.run === 'pnpm skyanchor:verify',
    ),
  )
})

test('Free deployment rejects explicit CPU limits and paid/unreviewed settings while retaining SPA/API routing', () => {
  const parsed = ts.parseConfigFileTextToJson(
    'wrangler.jsonc',
    fs.readFileSync(path.join('worker', 'wrangler.jsonc'), 'utf8'),
  )
  assert.equal(parsed.error, undefined)
  verifyFreeWorkerConfig(parsed.config)
  for (const extra of [
    {limits: {cpu_ms: 10}},
    {containers: [{class_name: 'PaidContainer'}]},
    {dispatch_namespaces: [{binding: 'PAID'}]},
    {assets: {...parsed.config.assets, run_worker_first: []}},
  ])
    assert.throws(
      () => verifyFreeWorkerConfig({...parsed.config, ...extra}),
      /Free Worker configuration/,
    )
})

test('Pinned pnpm paths reject missing, unsupported and ambient launchers without guessing CMD targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor-pnpm-'))
  try {
    const binary = path.join(root, 'pnpm.exe')
    fs.writeFileSync(binary, '')
    assert.deepEqual(pnpmInvocation(binary), {command: binary, args: []})
    const shim = path.join(root, 'pnpm.cmd')
    fs.writeFileSync(shim, '')
    assert.deepEqual(pnpmInvocation(shim), {command: shim, args: []})
    fs.unlinkSync(binary)
    assert.deepEqual(pnpmInvocation(shim), {command: shim, args: []})
    const cli = path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    fs.mkdirSync(path.dirname(cli), {recursive: true})
    fs.writeFileSync(cli, '')
    fs.writeFileSync(
      path.join(root, 'node_modules', 'pnpm', 'package.json'),
      JSON.stringify({
        name: 'pnpm',
        version: '11.28.5',
        bin: {pnpm: 'bin/pnpm.cjs'},
        exports: {'.': './package.json'},
      }),
    )
    assert.deepEqual(pnpmInvocation(shim), {
      command: shim,
      args: [],
    })
    assert.deepEqual(pnpmInvocation(cli), {
      command: process.execPath,
      args: [cli],
    })
    assert.throws(
      () => pnpmInvocation(path.join(root, 'missing', 'pnpm.exe')),
      /missing/,
    )
    assert.throws(() => pnpmInvocation('pnpm.exe'), /Absolute/)
    assert.throws(
      () => pnpmInvocation(path.join(root, 'depot_tools', 'pnpm.cmd')),
      /Absolute/,
    )
    const unsupported = path.join(root, 'npm-cli.js')
    fs.writeFileSync(unsupported, '')
    assert.throws(() => pnpmInvocation(unsupported), /Unrecognized/)
    assert.throws(() => pnpmInvocation(binary + ' & echo injected'), /missing/)
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})

test('Committed source license notices match supplier text and fail on drift', () => {
  verifySourceNotices()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor-notice-'))
  try {
    const supplier = path.join(root, 'node_modules', 'lucide-static')
    fs.mkdirSync(supplier, {recursive: true})
    fs.mkdirSync(path.join(root, 'licenses'))
    fs.writeFileSync(path.join(supplier, 'LICENSE'), 'Complete supplier notice')
    fs.writeFileSync(
      path.join(root, 'licenses', 'lucide-ISC.txt'),
      'Altered notice',
    )
    assert.throws(() => verifySourceNotices(root), /differs/)
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})

test('CI pnpm discovery verifies the active installed CLI in fresh pinned project context without local tooling', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor-ci-pnpm-'))
  try {
    const local = path.resolve('proof', 'tooling', 'package', 'bin', 'pnpm.cjs')
    const binary =
      process.env.SKYANCHOR_PNPM_BINARY ||
      (fs.existsSync(local) ? local : process.env.npm_execpath)
    assert.ok(
      binary,
      'The declared pnpm test script must supply its actual CLI path',
    )
    const module = new URL('../scripts/skyanchor/pnpm-cli.mjs', import.meta.url)
      .href
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const workspace = parse(fs.readFileSync('pnpm-workspace.yaml', 'utf8'))
    assert.equal(manifest.devEngines.packageManager.version, '11.28.5')
    assert.equal(manifest.devEngines.packageManager.onFail, 'warn')
    assert.equal(workspace.pmOnFail, 'download')
    // npm/npx read the manifest warning policy; pnpm self-management needs its workspace policy.
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      `pmOnFail: ${workspace.pmOnFail}\n`,
    )
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'skyanchor-fresh-ci-fixture',
        private: true,
        packageManager: manifest.packageManager,
        devEngines: manifest.devEngines,
      }),
    )
    const documents = parseAllDocuments(
      fs.readFileSync('pnpm-lock.yaml', 'utf8'),
    )
    assert.equal(
      documents.length,
      2,
      'Expected manager and application lock documents',
    )
    for (const document of documents) assert.deepEqual(document.errors, [])
    const managerLock = documents[0].toJS()
    const applicationLock = documents[1].toJS()
    assert.equal(managerLock.lockfileVersion, applicationLock.lockfileVersion)
    for (const name of ['pnpm', '@pnpm/exe']) {
      const dependency =
        managerLock.importers['.'].packageManagerDependencies[name]
      assert.equal(
        dependency.specifier,
        manifest.devEngines.packageManager.version,
      )
      assert.equal(
        dependency.version,
        manifest.devEngines.packageManager.version,
      )
      assert.ok(
        managerLock.packages[`${name}@${dependency.version}`].resolution
          .integrity,
      )
      assert.ok(managerLock.snapshots[`${name}@${dependency.version}`])
    }
    // Self-management resolves its locked managers before the separate application lock.
    fs.writeFileSync(
      path.join(root, 'pnpm-lock.yaml'),
      documents[0].toString() +
        '---\n' +
        stringify({
          lockfileVersion: applicationLock.lockfileVersion,
          importers: {'.': {}},
          packages: {},
          snapshots: {},
        }),
    )
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !['npm_execpath', 'skyanchor_pnpm_binary'].includes(
            key.toLowerCase(),
          ),
      ),
    )
    const discover = overrides =>
      spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {pnpmCommand} from ${JSON.stringify(module)}; console.log(JSON.stringify(pnpmCommand()))`,
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...env,
            ...overrides,
            SKYANCHOR_CHECKS_NO_INSTALL: '1',
          },
        },
      )
    for (const {name, overrides} of [
      {
        name: 'Trusted explicit CLI wins over invalid inherited npm_execpath',
        overrides: {
          SKYANCHOR_PNPM_BINARY: binary,
          npm_execpath: path.join(root, 'npm-cli.js'),
        },
      },
      {
        name: 'Fallback uses the same verified installed CLI',
        overrides: {
          SKYANCHOR_PNPM_BINARY: '',
          npm_execpath: binary,
        },
      },
    ]) {
      const result = discover(overrides)
      let switchDiagnostics
      if (result.status !== 0) {
        const invocation = pnpmInvocation(binary)
        const diagnosticEnv = {
          ...env,
          ...overrides,
          SKYANCHOR_CHECKS_NO_INSTALL: '1',
        }
        const metadataExpression =
          'JSON.stringify({cwd:process.cwd(),execPath:process.execPath,npm_execpath:process.env.npm_execpath,npm_config_user_agent:process.env.npm_config_user_agent})'
        // --version tolerates self-management failures; exec exposes the switch error.
        switchDiagnostics = [path.resolve('.'), root].flatMap(cwd =>
          [
            ['--version'],
            ['--config.verifyDepsBeforeRun=false', '--version'],
            [
              '--config.verifyDepsBeforeRun=false',
              'exec',
              process.execPath,
              '-p',
              metadataExpression,
            ],
          ].map(args => {
            const probe = spawnPnpm(invocation, args, {
              cwd,
              env: diagnosticEnv,
              encoding: 'utf8',
              timeout: 10000,
              maxBuffer: 16 * 1024,
            })
            return {
              cwd,
              command: invocation.command,
              args: [...invocation.args, ...args],
              status: probe.status,
              signal: probe.signal,
              error: probe.error?.code,
              stdout: probe.stdout?.slice(0, 2048),
              stderr: probe.stderr?.slice(0, 2048),
            }
          }),
        )
      }
      assert.equal(
        result.status,
        0,
        `${name}: ${JSON.stringify({status: result.status, stdout: result.stdout, stderr: result.stderr, switchDiagnostics})}`,
      )
      assert.ok(JSON.parse(result.stdout).command)
    }
    assert.equal(fs.existsSync(path.join(root, 'proof', 'tooling')), false)
    const wrong = path.join(root, 'pnpm.cjs')
    fs.writeFileSync(wrong, "console.log('11.25.0')\n")
    for (const {name, overrides} of [
      {
        name: 'Wrong explicit CLI cannot fall back to a valid inherited CLI',
        overrides: {SKYANCHOR_PNPM_BINARY: wrong, npm_execpath: binary},
      },
      {
        name: 'Wrong-version bootstrap npm_execpath is rejected',
        overrides: {SKYANCHOR_PNPM_BINARY: '', npm_execpath: wrong},
      },
    ]) {
      const rejected = discover(overrides)
      const diagnostic = `${name}: ${JSON.stringify({status: rejected.status, stdout: rejected.stdout, stderr: rejected.stderr})}`
      assert.notEqual(rejected.status, 0, diagnostic)
      assert.match(rejected.stderr, /pnpm 11\.28\.5 required/, diagnostic)
      assert.match(rejected.stderr, /11\.25\.0/, diagnostic)
    }
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})

test('Workers Assets deployment inputs reject the looping SPA redirect source and exported rule', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor-routing-'))
  try {
    for (const name of ['public', 'dist']) {
      const directory = path.join(root, name)
      fs.mkdirSync(directory)
      verifyNoAssetRedirects(directory)
      fs.writeFileSync(
        path.join(directory, '_redirects'),
        '/* /index.html 200\n',
      )
      assert.throws(() => verifyNoAssetRedirects(directory), /SPA fallback/)
    }
    verifyNoAssetRedirects(path.resolve('public'))
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})

test('Zod backport cannot authorize changed supplier metadata or new advisory versions', () => {
  const advisory = {
    github_advisory_id: patchMetadata.advisory,
    id: patchMetadata.advisorySupplierId,
    cwe: patchMetadata.advisoryCwe,
    url: patchMetadata.advisoryUrl,
    module_name: patchMetadata.package,
    severity: patchMetadata.advisorySeverity,
    title: patchMetadata.advisoryTitle,
    vulnerable_versions: patchMetadata.supplierVulnerableRange,
    patched_versions: patchMetadata.supplierPatchedRange,
    findings: [{version: patchMetadata.version, paths: ['.>zod']}],
  }
  assert.equal(isReviewedZodAdvisory(advisory), true)
  for (const mutated of [
    {...advisory, patched_versions_unpublished: true},
    {...advisory, patched_versions_unpublished: false},
    {
      ...advisory,
      findings: [...advisory.findings, {version: '3.25.75', paths: ['.>zod']}],
    },
    {...advisory, title: 'Changed security scope'},
  ])
    assert.equal(isReviewedZodAdvisory(mutated), false)
})

test('Old artifact source evidence cannot authorize changed installed dependency bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor-evidence-'))
  try {
    const directory = path.join(root, 'node_modules', 'example')
    fs.mkdirSync(directory, {recursive: true})
    const file = path.join(directory, 'index.js')
    fs.writeFileSync(file, 'export const patched = false\n')
    const maps = [
      {
        sources: ['node_modules/example/index.js'],
        sourcesContent: ['export const patched = false\n'],
      },
    ]
    const evidence = dependencySourceEvidence(maps, root)
    verifyDependencySources(evidence, root)
    fs.writeFileSync(file, 'export const patched = true\n')
    assert.throws(() => verifyDependencySources(evidence, root), /stale/)
    assert.throws(() => dependencySourceEvidence(maps, root), /differ/)
    assert.throws(
      () => dependencySourceEvidence([{sources: maps[0].sources}], root),
      /sourcesContent/,
    )
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})

test('Empty advisory coverage never bypasses required runtime hash or version verification', () => {
  const advisories = []
  assert.equal(advisories.length, 0)
  const packages = [
    {name: 'zod', version: '3.25.76', directory: 'node_modules/zod'},
  ]
  assert.throws(
    () =>
      verifyRequiredZodRuntime(packages, () => {
        throw new Error('Zod patched source mismatch')
      }),
    /source mismatch/,
  )
  assert.throws(
    () => verifyRequiredZodRuntime([{...packages[0], version: '4.6.6'}]),
    /Unreviewed shipped Zod version/,
  )
  assert.throws(() => verifyRequiredZodRuntime([]), /missing/)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor-wrong-zod-'))
  try {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'zod',
        version: '3.25.76',
      }),
    )
    fs.mkdirSync(path.join(root, 'src', 'v3'), {recursive: true})
    fs.writeFileSync(
      path.join(root, 'src', 'v3', 'types.ts'),
      'unpatched parser',
    )
    assert.throws(
      () => verifyRequiredZodRuntime([{...packages[0], directory: root}]),
      /patched source mismatch/,
    )
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})

test('Empty Metro asset source content requires exact exported asset bytes, never executable source exemptions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor-asset-'))
  try {
    const sourceDirectory = path.join(root, 'node_modules', 'example')
    const exportDirectory = path.join(
      root,
      'dist',
      'assets',
      'node_modules',
      'example',
    )
    fs.mkdirSync(sourceDirectory, {recursive: true})
    fs.mkdirSync(exportDirectory, {recursive: true})
    const name = 'postMock.' + '1'.repeat(32) + '.html'
    const content = '<html>Actual shipped asset</html>'
    fs.writeFileSync(path.join(sourceDirectory, 'postMock.html'), content)
    fs.writeFileSync(path.join(exportDirectory, name), content)
    const maps = [
      {sources: ['node_modules/example/postMock.html'], sourcesContent: ['']},
    ]
    const evidence = dependencySourceEvidence(maps, root)
    verifyDependencySources(evidence, root)
    fs.writeFileSync(
      path.join(exportDirectory, name),
      '<html>Mutated asset</html>',
    )
    assert.throws(
      () => verifyDependencySources(evidence, root),
      /exact exported dependency asset source/,
    )
    assert.throws(
      () => dependencySourceEvidence(maps, root),
      /exact exported dependency asset/,
    )
    fs.writeFileSync(path.join(sourceDirectory, 'icon.png'), 'PNG4')
    fs.writeFileSync(path.join(sourceDirectory, 'icon@4x.png'), 'PNG4')
    fs.writeFileSync(path.join(sourceDirectory, 'icon@1x.png'), 'PNG1')
    const icon = 'icon.' + '2'.repeat(32)
    fs.writeFileSync(path.join(exportDirectory, icon + '.png'), 'PNG1')
    fs.writeFileSync(path.join(exportDirectory, icon + '@4x.png'), 'PNG4')
    const scaled = dependencySourceEvidence(
      [{sources: ['node_modules/example/icon.png'], sourcesContent: ['']}],
      root,
    )
    verifyDependencySources(scaled, root)
    fs.writeFileSync(
      path.join(sourceDirectory, 'icon@1x.png'),
      'Changed unrepresented scale',
    )
    assert.throws(
      () => verifyDependencySources(scaled, root),
      /exact exported dependency asset source/,
    )
    fs.writeFileSync(
      path.join(sourceDirectory, 'index.js'),
      'unpatched executable source',
    )
    assert.throws(
      () =>
        dependencySourceEvidence(
          [{sources: ['node_modules/example/index.js'], sourcesContent: ['']}],
          root,
        ),
      /differ/,
    )
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})

test('Final artifact evidence detects changed HTML and added or removed export files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor-artifacts-'))
  try {
    fs.mkdirSync(path.join(root, 'dist'))
    const index = path.join(root, 'dist', 'index.html')
    fs.writeFileSync(index, '<html>Original inline script</html>')
    const evidence = browserArtifactEvidence(root)
    verifyBrowserArtifacts(evidence, root)
    const runtime = path.join(root, 'dist', 'skyanchor-runtime.json')
    const provenance = path.join(root, 'dist', 'skyanchor-provenance.json')
    fs.writeFileSync(runtime, '{"dependencySources":[]}')
    fs.writeFileSync(provenance, '{"failures":[]}')
    const complete = browserArtifactEvidence(root, true)
    verifyBrowserArtifacts(complete, root, true)
    fs.writeFileSync(runtime, '{"dependencySources":["forged"]}')
    assert.throws(
      () => verifyBrowserArtifacts(complete, root, true),
      /artifact bytes or inventory changed/,
    )
    fs.writeFileSync(runtime, '{"dependencySources":[]}')
    fs.writeFileSync(provenance, '{"failures":["changed"]}')
    assert.throws(
      () => verifyBrowserArtifacts(complete, root, true),
      /artifact bytes or inventory changed/,
    )
    fs.writeFileSync(index, '<html>Changed inline script</html>')
    assert.throws(
      () => verifyBrowserArtifacts(evidence, root),
      /artifact bytes or inventory changed/,
    )
    fs.writeFileSync(index, '<html>Original inline script</html>')
    fs.writeFileSync(
      path.join(root, 'dist', 'added.js'),
      'unexpected executable',
    )
    assert.throws(
      () => verifyBrowserArtifacts(evidence, root),
      /artifact bytes or inventory changed/,
    )
    fs.unlinkSync(path.join(root, 'dist', 'added.js'))
    fs.unlinkSync(index)
    assert.throws(
      () => verifyBrowserArtifacts(evidence, root),
      /artifact bytes or inventory changed/,
    )
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})

test('Same-version Zod findings resolve each installed copy instead of sharing a patched verdict', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skyanchor-paths-'))
  try {
    const write = (relative, manifest) => {
      const directory = path.join(root, ...relative.split('/'))
      fs.mkdirSync(directory, {recursive: true})
      fs.writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify(manifest),
      )
    }
    write('', {name: 'fixture'})
    write('node_modules/zod', {name: 'zod', version: '3.25.76'})
    write('node_modules/build-consumer', {
      name: 'build-consumer',
      version: '1.0.0',
    })
    write('node_modules/build-consumer/node_modules/zod', {
      name: 'zod',
      version: '3.25.76',
    })
    const finding = {
      version: '3.25.76',
      paths: ['.>zod', '.>build-consumer>zod'],
    }
    const visits = []
    assert.throws(
      () =>
        verifyZodFindingPaths(finding, root, directory => {
          visits.push(directory)
          if (directory.includes('build-consumer'))
            throw new Error('Unpatched native copy')
        }),
      /Unpatched native copy/,
    )
    assert.equal(visits.length, 2)
    assert.notEqual(visits[0], visits[1])
    assert.throws(
      () =>
        verifyZodFindingPaths(
          {
            version: '3.25.76',
            paths: ['.>missing-consumer>zod'],
          },
          root,
          () => {},
        ),
      /missing/,
    )
  } finally {
    fs.rmSync(root, {recursive: true})
  }
})
