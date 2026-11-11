import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {isDeepStrictEqual} from 'node:util'
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
import {
  ownerMerge,
  requireMergedCommit,
} from '../scripts/skyanchor/owner-merge.mjs'

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
  owner: {type: 'User', login: 'MichaelEns', id: 44419611},
  permissions: {admin: true},
}
const actor = {type: 'User', login: 'MichaelEns', id: 44419611}
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

function ownerMergeFixture() {
  const main = 'a'.repeat(40)
  const head = 'b'.repeat(40)
  const merge = 'c'.repeat(40)
  const tree = 'd'.repeat(40)
  const env = {
    ...policy,
    SKYANCHOR_ADMIN_POLICY_ATTESTATION: JSON.stringify(attestation),
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: main,
    GITHUB_REPOSITORY: repository,
    GITHUB_REPOSITORY_ID: '1452249834',
    GITHUB_ACTOR: 'MichaelEns',
    GITHUB_ACTOR_ID: '44419611',
    GITHUB_TRIGGERING_ACTOR: 'MichaelEns',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/skyanchor-owner-merge.yml@refs/heads/main`,
    GITHUB_RUN_ID: '100',
    REVIEWED_PR: '7',
    EXPECTED_HEAD: head,
  }
  const event = {
    sender: actor,
    repository: info,
    ref: 'refs/heads/main',
    inputs: {pr_number: '7', expected_head: head},
  }
  const dispatch = {
    id: 100,
    run_attempt: 1,
    event: 'workflow_dispatch',
    path: '.github/workflows/skyanchor-owner-merge.yml',
    head_sha: main,
    head_branch: 'main',
    status: 'in_progress',
    repository: info,
    head_repository: info,
    actor,
    triggering_actor: actor,
  }
  const pr = {
    number: 7,
    state: 'open',
    draft: false,
    merged: false,
    mergeable: true,
    mergeable_state: 'clean',
    head: {sha: head, ref: 'fix/reviewed', repo: info},
    base: {sha: main, ref: 'main', repo: info},
  }
  const check = {
    id: 300,
    name: 'SkyAnchor exact candidate',
    head_sha: head,
    app: {id: 15368},
    status: 'completed',
    conclusion: 'success',
    url: `https://api.github.com/repos/${repository}/check-runs/300`,
    details_url: `https://github.com/${repository}/actions/runs/200/job/400`,
    check_suite: {id: 500},
  }
  const candidate = {
    id: 200,
    head_sha: head,
    head_branch: pr.head.ref,
    head_repository: info,
    repository: info,
    path: '.github/workflows/skyanchor-candidate.yml',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{number: 7}],
    check_suite_id: 500,
  }
  const job = {
    id: 400,
    name: check.name,
    status: 'completed',
    conclusion: 'success',
    check_run_url: check.url,
    steps: [
      {
        name: 'Run pnpm skyanchor:verify',
        status: 'completed',
        conclusion: 'success',
      },
    ],
  }
  const identity = {login: 'github-actions[bot]', id: 41898282, type: 'Bot'}
  const email = '41898282+github-actions[bot]@users.noreply.github.com'
  const commit = {
    sha: merge,
    author: identity,
    committer: identity,
    commit: {author: {email}, committer: {email}, tree: {sha: tree}},
    parents: [{sha: main}, {sha: head}],
  }
  const branch = {
    name: 'main',
    protected: true,
    protection: {
      enabled: true,
      required_status_checks: {
        ...protection.required_status_checks,
        enforcement_level: 'everyone',
        contexts: ['SkyAnchor exact candidate'],
      },
    },
    commit: {sha: main},
  }
  const values = {
    '': info,
    'branches/main': branch,
    'rules/branches/main': [],
    'git/ref/heads/main': {object: {sha: main}},
    'actions/runs/100': dispatch,
    'pulls/7': pr,
    [`commits/${head}/check-runs?filter=latest&per_page=100`]: {
      total_count: 1,
      check_runs: [check],
    },
    [`actions/workflows/skyanchor-candidate.yml/runs?head_sha=${head}&event=pull_request&per_page=100`]:
      {total_count: 1, workflow_runs: [candidate]},
    'actions/runs/200/jobs?filter=latest&per_page=100': {
      total_count: 1,
      jobs: [job],
    },
    [`commits/${head}`]: {sha: head, commit: {tree: {sha: tree}}},
    'pulls/7/merge': {merged: true, sha: merge},
    [`commits/${merge}`]: commit,
    [`contents/.github/workflows/skyanchor-candidate.yml?ref=${main}`]: {
      type: 'file',
      sha: 'e'.repeat(40),
    },
    [`contents/.github/workflows/skyanchor-candidate.yml?ref=${head}`]: {
      type: 'file',
      sha: 'e'.repeat(40),
    },
  }
  const calls = []
  let merged = false
  const request = async (endpoint, options = {}) => {
    calls.push({endpoint, ...options})
    if (!(endpoint in values)) throw new Error('Unexpected API endpoint')
    if (endpoint === 'pulls/7/merge') merged = values[endpoint].merged
    if (endpoint === 'pulls/7' && merged)
      return {...pr, merged: true, merge_commit_sha: merge}
    return structuredClone(values[endpoint])
  }
  return {
    env,
    event,
    main,
    head,
    merge,
    tree,
    dispatch,
    pr,
    check,
    candidate,
    job,
    commit,
    branch,
    values,
    calls,
    request,
  }
}

