import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {gitAt} from '../scripts/skyanchor/upstream.mjs'
import {
  inspectFile,
  inspectWorkflow,
  verifyPublication,
} from '../scripts/skyanchor/publication.mjs'

test('Publication checks real root ancestry and every retained historical tree', t => {
  fs.mkdirSync('.publication-local', {recursive: true})
  const root = fs.mkdtempSync(
    path.resolve('.publication-local', 'publication-test-'),
  )
  t.after(() => fs.rmSync(root, {recursive: true, force: true}))
  const git = (...args) => gitAt(root, args)
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'MichaelEns')
  git('config', 'user.email', '44419611+MichaelEns@users.noreply.github.com')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  fs.writeFileSync(path.join(root, 'README.md'), '# Synthetic public root\n')
  for (const file of ['LICENSE', 'NOTICE.md', 'ASSETS.md'])
    fs.writeFileSync(path.join(root, file), 'Synthetic fixture notice.\n')
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}\n')
  fs.writeFileSync(path.join(root, '.gitattributes'), '* text=auto eol=lf\n')
  git('add', '.')
  git('commit', '-qm', 'Public root')
  const base = git('rev-parse', 'HEAD')
  assert.equal(git('show', '-s', '--format=%P', base), '')
  assert.equal(verifyPublication(root).commits, 1)
  const shallow = gitAt(root, ['commit-tree', `${base}^{tree}`, '-p', base], {
    input: 'Synthetic shallow boundary\n',
  })
  fs.writeFileSync(path.join(root, '.git', 'shallow'), shallow + '\n')
  assert.throws(() => verifyPublication(root, shallow), /parentless/)
  fs.unlinkSync(path.join(root, '.git', 'shallow'))
  const foreign = gitAt(root, ['commit-tree', `${base}^{tree}`], {
    input: 'Synthetic foreign parent\n',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Synthetic',
      GIT_AUTHOR_EMAIL: 'synthetic@example.invalid',
      GIT_COMMITTER_NAME: 'Synthetic',
      GIT_COMMITTER_EMAIL: 'synthetic@example.invalid',
    },
  })
  const merge = gitAt(
    root,
    ['commit-tree', `${base}^{tree}`, '-p', base, '-p', foreign],
    {input: 'Synthetic imported parent\n'},
  )
  assert.throws(() => verifyPublication(root, merge), /independent/)
  const raw = gitAt(root, ['hash-object', '-w', '--stdin'], {input: 'bad\r\n'})
  git('update-index', '--cacheinfo', `100644,${raw},README.md`)
  git('commit', '-qm', 'Historical unsafe bytes')
  fs.writeFileSync(path.join(root, 'README.md'), '# Restored\n')
  git('add', '.')
  git('commit', '-qm', 'Current bytes safe')
  assert.throws(() => verifyPublication(root), /LF/)
})

test('Publication inventory excludes dumps, credentials, outputs and non-LF text without stripping notices', () => {
  for (const file of [
    'saved.db',
    'backup.sql',
    'private.bundle',
    'worker/.wrangler/default.enc',
    'proof/tooling/package.json',
    'dist/index.html',
    'sessions/account.json',
    'worker/wrangler.local.jsonc',
    '.claude/.pre-pr-sweep-state',
  ])
    assert.throws(() => inspectFile(file, Buffer.from('{}\n')), /Excluded/)
  assert.throws(() => inspectFile('README.md', Buffer.from('line\r\n')), /LF/)
  assert.throws(
    () =>
      inspectFile('README.md', Buffer.from('-----BEGIN ' + 'PRIVATE KEY-----')),
    /private metadata/,
  )
  assert.throws(
    () =>
      inspectFile(
        'README.md',
        Buffer.from('https://' + 'synthetic.account.workers.dev'),
      ),
    /private metadata/,
  )
  inspectFile(
    'licenses/NOTICE.txt',
    Buffer.from('Copyright public author <author@example.org>\n'),
  )
  inspectFile(
    'worker/migrations/0001_init.sql',
    Buffer.from('CREATE TABLE synthetic (id TEXT);\n'),
  )
})

test('Every actual workflow is public-bound, zero-storage and uses only standard runners', () => {
  for (const file of fs.readdirSync('.github/workflows')) {
    const name = `.github/workflows/${file}`
    const text = fs.readFileSync(name, 'utf8')
    inspectWorkflow(name, text)
    for (const capability of [
      'actions/' + 'upload-artifact@v4',
      'actions/' + 'cache@v4',
      'pull_request' + '_target:',
      'secrets.' + 'CLOUD_TOKEN',
    ])
      assert.throws(
        () => inspectWorkflow(name, text + '\n' + capability),
        /capability/,
      )
    assert.throws(
      () =>
        inspectWorkflow(
          name,
          text
            .replace('windows-latest', 'self-hosted')
            .replace('ubuntu-latest', 'self-hosted'),
        ),
      /capability/,
    )
    assert.throws(
      () =>
        inspectWorkflow(
          name,
          text +
            '\n  unguarded:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n',
        ),
      /per-job/,
    )
  }
})

test('Required candidate cannot skip disabled activation or continue after a failed trusted guard', () => {
  const file = '.github/workflows/skyanchor-candidate.yml'
  const text = fs.readFileSync(file, 'utf8')
  inspectWorkflow(file, text)
  for (const changed of [
    text.replace(
      'github.event.repository.private == false',
      "github.event.repository.private == false && vars.SKYANCHOR_AUTOMATION_ENABLED == 'true'",
    ),
    text.replace("$env:ENABLED -ne 'true'", '$false'),
    text.replace(
      'name: Require owner activation before checkout',
      'name: Bypass',
    ),
    text.replace('shell: pwsh', 'continue-on-error: true\n        shell: pwsh'),
    text.replace('shell: pwsh', 'if: false\n        shell: pwsh'),
    text.replace('vars.SKYANCHOR_ADMIN_POLICY_ATTESTATION', 'vars.UNRELATED'),
  ])
    assert.throws(
      () => inspectWorkflow(file, changed),
      /per-job|Required candidate/,
    )
})

test(
  'Actual first candidate PowerShell guard fails for every missing owner prerequisite',
  {skip: process.platform !== 'win32'},
  () => {
    const text = fs.readFileSync(
      '.github/workflows/skyanchor-candidate.yml',
      'utf8',
    )
    const script = text
      .split('        run: |\n')[1]
      .split('      - uses:')[0]
      .replace(/^ {10}/gm, '')
    const valid = {
      ENABLED: 'true',
      ZERO_SPEND: 'true',
      FORK_APPROVAL: 'true',
      ADMIN_POLICY:
        '{"synthetic":"owner-attestation-validated-later-by-trusted-policy"}',
      BUDGET_EVIDENCE:
        'https://github.com/MichaelEns/skyanchor-public/issues/1',
    }
    const run = env => {
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          env: {...process.env, ...env},
          encoding: 'utf8',
        },
      )
      if (result.error) throw result.error
      return result.status
    }
    assert.equal(run(valid), 0)
    for (const key of Object.keys(valid))
      assert.notEqual(run({...valid, [key]: ''}), 0, key)
    assert.notEqual(run({...valid, ENABLED: 'false'}), 0)
  },
)
