import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  classify,
  latestRelease,
  requireReleasePin,
  requireMainProtection,
  requirePublicPolicy,
  verifyOwnerSetup,
  verifyRuntimePolicy,
  requireReceipt,
  requireExactCheck,
  reconstruct,
  gitAt,
  repository,
  digest,
} from '../scripts/skyanchor/upstream.mjs'

const ownerEmail = '44419611+MichaelEns@users.noreply.github.com'
const protection = {
  required_status_checks: {
    strict: true,
    checks: [{context: 'SkyAnchor exact candidate', app_id: 15368}],
  },
  enforce_admins: {enabled: true},
  allow_force_pushes: {enabled: false},
  allow_deletions: {enabled: false},
  allow_fork_syncing: {enabled: false},
  required_pull_request_reviews: {
    required_approving_review_count: 0,
    bypass_pull_request_allowances: {users: [], teams: [], apps: []},
  },
}
const policy = {
  SKYANCHOR_AUTOMATION_ENABLED: 'true',
  SKYANCHOR_ZERO_SPEND_VERIFIED: 'true',
  SKYANCHOR_FORK_APPROVAL_VERIFIED: 'true',
  SKYANCHOR_ZERO_SPEND_EVIDENCE: `https://github.com/${repository}/issues/1`,
}
const info = {
  id: 1452249834,
  full_name: repository,
  private: false,
  visibility: 'public',
  fork: false,
  default_branch: 'main',
  archived: false,
}
const attestation = {
  schemaVersion: 1,
  repository,
  repositoryId: info.id,
  defaultBranch: 'main',
  protection,
  forkApprovalPolicy: 'all_external_contributors',
  additionalRulesets: [],
  evidence: policy.SKYANCHOR_ZERO_SPEND_EVIDENCE,
}

function fixture(t) {
  const directory = path.resolve('.publication-local')
  fs.mkdirSync(directory, {recursive: true})
  const root = fs.mkdtempSync(path.join(directory, 'upstream-test-'))
  t.after(() => fs.rmSync(root, {recursive: true, force: true}))
  function init(name) {
    const repo = path.join(root, name)
    fs.mkdirSync(repo)
    const g = (...args) => gitAt(repo, args)
    g('init', '-q', '-b', 'main')
    g('config', 'user.name', 'MichaelEns')
    g('config', 'user.email', ownerEmail)
    g('config', 'commit.gpgsign', 'false')
    g('config', 'core.autocrlf', 'false')
    return {repo, g}
  }
  const official = init('official')
  function write(repo, file, text) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), {recursive: true})
    fs.writeFileSync(path.join(repo, file), text)
  }
  function commit(target, file, text) {
    write(target.repo, file, text)
    target.g('add', '.')
    target.g('commit', '-qm', 'Synthetic public fixture')
    return target.g('rev-parse', 'HEAD')
  }
  const previous = commit(
    official,
    'docs/build.md',
    '# Build\n\nA small public guide.\n',
  )
  const current = init('snapshot')
  write(current.repo, 'docs/build.md', '# Build\n\nA small public guide.\n')
  write(
    current.repo,
    'scripts/skyanchor/upstream-provenance.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        repository: 'bluesky-social/social-app',
        tag: '1.137.0',
        upstream: previous,
        license: 'MIT',
      },
      null,
      2,
    ) + '\n',
  )
  current.g('add', '.')
  current.g('commit', '-qm', 'Sanitized independent root')
  const base = current.g('rev-parse', 'HEAD')
  function fetch(upstream) {
    current.g(
      'fetch',
      '-q',
      '--depth=1',
      '--no-tags',
      official.repo,
      `${upstream}:refs/skyanchor/test-${upstream}`,
    )
  }
  fetch(previous)
  return {current, official, base, previous, commit, fetch}
}

