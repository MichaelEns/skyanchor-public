import {existsSync} from 'node:fs'
import path from 'node:path'
import {pnpmCommand, spawnPnpm} from './pnpm-cli.mjs'

if (
  process.argv.includes('--ci') ||
  (!process.env.CI &&
    !existsSync(path.join('src', 'locale', 'locales', 'en', 'messages.ts')))
) {
  const result = spawnPnpm(pnpmCommand(), ['intl:compile'], {stdio: 'inherit'})
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
