import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
import {buildInputs} from './inputs.mjs'
import {pnpmCommand, spawnPnpm} from './pnpm-cli.mjs'
import {releaseCommands} from './release-commands.mjs'
import {createHash} from 'node:crypto'

if (process.env.SKYANCHOR_ZOD_CANDIDATE)
  throw new Error('Candidate Zod tests cannot establish an installed release')
const clean = spawnSync(
  'git',
  ['status', '--porcelain', '--untracked-files=normal'],
  {encoding: 'utf8'},
)
if (clean.error) throw clean.error
if (clean.status !== 0 || clean.stdout.trim())
  throw new Error(
    'Full release verification requires exact committed clean source',
  )
const pnpm = pnpmCommand()
const preparation = spawnPnpm(pnpm, ['skyanchor:prepare'], {stdio: 'inherit'})
if (preparation.error) throw preparation.error
if (preparation.status !== 0)
  throw new Error('Release build-dependency preparation failed')
const commands = releaseCommands
const report = {
  head: spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).stdout.trim(),
  inputs: buildInputs().sha256,
  tree: spawnSync('git', ['rev-parse', 'HEAD^{tree}'], {
    encoding: 'utf8',
  }).stdout.trim(),
  commands: [],
  passed: false,
}
for (const command of commands) {
  const result = spawnPnpm(pnpm, command, {
    stdio: 'inherit',
  })
  report.commands.push({command, exit: result.status})
  fs.writeFileSync(
    'proof-release-report.json',
    JSON.stringify(report, null, 2) + '\n',
  )
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`Release gate failed: ${command.join(' ')}`)
}
if (report.inputs !== buildInputs().sha256)
  throw new Error('Release inputs changed during verification')
const finalHead = spawnSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'})
const finalStatus = spawnSync(
  'git',
  ['status', '--porcelain', '--untracked-files=normal'],
  {encoding: 'utf8'},
)
if (
  finalHead.error ||
  finalStatus.error ||
  finalHead.status !== 0 ||
  finalStatus.status !== 0 ||
  finalHead.stdout.trim() !== report.head ||
  finalStatus.stdout.trim()
)
  throw new Error('Exact committed release source changed during verification')
report.passed = true
report.artifacts = createHash('sha256')
  .update(fs.readFileSync('proof-browser-artifacts.json'))
  .digest('hex')
fs.writeFileSync(
  'proof-release-report.json',
  JSON.stringify(report, null, 2) + '\n',
)
if (process.env.GITHUB_OUTPUT)
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `receipt=${JSON.stringify(report)}\n`,
  )