test('Stable release provenance uses real release tags and detects pinned tag drift', () => {
  const a = 'a'.repeat(40),
    b = 'b'.repeat(40),
    c = 'c'.repeat(40)
  const lines = `${a}\trefs/tags/1.9.0\n${b}\trefs/tags/1.137.0\n${c}\trefs/tags/1.137.0^{}\n${a}\trefs/tags/2.0.0-rc.1`
  assert.deepEqual(latestRelease(lines), {tag: '1.137.0', upstream: c})
  const pin = {
    schemaVersion: 1,
    repository: 'bluesky-social/social-app',
    tag: '1.137.0',
    upstream: c,
    license: 'MIT',
  }
  requireReleasePin(lines, pin)
  assert.throws(() => requireReleasePin(lines, {...pin, upstream: a}), /drift/)
  assert.throws(() => latestRelease(`${a}\trefs/heads/main`), /No official/)
})

test('Public identity, cost evidence and strict app-bound protection fail closed', () => {
  requirePublicPolicy(info, policy, attestation)
  for (const change of [
    {private: true},
    {visibility: 'private'},
    {full_name: 'example/other'},
    {fork: true},
    {default_branch: 'other'},
    {archived: true},
    {id: 1},
  ])
    assert.throws(() =>
      requirePublicPolicy({...info, ...change}, policy, attestation),
    )
  for (const key of Object.keys(policy)) {
    const changed = {...policy}
    delete changed[key]
    assert.throws(() => requirePublicPolicy(info, changed, attestation))
  }
  for (const change of [
    {
      required_status_checks: {
        strict: false,
        checks: protection.required_status_checks.checks,
      },
    },
    {
      required_status_checks: {
        strict: true,
        checks: [{context: 'SkyAnchor exact candidate', app_id: null}],
      },
    },
    {enforce_admins: {enabled: false}},
    {allow_force_pushes: {enabled: true}},
    {allow_deletions: undefined},
    {allow_fork_syncing: {enabled: true}},
    {restrictions: {users: []}},
    {
      required_pull_request_reviews: {
        required_approving_review_count: 0,
        bypass_pull_request_allowances: {users: ['owner']},
      },
    },
  ])
    assert.throws(() => requireMainProtection({...protection, ...change}))
})

test('Owner-admin setup reads privileged policy once; omitted bypass evidence never means safe', async () => {
  const replies = {
    '': info,
    'branches/main/protection': protection,
    'actions/permissions/fork-pr-contributor-approval': {
      approval_policy: 'all_external_contributors',
    },
    'rulesets?includes_parents=true': [],
    'rules/branches/main': [],
  }
  const request = async endpoint => {
    assert.ok(Object.hasOwn(replies, endpoint), endpoint)
    return replies[endpoint]
  }
  const verified = await verifyOwnerSetup(request, attestation.evidence)
  requirePublicPolicy(info, policy, verified)
  for (const change of [
    {protection: undefined},
    {
      protection: {
        ...protection,
        required_pull_request_reviews: {required_approving_review_count: 0},
      },
    },
    {repositoryId: 1},
    {additionalRulesets: undefined},
    {additionalRulesets: [{id: 1}]},
    {evidence: ''},
    {forkApprovalPolicy: 'first_time_contributors'},
  ])
    assert.throws(() =>
      requirePublicPolicy(info, policy, {...verified, ...change}),
    )
  await assert.rejects(
    () =>
      verifyOwnerSetup(async () => {
        throw Error('HTTP 403')
      }, attestation.evidence),
    /403/,
  )
  replies['rulesets?includes_parents=true'] = [{id: 1}]
  await assert.rejects(
    () => verifyOwnerSetup(request, attestation.evidence),
    /ruleset/,
  )
})