test('Owner-reviewed merge uses only the native protected exact-head PUT and verifies bot NoReply/tree/parents', async () => {
  const f = ownerMergeFixture()
  assert.throws(
    () =>
      requireExactCheck(
        {head: f.head, base: f.main},
        f.pr,
        [f.check],
        f.candidate,
        [f.job],
      ),
    /exact-head/,
  )
  assert.deepEqual(await ownerMerge(f.request, f.env, f.event, f.main), {
    pr: 7,
    head: f.head,
    merge: f.merge,
  })
  const writes = f.calls.filter(value => value.method)
  assert.deepEqual(writes, [
    {
      endpoint: 'pulls/7/merge',
      method: 'PUT',
      body: JSON.stringify({sha: f.head, merge_method: 'merge'}),
    },
  ])
  assert.equal(
    f.calls.filter(value => value.endpoint === 'branches/main').length,
    2,
  )
  assert.equal(
    f.calls.filter(
      value =>
        value.endpoint ===
        `commits/${f.head}/check-runs?filter=latest&per_page=100`,
    ).length,
    2,
  )
  assert.ok(
    !f.calls.some(value =>
      /protection|permissions|approval|\/user/.test(value.endpoint),
    ),
  )
})

test('Owner-reviewed merge refuses untrusted dispatch, changed policy/PR and incomplete or spoofed exact checks before any write', async () => {
  const changes = [
    f => {
      f.env.GITHUB_ACTIONS = 'false'
    },
    f => {
      f.env.GITHUB_EVENT_NAME = 'push'
    },
    f => {
      f.env.GITHUB_REF = 'refs/heads/fix/reviewed'
    },
    f => {
      f.env.GITHUB_ACTOR_ID = '1'
    },
    f => {
      f.env.GITHUB_ACTOR = 'someone'
    },
    f => {
      f.env.GITHUB_TRIGGERING_ACTOR = 'someone'
    },
    f => {
      f.env.GITHUB_REPOSITORY_ID = '1'
    },
    f => {
      f.env.GITHUB_WORKFLOW_REF = 'other/main'
    },
    f => {
      f.env.GITHUB_RUN_ATTEMPT = '2'
    },
    f => {
      f.env.REVIEWED_PR = '7; echo unsafe'
    },
    f => {
      f.env.EXPECTED_HEAD = 'x'.repeat(40)
    },
    f => {
      f.event.sender = {...actor, id: 1}
    },
    f => {
      f.event.inputs.expected_head = f.main
    },
    f => {
      f.dispatch.actor = {...actor, login: 'someone'}
    },
    f => {
      f.dispatch.head_sha = f.head
    },
    f => {
      f.dispatch.path = '.github/workflows/other.yml'
    },
    f => {
      f.dispatch.event = 'pull_request'
    },
    f => {
      f.dispatch.run_attempt = 2
    },
    f => {
      delete f.env.SKYANCHOR_ZERO_SPEND_VERIFIED
    },
    f => {
      delete f.env.SKYANCHOR_ZERO_SPEND_EVIDENCE
    },
    f => {
      delete f.env.SKYANCHOR_FORK_APPROVAL_VERIFIED
    },
    f => {
      delete f.env.SKYANCHOR_ADMIN_POLICY_ATTESTATION
    },
    f => {
      f.values[''] = {...info, private: true}
    },
    f => {
      f.values[''] = {...info, full_name: 'someone/other'}
    },
    f => {
      f.values[''] = {...info, fork: true}
    },
    f => {
      f.branch.protected = false
    },
    f => {
      f.branch.protection.required_status_checks.checks = []
    },
    f => {
      f.values['rules/branches/main'] = [{id: 1}]
    },
    f => {
      f.values['git/ref/heads/main'].object.sha = f.head
    },
    f => {
      f.pr.head = {...f.pr.head, repo: {...info, fork: true}}
    },
    f => {
      f.pr.head.sha = f.main
    },
    f => {
      f.pr.base.sha = f.head
    },
    f => {
      f.pr.base.ref = 'other'
    },
    f => {
      f.pr.draft = true
    },
    f => {
      f.pr.state = 'closed'
    },
    f => {
      f.pr.mergeable = null
    },
    f => {
      f.pr.mergeable_state = 'blocked'
    },
    f => {
      f.check.app.id = 1
    },
    f => {
      f.check.head_sha = f.main
    },
    f => {
      f.check.conclusion = 'failure'
    },
    f => {
      f.check.status = 'in_progress'
    },
    f => {
      f.check.details_url += 'spoofed'
    },
    f => {
      f.check.check_suite.id = 1
    },
    f => {
      f.candidate.path = '.github/workflows/other.yml'
    },
    f => {
      f.candidate.event = 'workflow_dispatch'
    },
    f => {
      f.candidate.head_sha = f.main
    },
    f => {
      f.candidate.conclusion = 'skipped'
    },
    f => {
      f.candidate.pull_requests = []
    },
    f => {
      f.job.conclusion = 'skipped'
    },
    f => {
      f.job.check_run_url = 'https://example.test/spoofed'
    },
    f => {
      f.job.status = 'in_progress'
    },
    f => {
      f.job.steps[0].conclusion = 'skipped'
    },
    f => {
      f.job.steps = []
    },
    f => {
      f.job.steps[0].name = 'Run echo success'
    },
    f => {
      f.values[
        `contents/.github/workflows/skyanchor-candidate.yml?ref=${f.head}`
      ].sha = f.head
    },
    f => {
      f.values['actions/runs/200/jobs?filter=latest&per_page=100'].total_count =
        101
    },
    f => {
      f.values[
        `commits/${f.head}/check-runs?filter=latest&per_page=100`
      ].total_count = 101
    },
    f => {
      f.values[
        `commits/${f.head}/check-runs?filter=latest&per_page=100`
      ].check_runs.push({...f.check})
    },
    f => {
      f.values[
        `actions/workflows/skyanchor-candidate.yml/runs?head_sha=${f.head}&event=pull_request&per_page=100`
      ].total_count = 101
    },
  ]
  for (const change of changes) {
    const f = ownerMergeFixture()
    change(f)
    await assert.rejects(
      () => ownerMerge(f.request, f.env, f.event, f.main),
      undefined,
      change.toString(),
    )
    assert.equal(
      f.calls.some(value => value.method),
      false,
      change.toString(),
    )
  }
})

