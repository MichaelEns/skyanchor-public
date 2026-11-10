import fs from 'node:fs'
import path from 'node:path'
import {pnpmCommand, spawnPnpm} from './pnpm-cli.mjs'
import ts from 'typescript'
import {verifyFreeWorkerConfig} from './bundle-evidence.mjs'

const config = ts.parseConfigFileTextToJson(
  'wrangler.jsonc',
  fs.readFileSync(path.join('worker', 'wrangler.jsonc'), 'utf8'),
)
if (config.error) throw new Error('Invalid Worker configuration JSON')
verifyFreeWorkerConfig(config.config)
const pnpm = pnpmCommand()
const result = spawnPnpm(
  pnpm,
  [
    'exec',
    'wrangler',
    'deploy',
    '--config',
    path.join('worker', 'wrangler.jsonc'),
    '--dry-run',
    '--outdir',
    path.resolve('worker', 'build', 'dry-run'),
  ],
  {
    stdio: 'inherit',
    env: {...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true'},
  },
)
if (result.error) throw result.error
fs.writeFileSync(
  'proof-worker-dry-run.json',
  JSON.stringify(
    {dryRun: true, cloudDeployment: false, exit: result.status},
    null,
    2,
  ) + '\n',
)
if (result.status !== 0)
  throw new Error('Actual Wrangler deployment dry-run failed')
