import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  api,
  gitAt,
  repository,
  requireExactCheck,
  verifyRuntimePolicy,
} from './upstream.mjs'

const sha = /^[0-9a-f]{40}$/
const positiveId = value => Number.isSafeInteger(value) && value > 0
const workflow = '.github/workflows/skyanchor-owner-merge.yml'
const bot = {login: 'github-actions[bot]', id: 41898282}
const botEmail = '41898282+github-actions[bot]@users.noreply.github.com'
const owner = actor =>
  actor?.login === 'MichaelEns' &&
  actor.id === 44419611 &&
  actor.type === 'User'
const boundRepo = repo =>
  repo?.id === 1452249834 &&
  repo.full_name === repository &&
  repo.private === false &&
  repo.fork === false

export function requireDispatch(env, event, run, main) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_SHA !== main ||
    !sha.test(main) ||
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REPOSITORY_ID !== '1452249834' ||
    env.GITHUB_ACTOR !== 'MichaelEns' ||
    env.GITHUB_ACTOR_ID !== '44419611' ||
    env.GITHUB_TRIGGERING_ACTOR !== 'MichaelEns' ||
    env.GITHUB_RUN_ATTEMPT !== '1' ||
    env.GITHUB_WORKFLOW_REF !== `${repository}/${workflow}@refs/heads/main` ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID || '') ||
    !positiveId(Number(env.GITHUB_RUN_ID)) ||
    !/^[1-9]\d*$/.test(env.REVIEWED_PR || '') ||
    !Number.isSafeInteger(Number(env.REVIEWED_PR)) ||
    !sha.test(env.EXPECTED_HEAD || '') ||
    !owner(event.sender) ||
    !boundRepo(event.repository) ||
    !owner(event.repository.owner) ||
    event.repository.default_branch !== 'main' ||
    event.ref !== 'refs/heads/main' ||
    event.inputs?.pr_number !== env.REVIEWED_PR ||
    event.inputs?.expected_head !== env.EXPECTED_HEAD ||
    run.id !== Number(env.GITHUB_RUN_ID) ||
    run.run_attempt !== 1 ||
    run.event !== 'workflow_dispatch' ||
    run.path !== workflow ||
    run.head_sha !== main ||
    run.head_branch !== 'main' ||
    run.status !== 'in_progress' ||
    !boundRepo(run.repository) ||
    !boundRepo(run.head_repository) ||
    !owner(run.actor) ||
    !owner(run.triggering_actor)
  )
    throw new Error(
      'Fresh canonical owner dispatch on trusted public main required',
    )
}

function inventory(value, key) {
  if (
    !Number.isSafeInteger(value.total_count) ||
    value.total_count < 1 ||
    value.total_count > 100 ||
    !Array.isArray(value[key]) ||
    value[key].length !== value.total_count
  )
    throw new Error('Incomplete or ambiguous Actions inventory')
  return value[key]
}

function requirePR(pr, number, head, main) {
  if (
    pr.number !== number ||
    pr.state !== 'open' ||
    pr.draft !== false ||
    pr.head?.sha !== head ||
    pr.base?.sha !== main ||
    pr.base.ref !== 'main' ||
    !boundRepo(pr.head.repo) ||
    !boundRepo(pr.base.repo) ||
    !owner(pr.head.repo.owner) ||
    !owner(pr.base.repo.owner) ||
    pr.head.ref === 'main' ||
    typeof pr.head.ref !== 'string' ||
    pr.mergeable !== true ||
    pr.mergeable_state !== 'clean' ||
    pr.merged !== false
  )
    throw new Error(
      'Open mergeable same-repository exact-head PR on current main required',
    )
}

export function requireMergedCommit(commit, result, head, main, tree) {
  const isBot = actor =>
    actor?.login === bot.login && actor.id === bot.id && actor.type === 'Bot'
  const committer = commit.commit?.committer
  const botCommitter = isBot(commit.committer) && committer?.email === botEmail
  const webCommitter =
    commit.committer?.login === 'web-flow' &&
    commit.committer.id === 19864447 &&
    committer?.email === 'noreply@github.com'
  if (
    result.merged !== true ||
    !sha.test(result.sha || '') ||
    commit.sha !== result.sha ||
    !isBot(commit.author) ||
    commit.commit?.author?.email !== botEmail ||
    (!botCommitter && !webCommitter) ||
    commit.parents?.length !== 2 ||
    commit.parents[0].sha !== main ||
    commit.parents[1].sha !== head ||
    !sha.test(tree || '') ||
    commit.commit?.tree?.sha !== tree
  )
    throw new Error(
      'MERGE MAY HAVE OCCURRED: bot NoReply identity, parents or approved tree verification failed; owner inspection required',
    )
}

