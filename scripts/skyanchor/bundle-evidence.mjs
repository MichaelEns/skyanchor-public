import fs from 'node:fs'
import path from 'node:path'
import {digest} from './dependency-evidence.mjs'

export function verifyNoAssetRedirects(directory) {
  if (fs.existsSync(path.join(directory, '_redirects')))
    throw new Error(
      'Workers Assets uses its configured SPA fallback; _redirects is not permitted in deployment inputs',
    )
}

export function verifyFreeWorkerConfig(config) {
  const allowed = new Set([
    'name',
    'main',
    'compatibility_date',
    'workers_dev',
    'account_id',
    'assets',
    'observability',
    'vars',
    'd1_databases',
  ])
  if (
    Object.keys(config).some(key => !allowed.has(key)) ||
    config.assets?.not_found_handling !== 'single-page-application' ||
    JSON.stringify(config.assets?.run_worker_first) !==
      JSON.stringify(['/api/*'])
  )
    throw new Error(
      'Reviewed Free Worker configuration required: no explicit CPU limits or unreviewed paid bindings/settings; preserve SPA/API-first routing',
    )
}

export function verifySourceNotices(root = process.cwd()) {
  for (const [source, notice] of [
    [['lucide-static', 'LICENSE'], 'lucide-ISC.txt'],
    [['@react-navigation', 'elements', 'LICENSE'], 'react-navigation-MIT.txt'],
    [['@tiptap', 'core', 'LICENSE.md'], 'tiptap-MIT.txt'],
    [['zod', 'LICENSE'], 'zod-MIT.txt'],
  ]) {
    if (
      fs
        .readFileSync(path.join(root, 'node_modules', ...source), 'utf8')
        .replaceAll('\r\n', '\n') !==
      fs
        .readFileSync(path.join(root, 'licenses', notice), 'utf8')
        .replaceAll('\r\n', '\n')
    )
      throw new Error(
        `Source notice differs from installed supplier license: ${notice}`,
      )
  }
}

const assetExtensions = new Set(['.html', '.png'])
const isExportedAsset = (name, source) =>
  name.startsWith(source.name + '.') &&
  name.endsWith(source.ext) &&
  /^[a-f0-9]{32}(?:@[1-9][0-9]*(?:\.[0-9]+)?x)?$/.test(
    name.slice(source.name.length + 1, -source.ext.length),
  )

function exportedAssetEvidence(local, root) {
  const parsed = path.parse(local)
  const directory = path.join(root, 'dist', 'assets', parsed.dir)
  const sha256 = digest(fs.readFileSync(path.join(root, local)))
  const files = fs
    .readdirSync(directory)
    .filter(name => isExportedAsset(name, parsed))
    .sort()
    .map(name => {
      const suffix = name.slice(parsed.name.length + 1, -parsed.ext.length)
      const scale = suffix.includes('@')
        ? suffix.slice(suffix.indexOf('@'))
        : '@1x'
      const exported = path.join(directory, name)
      const hash = digest(fs.readFileSync(exported))
      const candidates = [
        path.join(root, parsed.dir, parsed.name + scale + parsed.ext),
        ...(scale === '@1x' ? [path.join(root, local)] : []),
      ]
      const source = candidates.find(
        file => fs.existsSync(file) && digest(fs.readFileSync(file)) === hash,
      )
      if (!source)
        throw new Error(
          `Missing exact exported dependency asset source: ${name}`,
        )
      return {
        file: path.relative(root, exported).split(path.sep).join('/'),
        source: path.relative(root, source).split(path.sep).join('/'),
        sha256: hash,
      }
    })
  if (!files.some(file => file.sha256 === sha256))
    throw new Error(`Missing exact exported dependency asset: ${local}`)
  return {sha256, files}
}