test('Native-token runtime reads only public policy surfaces and halts on unknown or denied data', async () => {
  const main = 'a'.repeat(40)
  const branch = {
    name: 'main',
    protected: true,
    commit: {sha: main},
    protection: {
      enabled: true,
      required_status_checks: {
        enforcement_level: 'everyone',
        contexts: ['SkyAnchor exact candidate'],
        checks: [{context: 'SkyAnchor exact candidate', app_id: 15368}],
      },
    },
  }
  const replies = {
    '': info,
    'branches/main': branch,
    'rules/branches/main': [],
    'git/ref/heads/main': {object: {sha: main}},
  }
  const variables = {
    ...policy,
    SKYANCHOR_ADMIN_POLICY_ATTESTATION: JSON.stringify(attestation),
  }
  const called = []
  const request = async endpoint => {
    called.push(endpoint)
    assert.ok(
      Object.hasOwn(replies, endpoint),
      `Unexpected privileged endpoint: ${endpoint}`,
    )
    return replies[endpoint]
  }
  await verifyRuntimePolicy(request, variables, main)
  assert.deepEqual(called, [
    '',
    'branches/main',
    'rules/branches/main',
    'git/ref/heads/main',
  ])
  for (const change of [
    {protected: false},
    {protection: undefined},
    {
      protection: {
        ...branch.protection,
        required_status_checks: {
          enforcement_level: 'non_admins',
          contexts: [],
          checks: [],
        },
      },
    },
    {commit: {sha: 'b'.repeat(40)}},
  ]) {
    replies['branches/main'] = {...branch, ...change}
    await assert.rejects(
      () => verifyRuntimePolicy(request, variables, main),
      /protection|advanced/,
    )
  }
  replies['branches/main'] = branch
  for (const rules of [null, {}, [{type: 'required_status_checks'}]]) {
    replies['rules/branches/main'] = rules
    await assert.rejects(
      () => verifyRuntimePolicy(request, variables, main),
      /ruleset/,
    )
  }
  replies['rules/branches/main'] = []
  await assert.rejects(
    () =>
      verifyRuntimePolicy(
        request,
        {...variables, SKYANCHOR_ADMIN_POLICY_ATTESTATION: ''},
        main,
      ),
    /attestation/,
  )
  await assert.rejects(
    () =>
      verifyRuntimePolicy(
        request,
        {...variables, SKYANCHOR_AUTOMATION_ENABLED: ''},
        main,
      ),
    /Public binding/,
  )
  await assert.rejects(
    () =>
      verifyRuntimePolicy(
        async endpoint => {
          if (endpoint === 'branches/main') throw Error('HTTP 403')
          return request(endpoint)
        },
        variables,
        main,
      ),
    /403/,
  )
})

test('Real independent snapshot no-update leaves the exact base unchanged', t => {
  const f = fixture(t)
  const plan = reconstruct(f.current.repo, f.base, {
    tag: '1.137.0',
    upstream: f.previous,
  })
  assert.equal(plan.updates, false)
  assert.equal(plan.trivial, false)
  assert.equal(f.current.g('rev-parse', 'HEAD'), f.base)
  assert.equal(f.current.g('show', '-s', '--format=%P', f.base), '')
})

test('Real docs delta reconstructs one deterministic sanitized parent without upstream assets', t => {
  const f = fixture(t)
  const upstream = f.commit(
    f.official,
    'docs/build.md',
    '# Build\n\nA small public guide!\n',
  )
  f.fetch(upstream)
  const release = {tag: '1.138.0', upstream}
  const plan = reconstruct(f.current.repo, f.base, release)
  assert.equal(plan.trivial, true)
  assert.deepEqual(reconstruct(f.current.repo, f.base, release), plan)
  const patch = gitAt(
    f.current.repo,
    [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--binary',
      f.previous,
      upstream,
      '--',
      'docs/build.md',
    ],
    {raw: true},
  )
  assert.equal(plan.patch, digest(patch))
  assert.equal(f.current.g('show', '-s', '--format=%P', plan.head), f.base)
  assert.equal(
    f.current.g('show', `${plan.head}:docs/build.md`),
    '# Build\n\nA small public guide!',
  )
  const provenance = JSON.parse(
    f.current.g(
      'show',
      `${plan.head}:scripts/skyanchor/upstream-provenance.json`,
    ),
  )
  assert.equal(provenance.upstream, upstream)
  assert.deepEqual(
    f.current.g('diff', '--name-only', f.base, plan.head).split('\n'),
    ['docs/build.md', 'scripts/skyanchor/upstream-provenance.json'],
  )
  assert.equal(f.current.g('rev-parse', 'HEAD'), f.base)
  assert.equal(f.current.g('status', '--porcelain'), '')
})