export async function ownerMerge(request, env, event, main) {
  const run = await request(`actions/runs/${env.GITHUB_RUN_ID}`)
  requireDispatch(env, event, run, main)
  await verifyRuntimePolicy(request, env, main)
  const number = Number(env.REVIEWED_PR)
  const head = env.EXPECTED_HEAD
  const endpoint = `pulls/${number}`
  const gate = '.github/workflows/skyanchor-candidate.yml'
  const trustedGate = await request(`contents/${gate}?ref=${main}`)
  const candidateGate = await request(`contents/${gate}?ref=${head}`)
  if (
    trustedGate.type !== 'file' ||
    candidateGate.type !== 'file' ||
    !sha.test(trustedGate.sha || '') ||
    candidateGate.sha !== trustedGate.sha
  )
    throw new Error(
      'Candidate workflow differs from trusted main; manual owner path required',
    )
  async function exact() {
    const pr = await request(endpoint)
    requirePR(pr, number, head, main)
    const checks = inventory(
      await request(`commits/${head}/check-runs?filter=latest&per_page=100`),
      'check_runs',
    )
    const runs = inventory(
      await request(
        `actions/workflows/skyanchor-candidate.yml/runs?head_sha=${head}&event=pull_request&per_page=100`,
      ),
      'workflow_runs',
    )
    if (
      runs.some(value => !positiveId(value.id)) ||
      new Set(runs.map(value => value.id)).size !== runs.length
    )
      throw new Error('Ambiguous candidate runs')
    const candidate = runs.reduce((latest, value) =>
      value.id > latest.id ? value : latest,
    )
    const jobs = inventory(
      await request(
        `actions/runs/${candidate.id}/jobs?filter=latest&per_page=100`,
      ),
      'jobs',
    )
    requireExactCheck({head, base: main}, pr, checks, candidate, jobs, {
      ownerReviewed: true,
    })
    const check = checks.find(
      value => value.name === 'SkyAnchor exact candidate',
    )
    const job = jobs[0]
    if (
      !positiveId(check.id) ||
      !positiveId(job.id) ||
      check.url !==
        `https://api.github.com/repos/${repository}/check-runs/${check.id}` ||
      check.details_url !==
        `https://github.com/${repository}/actions/runs/${candidate.id}/job/${job.id}` ||
      candidate.repository?.id !== 1452249834 ||
      !positiveId(candidate.check_suite_id) ||
      check.check_suite?.id !== candidate.check_suite_id ||
      !candidate.pull_requests?.some(value => value.number === number) ||
      job.status !== 'completed' ||
      !Array.isArray(job.steps) ||
      !job.steps.length ||
      job.steps.some(
        step => step.status !== 'completed' || step.conclusion !== 'success',
      ) ||
      job.steps.filter(step => step.name === 'Run pnpm skyanchor:verify')
        .length !== 1
    )
      throw new Error('Candidate check/run/job binding changed')
    return pr
  }
  await exact()
  const approved = await request(`commits/${head}`)
  if (approved.sha !== head || !sha.test(approved.commit?.tree?.sha || ''))
    throw new Error('Approved head tree unavailable')
  await exact()
  await verifyRuntimePolicy(request, env, main)
  requirePR(await request(endpoint), number, head, main)
  // Server-side strict checks and SHA matching are the final concurrent-update guard.
  let result
  try {
    result = await request(`${endpoint}/merge`, {
      method: 'PUT',
      body: JSON.stringify({sha: head, merge_method: 'merge'}),
    })
  } catch (error) {
    throw new Error(
      'Merge request failed; outcome unconfirmed. Inspect the PR before dispatching again.',
      {cause: error},
    )
  }
  if (result.merged !== true || !sha.test(result.sha || ''))
    throw new Error('Protected exact-head merge refused')
  try {
    const commit = await request(`commits/${result.sha}`)
    requireMergedCommit(commit, result, head, main, approved.commit.tree.sha)
    const merged = await request(endpoint)
    if (
      !merged.merged ||
      merged.merge_commit_sha !== result.sha ||
      merged.head.sha !== head
    )
      throw new Error('Final pull request identity verification failed')
  } catch (error) {
    throw new Error(
      `MERGE OCCURRED (${result.sha}): post-merge verification failed; owner inspection required`,
      {cause: error},
    )
  }
  return {pr: number, head, merge: result.sha}
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const event = JSON.parse(
    fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'),
  )
  const result = await ownerMerge(
    api,
    process.env,
    event,
    gitAt(process.cwd(), ['rev-parse', 'HEAD']),
  )
  console.log(JSON.stringify(result))
}