export function dependencySourceEvidence(maps, root = process.cwd()) {
  const sources = new Map()
  const visit = map => {
    if (Array.isArray(map.sections)) {
      for (const section of map.sections) visit(section.map)
      return
    }
    if (!Array.isArray(map.sources) || !Array.isArray(map.sourcesContent))
      throw new Error(
        'Dependency byte evidence requires source-map sourcesContent',
      )
    for (let index = 0; index < map.sources.length; index++) {
      const virtual = map.sources[index].replaceAll('\\', '/')
      if (!virtual.includes('node_modules/')) continue
      const relative = virtual.startsWith('/node_modules/')
        ? virtual.slice(1)
        : virtual
      const file = path.resolve(root, ...relative.split('/'))
      const local = path.relative(root, file)
      if (local.startsWith('..') || path.isAbsolute(local))
        throw new Error(`Bundled dependency source escaped project: ${virtual}`)
      const content = map.sourcesContent[index]
      if (typeof content !== 'string')
        throw new Error(
          `Missing actual dependency bytes in source map: ${virtual}`,
        )
      const sha256 = digest(Buffer.from(content))
      const installedSha256 = digest(fs.readFileSync(file))
      let asset
      if (installedSha256 !== sha256) {
        // Metro omits asset contents; require the exact exported asset bytes instead.
        if (content !== '' || !assetExtensions.has(path.extname(file)))
          throw new Error(
            `Bundled dependency bytes differ from installed source: ${virtual}`,
          )
        asset = exportedAssetEvidence(local, root)
      }
      const normalized = local.split(path.sep).join('/')
      const existing = sources.get(normalized)
      if (existing && existing.sha256 !== sha256)
        throw new Error(`Conflicting dependency bytes in export: ${virtual}`)
      sources.set(normalized, {
        file: normalized,
        sha256,
        installedSha256,
        ...(asset ? {asset} : {}),
      })
    }
  }
  for (const map of maps) visit(map)
  return [...sources.values()].sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : 0,
  )
}

export function verifyDependencySources(sources, root = process.cwd()) {
  if (!Array.isArray(sources) || !sources.length)
    throw new Error('Export lacks actual bundled dependency byte hashes')
  for (const source of sources) {
    if (
      typeof source.file !== 'string' ||
      !source.file.startsWith('node_modules/') ||
      source.file.split('/').includes('..') ||
      digest(fs.readFileSync(path.resolve(root, ...source.file.split('/')))) !==
        source.installedSha256
    )
      throw new Error(`Bundled dependency bytes are stale: ${source.file}`)
    if (source.asset) {
      if (
        source.sha256 !== digest(Buffer.from('')) ||
        !assetExtensions.has(path.extname(source.file)) ||
        JSON.stringify(source.asset) !==
          JSON.stringify(
            exportedAssetEvidence(path.join(...source.file.split('/')), root),
          )
      )
        throw new Error(`Exported dependency asset is stale: ${source.file}`)
    } else if (source.sha256 !== source.installedSha256) {
      throw new Error(
        `Unverified transformed dependency source: ${source.file}`,
      )
    }
  }
}

export function browserArtifactEvidence(
  root = process.cwd(),
  includeMetadata = false,
) {
  const walk = directory =>
    fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
      const file = path.join(directory, entry.name)
      return entry.isDirectory() ? walk(file) : [file]
    })
  return walk(path.join(root, 'dist'))
    .filter(
      file =>
        includeMetadata ||
        ![
          path.join(root, 'dist', 'skyanchor-runtime.json'),
          path.join(root, 'dist', 'skyanchor-provenance.json'),
        ].includes(file),
    )
    .sort()
    .map(file => ({
      file: path.relative(root, file).split(path.sep).join('/'),
      sha256: digest(fs.readFileSync(file)),
    }))
}

export function verifyBrowserArtifacts(
  artifacts,
  root = process.cwd(),
  includeMetadata = false,
) {
  if (
    !Array.isArray(artifacts) ||
    !artifacts.length ||
    digest(JSON.stringify(artifacts)) !==
      digest(JSON.stringify(browserArtifactEvidence(root, includeMetadata)))
  )
    throw new Error('Browser artifact bytes or inventory changed')
}
