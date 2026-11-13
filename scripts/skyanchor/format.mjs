import {spawnSync} from 'node:child_process'
import path from 'node:path'

const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACM'], {
  encoding: 'utf8',
})
if (result.status !== 0) process.exit(result.status ?? 1)
const files = result.stdout
  .trim()
  .split('\n')
  .filter(file => /\.(tsx?|js|json|jsonc|ya?ml|md)$/.test(file))
files.push(
  path.join('src', 'features', 'skyanchor'),
  path.join('scripts', 'skyanchor'),
  path.join('proof', 'browser.mjs'),
  path.join('proof', 'startup.mjs'),
  path.join('proof', 'profile-reading.mjs'),
  path.join('proof', 'handoff.mjs'),
  path.join('proof', 'reading-panel.mjs'),
  path.join('proof', 'auth-contrast.mjs'),
  path.join('proof', 'viewport.mjs'),
  path.join('proof', 'viewport.test.mjs'),
  path.join('proof', 'youtube.mjs'),
  path.join('proof', 'youtube.test.mjs'),
  path.join('proof', 'assets.test.mjs'),
  path.join('proof', 'runtime.mjs'),
  path.join('proof', 'domain.test.mjs'),
  path.join('proof', 'worker.test.mjs'),
  path.join('proof', 'sync.test.mjs'),
  path.join('proof', 'upstream.test.mjs'),
  path.join('proof', 'publication.test.mjs'),
  path.join('proof', 'next-dependency-plan.json'),
  path.join('proof', 'composer.mjs'),
  path.join('proof', 'tiptap-security-entry.mjs'),
  path.join('proof', 'zod-security.test.mjs'),
  path.join('proof', 'security-policy.test.mjs'),
  path.join('proof', 'security-evidence.test.mjs'),
  path.join('proof', 'zod-jest.config.cjs'),
  path.join('proof', 'zod-jest-globals.cjs'),
  path.join('proof', 'zod-transform.cjs'),
  path.join('proof', 'worker-bench.mjs'),
  path.join('patches', 'zod-security.json'),
  path.join('patches', 'security-usage.json'),
  path.join('public', 'skyanchor.html'),
  path.join('.github', 'workflows', 'skyanchor-candidate.yml'),
  path.join('.github', 'workflows', 'skyanchor-owner-merge.yml'),
  path.join('.github', 'workflows', 'skyanchor-upstream.yml'),
  path.join('.github', 'workflows', 'asset-notices.yml'),
  path.join('.github', 'workflows', 'zizmor.yml'),
  path.join('.github', 'dependabot.yml'),
  'NOTICE.md',
  'README.md',
  'ASSUMPTIONS.md',
  path.join('docs', 'skyanchor-release.md'),
  path.join('docs', 'skyanchor-proof.md'),
  path.join('docs', 'skyanchor-publication.md'),
  path.join('worker', 'index.ts'),
  path.join('worker', 'wrangler.jsonc'),
)
for (let index = 0; index < files.length; index += 35) {
  const batch = spawnSync(
    process.execPath,
    [
      path.join('node_modules', 'prettier', 'bin', 'prettier.cjs'),
      '--write',
      ...files.slice(index, index + 35),
    ],
    {stdio: 'inherit'},
  )
  if (batch.status !== 0) process.exit(batch.status ?? 1)
}
