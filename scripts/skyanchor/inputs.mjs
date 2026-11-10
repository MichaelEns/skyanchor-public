import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const walk = directory =>
  fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(directory, entry.name)
    if (
      file === path.join('worker', 'build') ||
      file === path.join('worker', '.wrangler') ||
      file === path.join('worker', 'wrangler.local.jsonc')
    )
      return []
    return entry.isDirectory() ? walk(file) : [file]
  })
export function buildInputs() {
  const files = [
    'src',
    'assets',
    'public',
    path.join('scripts', 'skyanchor'),
    'patches',
    'licenses',
    'worker',
    'lexicons',
  ]
    .flatMap(walk)
    .concat([
      '.gitattributes',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'app.config.js',
      'babel.config.js',
      'metro.config.ts',
      'index.web.ts',
      'NOTICE.md',
      'LICENSE',
    ])
    .sort()
  const sources = files
    .map(file => ({
      file: file.split(path.sep).join('/'),
      sha256: hash(fs.readFileSync(file)),
    }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  return {sha256: hash(JSON.stringify(sources)), sources}
}