test('Owner-reviewed merge rejects latest pending run, final base/head races, refused merges and post-merge identity/tree drift', async () => {
  const f = ownerMergeFixture()
  const listing =
    f.values[
      `actions/workflows/skyanchor-candidate.yml/runs?head_sha=${f.head}&event=pull_request&per_page=100`
    ]
  listing.total_count = 2
  listing.workflow_runs.push({
    ...f.candidate,
    id: 201,
    status: 'in_progress',
    conclusion: null,
  })
  f.values['actions/runs/201/jobs?filter=latest&per_page=100'] = {
    total_count: 1,
    jobs: [f.job],
  }
  await assert.rejects(() => ownerMerge(f.request, f.env, f.event, f.main))
  assert.equal(
    f.calls.some(value => value.method),
    false,
  )
  for (const target of ['branches/main', 'pulls/7']) {
    const race = ownerMergeFixture()
    let reads = 0
    await assert.rejects(() =>
      ownerMerge(
        async (endpoint, options) => {
          if (endpoint === target && ++reads === 2) {
            if (target === 'branches/main') race.branch.commit.sha = race.head
            else race.pr.head.sha = race.main
          }
          return race.request(endpoint, options)
        },
        race.env,
        race.event,
        race.main,
      ),
    )
    assert.equal(
      race.calls.some(value => value.method),
      false,
    )
  }
  const refused = ownerMergeFixture()
  refused.values['pulls/7/merge'].merged = false
  await assert.rejects(
    () => ownerMerge(refused.request, refused.env, refused.event, refused.main),
    /refused/,
  )
  const interrupted = ownerMergeFixture()
  await assert.rejects(
    () =>
      ownerMerge(
        async (endpoint, options) => {
          if (endpoint === 'pulls/7/merge')
            throw new Error('Synthetic interrupted response')
          return interrupted.request(endpoint, options)
        },
        interrupted.env,
        interrupted.event,
        interrupted.main,
      ),
    /outcome unconfirmed/,
  )
  const unreadable = ownerMergeFixture()
  await assert.rejects(
    () =>
      ownerMerge(
        async (endpoint, options) => {
          if (endpoint === `commits/${unreadable.merge}`)
            throw new Error('Synthetic unavailable readback')
          return unreadable.request(endpoint, options)
        },
        unreadable.env,
        unreadable.event,
        unreadable.main,
      ),
    /MERGE OCCURRED/,
  )
  for (const change of [
    commit => {
      commit.author.id = 1
    },
    commit => {
      commit.commit.author.email = 'person@example.test'
    },
    commit => {
      commit.commit.committer.email = 'person@example.test'
    },
    commit => {
      commit.parents.reverse()
    },
    commit => {
      commit.commit.tree.sha = 'e'.repeat(40)
    },
  ]) {
    const invalid = ownerMergeFixture()
    change(invalid.commit)
    await assert.rejects(
      () =>
        ownerMerge(invalid.request, invalid.env, invalid.event, invalid.main),
      /MERGE OCCURRED/,
    )
  }
  const web = ownerMergeFixture()
  web.commit.committer = {login: 'web-flow', id: 19864447}
  web.commit.commit.committer.email = 'noreply@github.com'
  requireMergedCommit(
    web.commit,
    {merged: true, sha: web.merge},
    web.head,
    web.main,
    web.tree,
  )
})

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
    '/user': actor,
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

