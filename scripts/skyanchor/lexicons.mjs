import {spawnSync} from 'node:child_process'
import path from 'node:path'
const result = spawnSync(
  process.execPath,
  [
    path.join('node_modules', '@atproto', 'lex', 'bin', 'lex'),
    'build',
    '--clear',
    '--index-file',
    '--import-ext',
    '',
  ],
  {stdio: 'inherit'},
)
process.exitCode = result.status ?? 1