test('Real app/dependency additions, prose changes, links, renames, symlinks and customized base require manual review', t => {
  for (const scenario of [
    'app',
    'dependency',
    'prose',
    'link',
    'code',
    'rename',
    'symlink',
    'conflict',
  ]) {
    const f = fixture(t)
    let upstream
    if (scenario === 'app')
      upstream = f.commit(f.official, 'src/app.ts', 'export const value = 1\n')
    if (scenario === 'dependency')
      upstream = f.commit(f.official, 'package.json', '{}\n')
    if (scenario === 'prose')
      upstream = f.commit(
        f.official,
        'docs/build.md',
        '# Build\n\nA different instruction.\n',
      )
    if (scenario === 'link')
      upstream = f.commit(
        f.official,
        'docs/build.md',
        '# Build\n\n[Open](https://example.com)\n',
      )
    if (scenario === 'code')
      upstream = f.commit(
        f.official,
        'docs/build.md',
        '# Build\n\nA small public guide.\n\n```\nsmall()\n```\n',
      )
    if (scenario === 'rename') {
      f.official.g('mv', 'docs/build.md', 'docs/testing.md')
      f.official.g('commit', '-qm', 'Rename public guide')
      upstream = f.official.g('rev-parse', 'HEAD')
    }
    if (scenario === 'symlink') {
      const blob = gitAt(f.official.repo, ['hash-object', '-w', '--stdin'], {
        input: '../outside',
      })
      f.official.g(
        'update-index',
        '--cacheinfo',
        `120000,${blob},docs/build.md`,
      )
      f.official.g('commit', '-qm', 'Synthetic symlink')
      upstream = f.official.g('rev-parse', 'HEAD')
    }
    let base = f.base
    if (scenario === 'conflict') {
      base = f.commit(
        f.current,
        'docs/build.md',
        '# Build\n\nCustomized local guide.\n',
      )
      upstream = f.commit(
        f.official,
        'docs/build.md',
        '# Build\n\nChanged upstream guide.\n',
      )
    }
    f.fetch(upstream)
    assert.equal(
      reconstruct(f.current.repo, base, {tag: '1.138.0', upstream}).trivial,
      false,
      scenario,
    )
  }
})

test('Main advances and unsafe path records halt without changing the source', t => {
  const f = fixture(t)
  const upstream = f.commit(
    f.official,
    'docs/build.md',
    '# Build\n\nA clearer public guide.\n',
  )
  f.fetch(upstream)
  f.commit(f.current, 'local.md', 'Public local change.\n')
  assert.throws(
    () => reconstruct(f.current.repo, f.base, {tag: '1.138.0', upstream}),
    /advanced/,
  )
  const blob = gitAt(f.official.repo, ['hash-object', '-w', '--stdin'], {
    input: 'escape\n',
  })
  f.official.g(
    'update-index',
    '--add',
    '--cacheinfo',
    `100644,${blob},docs/unsafe name.md`,
  )
  f.official.g('commit', '-qm', 'Unsafe path fixture')
  const unsafe = f.official.g('rev-parse', 'HEAD')
  f.fetch(unsafe)
  assert.throws(
    () =>
      reconstruct(f.current.repo, f.current.g('rev-parse', 'HEAD'), {
        tag: '1.138.0',
        upstream: unsafe,
      }),
    /Unsafe upstream path/,
  )
})