test('Personal owner setup classifies unsupported bypass explicitly and remains compatible with published runtime', async () => {
  const personalProtection = {
    ...protection,
    restrictions: null,
    required_status_checks: {
      ...protection.required_status_checks,
      contexts: ['SkyAnchor exact candidate'],
    },
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      require_last_push_approval: false,
      required_approving_review_count: 0,
    },
  }
  const replies = {
    '': info,
    '/user': actor,
    'branches/main/protection': personalProtection,
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
  const verified = await verifyOwnerSetup(
    request,
    `https://github.com/${repository}/issues/2`,
  )
  assert.equal(
    verified.ownerVerification.bypassAllowances,
    'not-applicable-personal-api-unsupported',
  )
  assert.match(
    verified.ownerVerification.effectiveAllowanceRepresentation,
    /Derived empty sets.*API field absent/,
  )
  assert.equal(
    Object.hasOwn(
      personalProtection.required_pull_request_reviews,
      'bypass_pull_request_allowances',
    ),
    false,
  )
  requirePublicPolicy(info, policy, verified)
  const published = gitAt(process.cwd(), [
    'show',
    'fb76bfb70177a2e6c85675441669926d713c87b9:scripts/skyanchor/upstream.mjs',
  ])
  const start = published.indexOf('export function requireMainProtection(')
  const end = published.indexOf('export async function verifyOwnerSetup(')
  assert.ok(start >= 0 && end > start)
  const publishedValidator = new Function(
    'repository',
    'repositoryId',
    'context',
    'isDeepStrictEqual',
    published.slice(start, end).replaceAll('export function ', 'function ') +
      '\nreturn requirePublicPolicy;',
  )(repository, info.id, 'SkyAnchor exact candidate', isDeepStrictEqual)
  publishedValidator(info, policy, verified)
  const main = 'a'.repeat(40)
  const live = {
    '': info,
    'branches/main': {
      name: 'main',
      commit: {sha: main},
      protected: true,
      protection: {
        enabled: true,
        required_status_checks: {
          enforcement_level: 'everyone',
          contexts: ['SkyAnchor exact candidate'],
          checks: [{context: 'SkyAnchor exact candidate', app_id: 15368}],
        },
      },
    },
    'rules/branches/main': [],
    'git/ref/heads/main': {object: {sha: main}},
  }
  await verifyRuntimePolicy(
    async endpoint => {
      assert.ok(Object.hasOwn(live, endpoint), endpoint)
      return live[endpoint]
    },
    {...policy, SKYANCHOR_ADMIN_POLICY_ATTESTATION: JSON.stringify(verified)},
    main,
  )
  assert.throws(
    () =>
      publishedValidator(info, policy, {
        ...verified,
        protection: personalProtection,
      }),
    /protection/,
  )
  for (const owner of [
    {type: 'Organization', login: 'MichaelEns', id: 44419611},
    {login: 'MichaelEns', id: 44419611},
    {...info.owner, id: 1},
    {...info.owner, login: 'other'},
  ]) {
    replies[''] = {...info, owner}
    await assert.rejects(
      () => verifyOwnerSetup(request, verified.evidence),
      /personal owner/,
    )
    assert.throws(
      () =>
        requireMainProtection(personalProtection, {info: replies[''], actor}),
      /personal owner/,
    )
  }
  replies[''] = info
  for (const change of [
    {id: 1},
    {full_name: 'example/other'},
    {permissions: {admin: false}},
    {permissions: undefined},
  ]) {
    replies[''] = {...info, ...change}
    await assert.rejects(
      () => verifyOwnerSetup(request, verified.evidence),
      /personal owner/,
    )
  }
  replies[''] = info
  for (const changedActor of [
    {...actor, id: 1},
    {...actor, type: 'Organization'},
    undefined,
  ]) {
    replies['/user'] = changedActor
    await assert.rejects(
      () => verifyOwnerSetup(request, verified.evidence),
      /personal owner/,
    )
  }
  replies['/user'] = actor
  assert.throws(() => requireMainProtection(personalProtection), /protection/)
  requireMainProtection(protection)
  for (const bypass of [
    null,
    {},
    {users: [], teams: []},
    {users: ['owner'], teams: [], apps: []},
    {users: [], teams: [], apps: ['app']},
    {users: [], teams: [], apps: [], unknown: []},
  ]) {
    replies['branches/main/protection'] = {
      ...personalProtection,
      required_pull_request_reviews: {
        ...personalProtection.required_pull_request_reviews,
        bypass_pull_request_allowances: bypass,
      },
    }
    await assert.rejects(
      () => verifyOwnerSetup(request, verified.evidence),
      /protection/,
    )
  }
  for (const change of [
    {enforce_admins: {enabled: false}},
    {
      required_status_checks: {
        ...personalProtection.required_status_checks,
        strict: false,
      },
    },
    {
      required_status_checks: {
        ...personalProtection.required_status_checks,
        checks: [{context: 'SkyAnchor exact candidate', app_id: 1}],
      },
    },
    {allow_force_pushes: {enabled: true}},
    {allow_deletions: {enabled: true}},
    {allow_fork_syncing: {enabled: true}},
    {restrictions: {users: []}},
  ]) {
    replies['branches/main/protection'] = {...personalProtection, ...change}
    await assert.rejects(
      () => verifyOwnerSetup(request, verified.evidence),
      /protection/,
    )
  }
  replies['branches/main/protection'] = personalProtection
  for (const endpoint of [
    'rulesets?includes_parents=true',
    'rules/branches/main',
  ]) {
    replies[endpoint] = [{id: 1}]
    await assert.rejects(
      () => verifyOwnerSetup(request, verified.evidence),
      /ruleset/,
    )
    replies[endpoint] = []
  }
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
