import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
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