test('Real public-shaped upstream tag drift and actual candidate head changes are rejected', t => {
  const f = fixture(t)
  f.official.g('tag', '1.137.0', f.previous)
  const pin = {
    schemaVersion: 1,
    repository: 'bluesky-social/social-app',
    tag: '1.137.0',
    upstream: f.previous,
    license: 'MIT',
  }
  requireReleasePin(f.current.g('ls-remote', '--tags', f.official.repo), pin)
  const upstream = f.commit(
    f.official,
    'docs/build.md',
    '# Build\n\nA small public guide!\n',
  )
  f.official.g('tag', '-f', '1.137.0', upstream)
  assert.throws(
    () =>
      requireReleasePin(
        f.current.g('ls-remote', '--tags', f.official.repo),
        pin,
      ),
    /drift/,
  )
  f.fetch(upstream)
  const plan = reconstruct(f.current.repo, f.base, {tag: '1.138.0', upstream})
  const commands = [['skyanchor:security']]
  const receipt = {
    head: plan.head,
    tree: plan.tree,
    inputs: 'a'.repeat(64),
    artifacts: 'b'.repeat(64),
    passed: true,
    commands: [{command: commands[0], exit: 0}],
  }
  requireReceipt(plan, receipt, commands)
  f.current.g('switch', '--detach', plan.head)
  const changedHead = f.commit(f.current, 'README.md', 'Changed candidate.\n')
  assert.throws(
    () => requireReceipt({...plan, head: changedHead}, receipt, commands),
    /receipt/,
  )
})

test('Tampered receipt and PR head cannot authorize exact landing', () => {
  const head = 'a'.repeat(40),
    base = 'b'.repeat(40),
    tree = 'c'.repeat(40)
  const plan = {head, base, tree, upstream: 'f'.repeat(40)}
  const commands = [['skyanchor:publication'], ['skyanchor:security']]
  const receipt = {
    head,
    tree,
    inputs: 'd'.repeat(64),
    artifacts: 'e'.repeat(64),
    passed: true,
    commands: commands.map(command => ({command, exit: 0})),
  }
  requireReceipt(plan, receipt, commands)
  for (const change of [
    {head: base},
    {tree: base},
    {passed: false},
    {commands: receipt.commands.slice(1)},
    {inputs: ''},
    {artifacts: ''},
  ])
    assert.throws(() => requireReceipt(plan, {...receipt, ...change}, commands))
  const pr = {
    head: {
      sha: head,
      ref: `skyanchor/upstream-${plan.upstream}`,
      repo: {full_name: repository},
    },
    base: {sha: base, ref: 'main', repo: {full_name: repository}},
    draft: false,
    state: 'open',
    mergeable: true,
  }
  const checks = [
    {
      name: 'SkyAnchor exact candidate',
      head_sha: head,
      app: {id: 15368},
      status: 'completed',
      conclusion: 'success',
      url: 'https://api.github.com/check',
    },
  ]
  const run = {
    head_sha: head,
    head_branch: pr.head.ref,
    head_repository: {full_name: repository},
    path: '.github/workflows/skyanchor-candidate.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
  }
  const jobs = [
    {
      name: 'SkyAnchor exact candidate',
      conclusion: 'success',
      check_run_url: checks[0].url,
    },
  ]
  requireExactCheck(plan, pr, checks, run, jobs)
  assert.throws(() =>
    requireExactCheck(
      plan,
      {...pr, head: {...pr.head, sha: base}},
      checks,
      run,
      jobs,
    ),
  )
  assert.throws(() =>
    requireExactCheck(
      plan,
      {...pr, base: {...pr.base, ref: 'other'}},
      checks,
      run,
      jobs,
    ),
  )
  assert.throws(() =>
    requireExactCheck(plan, pr, [{...checks[0], app: {id: 1}}], run, jobs),
  )
  assert.throws(() =>
    requireExactCheck(
      plan,
      pr,
      checks,
      {...run, path: '.github/workflows/other.yml'},
      jobs,
    ),
  )
  assert.throws(() =>
    requireExactCheck(plan, pr, checks, run, [
      {...jobs[0], conclusion: 'skipped'},
    ]),
  )
})

test('Classifier never allows additions, escapes, protected docs or excessive prose', () => {
  const edit = {
    file: 'docs/build.md',
    status: 'M',
    mode: '100644',
    sameBase: true,
    added: 1,
    deleted: 1,
    plain: true,
  }
  assert.equal(classify([edit]), true)
  for (const change of [
    {file: '../docs/build.md'},
    {file: 'docs/skyanchor-release.md'},
    {status: 'A'},
    {mode: '120000'},
    {sameBase: false},
    {added: 41},
    {plain: false},
  ])
    assert.equal(classify([{...edit, ...change}]), false)
  assert.equal(classify([]), false)
})
