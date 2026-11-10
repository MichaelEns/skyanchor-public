import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {isDeepStrictEqual} from 'node:util'
import {verifyPublication} from './publication.mjs'

export const repository = 'MichaelEns/skyanchor-public'
const repositoryId = 1452249834
const official = 'https://github.com/bluesky-social/social-app.git'
const provenancePath = 'scripts/skyanchor/upstream-provenance.json'
const context = 'SkyAnchor exact candidate'
const bot = '41898282+github-actions[bot]@users.noreply.github.com'
const sha = /^[0-9a-f]{40}$/
const tagPattern = /^(\d+)\.(\d+)\.(\d+)$/
export const digest = data => createHash('sha256').update(data).digest('hex')

export function gitAt(root, args, options = {}) {
  const {raw = false, ...spawnOptions} = options
  const result = spawnSync('git', ['--no-replace-objects', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...spawnOptions,
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`Git ${args[0]} failed: ${result.stderr}`)
  return raw ? result.stdout : result.stdout.trimEnd()
}
const git = (...args) => gitAt(process.cwd(), args)

export function latestRelease(lines) {
  const releases = new Map()
  for (const line of lines.split(/\r?\n/)) {
    const match =
      /^([0-9a-f]{40})\s+refs\/tags\/(\d+\.\d+\.\d+)(\^\{\})?$/.exec(line)
    if (match && (match[3] || !releases.has(match[2])))
      releases.set(match[2], match[1])
  }
  const names = [...releases.keys()].sort((a, b) => {
    const left = tagPattern.exec(a).slice(1).map(Number)
    const right = tagPattern.exec(b).slice(1).map(Number)
    for (let i = 0; i < 3; i++)
      if (left[i] !== right[i]) return right[i] - left[i]
    return 0
  })
  if (!names.length) throw new Error('No official stable release tag found')
  return {tag: names[0], upstream: releases.get(names[0])}
}

export function requireReleasePin(lines, pin) {
  if (
    pin.schemaVersion !== 1 ||
    pin.repository !== 'bluesky-social/social-app' ||
    pin.license !== 'MIT' ||
    !tagPattern.test(pin.tag) ||
    !sha.test(pin.upstream)
  )
    throw new Error('Invalid public upstream provenance')
  const selected = latestRelease(
    lines
      .split(/\r?\n/)
      .filter(
        line =>
          line.split(/\s+/)[1]?.replace(/\^\{\}$/, '') ===
          `refs/tags/${pin.tag}`,
      )
      .join('\n'),
  )
  if (selected.upstream !== pin.upstream)
    throw new Error('Pinned official tag drift')
}

/* Deliberately narrow: edits to existing plain public build documentation only. */
export function classify(changes) {
  return (
    changes.length > 0 &&
    changes.every(
      entry =>
        entry.status === 'M' &&
        entry.mode === '100644' &&
        /^docs\/(?:build|testing)\.md$/.test(entry.file) &&
        entry.sameBase === true &&
        entry.added + entry.deleted <= 40 &&
        entry.added + entry.deleted > 0 &&
        entry.plain === true,
    )
  )
}

function plainDocumentation(text) {
  return (
    Buffer.byteLength(text) <= 128 * 1024 &&
    !/[^\x09\x0a\x20-\x7e]/.test(text) &&
    !/[\0\r`]|<|>|!?\[|https?:|javascript:|data:|~~~|\$\{|\$\(|(?:^|\n)(?: {4}|\t)|(?:^|\n)\s*(?:run:|uses:|curl |wget |sudo |npm |pnpm |node |bash |powershell )/i.test(
      text,
    )
  )
}

function fencedContent(text) {
  const contents = []
  let marker
  for (const line of text.split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      contents.push(line)
      if (fence && fence[0] === marker[0] && fence.length >= marker.length)
        marker = undefined
    } else if (fence) {
      marker = fence
      contents.push(line)
    }
  }
  return marker ? null : contents
}

function trivialDocumentation(oldText, newText, edits) {
  const oldFences = fencedContent(oldText)
  const newFences = fencedContent(newText)
  return (
    plainDocumentation(edits) &&
    oldFences !== null &&
    newFences !== null &&
    isDeepStrictEqual(oldFences, newFences) &&
    isDeepStrictEqual(
      oldText.match(/[a-zA-Z0-9]+/g),
      newText.match(/[a-zA-Z0-9]+/g),
    )
  )
}

export function reconstruct(root, base, release) {
  const g = (...args) => gitAt(root, args)
  const raw = (...args) => gitAt(root, args, {raw: true})
  if (
    !sha.test(base) ||
    !sha.test(release.upstream) ||
    !tagPattern.test(release.tag)
  )
    throw new Error('Invalid candidate identity')
  if (
    g('rev-parse', 'HEAD') !== base ||
    g('status', '--porcelain', '--untracked-files=no')
  )
    throw new Error('Main advanced or tracked tree is dirty')
  const previous = JSON.parse(g('show', `${base}:${provenancePath}`))
  if (!sha.test(previous.upstream)) throw new Error('Invalid previous pin')
  const value = {
    ...release,
    previous: previous.upstream,
    base,
    updates: previous.upstream !== release.upstream,
  }
  if (!value.updates) return {...value, trivial: false}
  const records = g(
    'diff',
    '--raw',
    '--no-abbrev',
    '--no-renames',
    previous.upstream,
    release.upstream,
  )
    .split('\n')
    .filter(Boolean)
  const changes = records.map(record => {
    const match =
      /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.+)$/.exec(
        record,
      )
    if (!match) throw new Error('Unrecognized upstream path record')
    const [, oldMode, mode, oldBlob, newBlob, status, file] = match
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(file) ||
      file.split('/').some(part => !part || part === '.' || part === '..')
    )
      throw new Error('Unsafe upstream path')
    const existing = g('ls-tree', base, '--', file)
    const sameBase = existing === `${oldMode} blob ${oldBlob}\t${file}`
    const stats = g(
      'diff',
      '--numstat',
      '--no-renames',
      previous.upstream,
      release.upstream,
      '--',
      file,
    ).split('\t')
    const patch = raw(
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--unified=0',
      previous.upstream,
      release.upstream,
      '--',
      file,
    )
    const edits = patch
      .split('\n')
      .filter(
        line => /^[+-]/.test(line) && !/^(?:--- a\/|\+\+\+ b\/)/.test(line),
      )
      .map(line => line.slice(1))
      .join('\n')
    const eligible =
      status === 'M' &&
      mode === '100644' &&
      sameBase &&
      /^docs\/(?:build|testing)\.md$/.test(file)
    const plain =
      eligible &&
      trivialDocumentation(
        raw('show', `${previous.upstream}:${file}`),
        raw('show', `${release.upstream}:${file}`),
        edits,
      )
    return {
      file,
      mode,
      status,
      sameBase,
      added: Number(stats[0]),
      deleted: Number(stats[1]),
      plain,
      newBlob,
    }
  })
  value.trivial = classify(changes)
  value.changeCount = changes.length
  value.pathsSha256 = digest(
    JSON.stringify(changes.map(({file, status}) => ({file, status}))),
  )
  if (!value.trivial) return value
  const patch = raw(
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--binary',
    previous.upstream,
    release.upstream,
    '--',
    ...changes.map(entry => entry.file),
  )
  value.patch = digest(patch)
  const index = path.join(root, '.git', 'skyanchor-candidate-index')
  if (fs.existsSync(index)) throw new Error('Candidate index already exists')
  const options = {env: {...process.env, GIT_INDEX_FILE: index}}
  try {
    gitAt(root, ['read-tree', base], options)
    for (const entry of changes)
      gitAt(
        root,
        [
          'update-index',
          '--cacheinfo',
          `100644,${entry.newBlob},${entry.file}`,
        ],
        options,
      )
    const updated = {...previous, tag: release.tag, upstream: release.upstream}
    const metadata = JSON.stringify(updated, null, 2) + '\n'
    const blob = gitAt(root, ['hash-object', '-w', '--stdin'], {
      input: metadata,
    })
    gitAt(
      root,
      ['update-index', '--cacheinfo', `100644,${blob},${provenancePath}`],
      options,
    )
    value.tree = gitAt(root, ['write-tree'], options)
    const timestamp = `${Number(g('show', '-s', '--format=%ct', base)) + 1} +0000`
    value.head = gitAt(root, ['commit-tree', value.tree, '-p', base], {
      input: `SkyAnchor: official ${release.tag} trivial documentation\n`,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'github-actions[bot]',
        GIT_AUTHOR_EMAIL: bot,
        GIT_COMMITTER_NAME: 'github-actions[bot]',
        GIT_COMMITTER_EMAIL: bot,
        GIT_AUTHOR_DATE: timestamp,
        GIT_COMMITTER_DATE: timestamp,
      },
    })
    return value
  } finally {
    if (fs.existsSync(index)) fs.unlinkSync(index)
  }
}

export function requireMainProtection(protection) {
  const checks = protection?.required_status_checks
  const bypass =
    protection?.required_pull_request_reviews?.bypass_pull_request_allowances
  if (
    checks?.strict !== true ||
    !Array.isArray(checks.checks) ||
    checks.checks.length !== 1 ||
    checks.checks[0].context !== context ||
    checks.checks[0].app_id !== 15368 ||
    protection.enforce_admins?.enabled !== true ||
    protection.allow_force_pushes?.enabled !== false ||
    protection.allow_deletions?.enabled !== false ||
    protection.allow_fork_syncing?.enabled !== false ||
    protection.required_pull_request_reviews
      ?.required_approving_review_count !== 0 ||
    !bypass ||
    Object.keys(bypass).sort().join(',') !== 'apps,teams,users' ||
    Object.values(bypass).some(
      value => !Array.isArray(value) || value.length,
    ) ||
    protection.restrictions != null
  )
    throw new Error('Strict app-bound protection without bypass is required')
}

export function requirePublicPolicy(info, variables, attestation) {
  if (
    !info ||
    !variables ||
    info.full_name !== repository ||
    info.id !== repositoryId ||
    info.private !== false ||
    info.visibility !== 'public' ||
    info.fork !== false ||
    info.default_branch !== 'main' ||
    info.archived !== false ||
    variables.SKYANCHOR_AUTOMATION_ENABLED !== 'true' ||
    variables.SKYANCHOR_ZERO_SPEND_VERIFIED !== 'true' ||
    !/^https:\/\/github\.com\/MichaelEns\/skyanchor-public\/issues\/[1-9]\d*$/.test(
      variables.SKYANCHOR_ZERO_SPEND_EVIDENCE || '',
    ) ||
    variables.SKYANCHOR_FORK_APPROVAL_VERIFIED !== 'true'
  )
    throw new Error(
      'Public binding, verified hard-zero budget and fork approval evidence required',
    )
  if (
    attestation?.schemaVersion !== 1 ||
    attestation.repository !== repository ||
    attestation.repositoryId !== repositoryId ||
    attestation.defaultBranch !== 'main' ||
    attestation.forkApprovalPolicy !== 'all_external_contributors' ||
    !isDeepStrictEqual(attestation.additionalRulesets, []) ||
    !/^https:\/\/github\.com\/MichaelEns\/skyanchor-public\/issues\/[1-9]\d*$/.test(
      attestation.evidence || '',
    )
  )
    throw new Error('Owner-admin setup attestation required')
  requireMainProtection(attestation.protection)
}

export async function verifyOwnerSetup(request, evidence) {
  const info = await request('')
  const raw = await request('branches/main/protection')
  requireMainProtection(raw)
  const fork = await request('actions/permissions/fork-pr-contributor-approval')
  const rulesets = await request('rulesets?includes_parents=true')
  const rules = await request('rules/branches/main')
  if (!isDeepStrictEqual(rulesets, []) || !isDeepStrictEqual(rules, []))
    throw new Error('Unreviewed additional ruleset; owner review required')
  const protection = Object.fromEntries(
    [
      'required_status_checks',
      'enforce_admins',
      'allow_force_pushes',
      'allow_deletions',
      'allow_fork_syncing',
      'required_pull_request_reviews',
      'restrictions',
    ].map(key => [key, raw[key] ?? null]),
  )
  const attestation = {
    schemaVersion: 1,
    repository,
    repositoryId: info.id,
    defaultBranch: info.default_branch,
    protection,
    forkApprovalPolicy: fork.approval_policy,
    additionalRulesets: rulesets,
    evidence,
  }
  requirePublicPolicy(
    info,
    {
      SKYANCHOR_AUTOMATION_ENABLED: 'true',
      SKYANCHOR_ZERO_SPEND_VERIFIED: 'true',
      SKYANCHOR_ZERO_SPEND_EVIDENCE: evidence,
      SKYANCHOR_FORK_APPROVAL_VERIFIED: 'true',
    },
    attestation,
  )
  return attestation
}

export async function verifyRuntimePolicy(request, variables, main) {
  const info = await request('')
  const attestation = JSON.parse(
    variables.SKYANCHOR_ADMIN_POLICY_ATTESTATION || 'null',
  )
  requirePublicPolicy(info, variables, attestation)
  const branch = await request('branches/main')
  const checks = branch.protection?.required_status_checks
  if (
    branch.name !== 'main' ||
    branch.protected !== true ||
    branch.protection?.enabled !== true ||
    checks?.enforcement_level !== 'everyone' ||
    !isDeepStrictEqual(checks.contexts, [context]) ||
    !isDeepStrictEqual(checks.checks, [{context, app_id: 15368}])
  )
    throw new Error(
      'Live public app-bound branch protection unavailable or changed',
    )
  const rules = await request('rules/branches/main')
  if (!isDeepStrictEqual(rules, []))
    throw new Error('Unreviewed additional ruleset; owner review required')
  if (
    branch.commit?.sha !== main ||
    (await request('git/ref/heads/main')).object?.sha !== main
  )
    throw new Error('Main advanced')
}

async function api(endpoint, options = {}) {
  if (!process.env.GH_TOKEN) throw new Error('Scoped workflow token required')
  const response = await fetch(
    `https://api.github.com/repos/${repository}${endpoint ? '/' + endpoint : ''}`,
    {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
    },
  )
  if (!response.ok)
    throw new Error(
      `GitHub ${endpoint.split('?')[0]} failed: HTTP ${response.status}`,
    )
  return response.status === 204 ? null : response.json()
}

async function policy(trustedMain = true) {
  if (!process.env.GH_TOKEN) throw new Error('Scoped workflow token required')
  if (
    process.env.GITHUB_REPOSITORY !== repository ||
    (trustedMain && process.env.GITHUB_REF !== 'refs/heads/main')
  )
    throw new Error('Trusted public main workflow required')
  await verifyRuntimePolicy(api, process.env, git('rev-parse', 'HEAD'))
}

async function discover() {
  const base = git('rev-parse', 'HEAD')
  verifyPublication(process.cwd(), base)
  const previous = JSON.parse(git('show', `${base}:${provenancePath}`))
  const lines = git('ls-remote', '--tags', official)
  requireReleasePin(lines, previous)
  const release = latestRelease(lines)
  for (const upstream of new Set([previous.upstream, release.upstream]))
    git(
      'fetch',
      '--depth=1',
      '--no-tags',
      '--no-write-fetch-head',
      official,
      `${upstream}:refs/skyanchor/public-${upstream}`,
    )
  return reconstruct(process.cwd(), base, release)
}

export function requireReceipt(plan, receipt, commands) {
  if (
    !receipt ||
    typeof receipt !== 'object' ||
    receipt.passed !== true ||
    receipt.head !== plan.head ||
    receipt.tree !== plan.tree ||
    !/^[0-9a-f]{64}$/.test(receipt.inputs || '') ||
    !/^[0-9a-f]{64}$/.test(receipt.artifacts || '') ||
    !isDeepStrictEqual(
      receipt.commands,
      commands.map(command => ({command, exit: 0})),
    )
  )
    throw new Error('Exact readonly full-gate receipt mismatch')
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT)
    throw new Error('Workflow output channel required')
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${name}=${JSON.stringify(value)}\n`,
  )
}
async function notify(plan) {
  const title = `Official ${plan.tag}: manual review required`
  const issues = await api(
    'issues?state=all&per_page=100&creator=github-actions%5Bbot%5D',
  )
  const marker = `<!-- skyanchor-upstream:${plan.upstream} -->`
  if (issues.some(issue => issue.body?.includes(marker))) return
  if (issues.length === 100)
    throw new Error('Notification inventory needs pagination review')
  await api('issues', {
    method: 'POST',
    body: JSON.stringify({
      title,
      body: `${marker}\nPublic upstream ${plan.upstream} against ${plan.base} is outside verified trivial scope. Owner review and a fresh exact gate are required. No approval or merge was generated.`,
    }),
  })
}

async function publish(plan) {
  const expected = JSON.parse(process.env.SKYANCHOR_PLAN || 'null')
  if (!isDeepStrictEqual(plan, expected))
    throw new Error('Candidate changed since readonly verification')
  if (!plan.updates) return
  if (!plan.trivial) return notify(plan)
  const {releaseCommands} = await import('./release-commands.mjs')
  requireReceipt(
    plan,
    JSON.parse(process.env.SKYANCHOR_RECEIPT || 'null'),
    releaseCommands,
  )
  await policy()
  const branch = `skyanchor/upstream-${plan.upstream}`
  const remote = `https://github.com/${repository}.git`
  const existing = git('ls-remote', remote, `refs/heads/${branch}`)
  if (existing && existing.split(/\s+/)[0] !== plan.head)
    throw new Error('Candidate branch head changed')
  if (!existing) {
    const authorization = Buffer.from(
      `x-access-token:${process.env.GH_TOKEN}`,
    ).toString('base64')
    gitAt(
      process.cwd(),
      ['push', remote, `${plan.head}:refs/heads/${branch}`],
      {
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}`,
        },
      },
    )
  }
  let prs = await api(`pulls?state=open&base=main&head=MichaelEns:${branch}`)
  if (!prs.length) {
    await api('pulls', {
      method: 'POST',
      body: JSON.stringify({
        head: branch,
        base: 'main',
        title: `Official ${plan.tag}: trivial documentation`,
        body: `Verified exact head: ${plan.head}\nBase: ${plan.base}\nTree: ${plan.tree}\nPatch SHA256: ${plan.patch}\n\nOnly plain existing upstream docs and owned provenance changed. No self-approval. A separate exact-head check is required before landing.`,
      }),
    })
    prs = await api(`pulls?state=open&base=main&head=MichaelEns:${branch}`)
  }
  if (
    prs.length !== 1 ||
    prs[0].head.sha !== plan.head ||
    prs[0].base.sha !== plan.base
  )
    throw new Error('PR head or base changed')
  const runs = await api(
    `actions/workflows/skyanchor-candidate.yml/runs?head_sha=${plan.head}&event=workflow_dispatch&per_page=100`,
  )
  if (!runs.workflow_runs.length)
    await api('actions/workflows/skyanchor-candidate.yml/dispatches', {
      method: 'POST',
      body: JSON.stringify({ref: branch}),
    })
}

export function requireExactCheck(plan, pr, checks, run, jobs) {
  const matching = checks.filter(check => check.name === context)
  if (
    pr.head.sha !== plan.head ||
    pr.base.sha !== plan.base ||
    pr.base.ref !== 'main' ||
    pr.head.ref !== `skyanchor/upstream-${plan.upstream}` ||
    pr.head.repo.full_name !== repository ||
    pr.base.repo.full_name !== repository ||
    pr.draft !== false ||
    pr.state !== 'open' ||
    pr.mergeable !== true ||
    matching.length !== 1 ||
    matching[0].head_sha !== plan.head ||
    matching[0].app?.id !== 15368 ||
    matching[0].status !== 'completed' ||
    matching[0].conclusion !== 'success' ||
    run.head_sha !== plan.head ||
    run.head_repository?.full_name !== repository ||
    run.head_branch !== pr.head.ref ||
    run.path !== '.github/workflows/skyanchor-candidate.yml' ||
    run.event !== 'workflow_dispatch' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    jobs.length !== 1 ||
    jobs[0].name !== context ||
    jobs[0].conclusion !== 'success' ||
    jobs[0].check_run_url !== matching[0].url
  )
    throw new Error('Independent exact-head Actions gate is missing or changed')
}

async function land(plan) {
  if (!plan.updates || !plan.trivial) return
  const branch = `skyanchor/upstream-${plan.upstream}`
  const prs = await api(`pulls?state=open&base=main&head=MichaelEns:${branch}`)
  if (!prs.length) return
  if (prs.length !== 1) throw new Error('Ambiguous candidate PR')
  const pr = await api(`pulls/${prs[0].number}`)
  const checks = await api(`commits/${plan.head}/check-runs?per_page=100`)
  const runs = await api(
    `actions/workflows/skyanchor-candidate.yml/runs?head_sha=${plan.head}&event=workflow_dispatch&per_page=100`,
  )
  if (
    !runs.workflow_runs.length ||
    runs.workflow_runs[0].status !== 'completed'
  )
    return
  if (checks.total_count > 100 || runs.total_count > 100)
    throw new Error('Ambiguous check inventory')
  const run = runs.workflow_runs[0]
  const jobs = await api(
    `actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
  )
  requireExactCheck(plan, pr, checks.check_runs, run, jobs.jobs)
  await policy()
  const fresh = await discover()
  if (!isDeepStrictEqual(fresh, plan))
    throw new Error('Release or main changed before merge')
  const result = await api(`pulls/${pr.number}/merge`, {
    method: 'PUT',
    body: JSON.stringify({sha: plan.head, merge_method: 'merge'}),
  })
  if (result.merged !== true)
    throw new Error('Protected exact-head merge refused')
  return true
}

async function main(action) {
  if (action === 'verify-setup') {
    if (process.env.GITHUB_ACTIONS)
      throw new Error('Owner-admin verification must run outside Actions')
    console.log(
      JSON.stringify(
        await verifyOwnerSetup(
          api,
          process.env.SKYANCHOR_ADMIN_POLICY_EVIDENCE,
        ),
      ),
    )
    return
  }
  try {
    await policy(action !== 'candidate-policy')
    if (action === 'policy' || action === 'candidate-policy') return
    const plan = await discover()
    if (action === 'inspect') output('plan', plan)
    else if (action === 'prepare') {
      if (
        !plan.trivial ||
        !isDeepStrictEqual(
          plan,
          JSON.parse(process.env.SKYANCHOR_PLAN || 'null'),
        )
      )
        throw new Error('Candidate changed or is not trivial')
      git('switch', '--detach', plan.head)
      verifyPublication(process.cwd(), plan.head)
    } else if (action === 'publish') {
      if (
        !isDeepStrictEqual(
          plan,
          JSON.parse(process.env.SKYANCHOR_PLAN || 'null'),
        )
      )
        throw new Error('Candidate changed since inspection')
      if (plan.trivial) {
        const {releaseCommands} = await import('./release-commands.mjs')
        requireReceipt(
          plan,
          JSON.parse(process.env.SKYANCHOR_RECEIPT || 'null'),
          releaseCommands,
        )
      }
      if (!(await land(plan))) await publish(plan)
    } else
      throw new Error(
        'Expected policy, candidate-policy, inspect, prepare or publish',
      )
  } finally {
    for (const ref of git(
      'for-each-ref',
      '--format=%(refname)',
      'refs/skyanchor/public-*',
    )
      .split('\n')
      .filter(Boolean))
      git('update-ref', '-d', ref)
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv[2])
