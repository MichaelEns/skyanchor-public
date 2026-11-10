import {spawnSync} from 'node:child_process'
import path from 'node:path'

for (const script of ['lexicons.mjs', 'catalogs.mjs']) {
  const result = spawnSync(
    process.execPath,
    [path.join('scripts', 'skyanchor', script)],
    {stdio: 'inherit'},
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
}
