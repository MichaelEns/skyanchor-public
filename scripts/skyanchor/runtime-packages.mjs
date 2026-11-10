import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'

/** Derive package identity from exact bundler source paths, not root manifest reachability. */
export function runtimePackages(sources) {
  const packages = new Map()
  for (const source of sources) {
    const virtual = source.replaceAll('\\', '/')
    const normalized = virtual.startsWith('/node_modules/')
      ? virtual.slice(1)
      : virtual
    const marker = normalized.lastIndexOf('node_modules/')
    if (marker < 0) continue
    const parts = normalized.slice(marker + 'node_modules/'.length).split('/')
    const name = parts[0].startsWith('@')
      ? parts.slice(0, 2).join('/')
      : parts[0]
    const prefix = normalized.slice(0, marker)
    const directory = prefix + 'node_modules/' + name
    const file = path.resolve(directory, 'package.json')
    if (!fs.existsSync(file))
      throw new Error(`Unresolved bundled package: ${source}`)
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (
      typeof manifest.name !== 'string' ||
      typeof manifest.version !== 'string'
    )
      throw new Error(`Invalid bundled package identity: ${file}`)
    packages.set(`${manifest.name}@${manifest.version}:${directory}`, {
      name: manifest.name,
      version: manifest.version,
      directory: path
        .relative(process.cwd(), path.dirname(file))
        .split(path.sep)
        .join('/'),
      manifestSha256: createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex'),
    })
  }
  return [...packages.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  )
}
