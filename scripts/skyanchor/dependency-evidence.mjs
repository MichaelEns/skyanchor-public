import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'

export const digest = value => createHash('sha256').update(value).digest('hex')
export const portable = file =>
  path.relative(process.cwd(), file).split(path.sep).join('/')

function packageRoots(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    if (entry.name.startsWith('.')) return []
    const root = path.join(directory, entry.name)
    if (entry.name.startsWith('@')) return packageRoots(root)
    if (!fs.existsSync(path.join(root, 'package.json'))) return []
    const nested = path.join(root, 'node_modules')
    return [root, ...(fs.existsSync(nested) ? packageRoots(nested) : [])]
  })
}

function sourceTree(root) {
  const walk = directory =>
    fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
      if (entry.name === 'node_modules') return []
      const file = path.join(directory, entry.name)
      return entry.isDirectory()
        ? walk(file)
        : [
            {
              file: path.relative(root, file).split(path.sep).join('/'),
              sha256: digest(fs.readFileSync(file)),
            },
          ]
    })
  const sources = walk(root).sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : 0,
  )
  return {files: sources.length, sha256: digest(JSON.stringify(sources))}
}

/** Inventory every installed copy and direct consumer, independently of capped audit paths. */
export function dependencyEvidence(names) {
  const installed = packageRoots(path.resolve('node_modules')).map(root => ({
    root,
    manifest: JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    ),
  }))
  return Object.fromEntries(
    names.map(name => {
      const related = installed.filter(
        ({manifest}) =>
          manifest.name === name ||
          Object.hasOwn(manifest.dependencies || {}, name) ||
          Object.hasOwn(manifest.optionalDependencies || {}, name),
      )
      const copies = related
        .map(({root, manifest}) => ({
          directory: portable(root),
          name: manifest.name,
          version: manifest.version,
          requires:
            manifest.dependencies?.[name] ??
            manifest.optionalDependencies?.[name] ??
            null,
          tree: sourceTree(root),
        }))
        .sort((a, b) =>
          a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0,
        )
      return [name, {sha256: digest(JSON.stringify(copies)), copies}]
    }),
  )
}

export function advisoryIdentity(advisory) {
  return {
    id: advisory.github_advisory_id,
    supplierId: advisory.id,
    cwe: advisory.cwe,
    url: advisory.url,
    ...(Object.hasOwn(advisory, 'patched_versions_unpublished')
      ? {unpublishedPatch: advisory.patched_versions_unpublished}
      : {}),
    package: advisory.module_name,
    severity: advisory.severity,
    title: advisory.title,
    vulnerable: advisory.vulnerable_versions,
    patched: advisory.patched_versions,
    versions: [
      ...new Set(advisory.findings.map(finding => finding.version)),
    ].sort(),
  }
}
