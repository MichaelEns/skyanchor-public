import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'

export const patchMetadata = JSON.parse(
  fs.readFileSync(path.join('patches', 'zod-security.json'), 'utf8'),
)
const hash = file =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sourceRoot = path.resolve('node_modules', 'zod')
export function verifyZodFiles(root, state) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  )
  if (
    manifest.name !== patchMetadata.package ||
    manifest.version !== patchMetadata.version
  )
    throw new Error('Zod supplier package identity drift')
  if (
    hash(path.resolve(...patchMetadata.patch.split('/'))) !==
    patchMetadata.patchSha256
  )
    throw new Error('Zod patch hash drift; review/reprove before release')
  for (const file of patchMetadata.files) {
    if (hash(path.join(root, ...file.file.split('/'))) !== file[state])
      throw new Error(`Zod ${state} source mismatch: ${file.file}`)
  }
}
export function prepareZodFixture() {
  const root = path.resolve('proof', 'zod-patch')
  const supplierState =
    hash(path.join(sourceRoot, 'v3', 'types.cjs')) ===
    patchMetadata.files.find(file => file.file === 'v3/types.cjs').patched
      ? 'patched'
      : 'original'
  if (supplierState !== 'patched')
    throw new Error('Install the maintained pnpm backport before release tests')
  verifyZodFiles(sourceRoot, supplierState)
  const tests = path.join(sourceRoot, 'src', 'v3', 'tests')
  const walk = directory =>
    fs
      .readdirSync(directory, {withFileTypes: true})
      .flatMap(entry =>
        entry.isDirectory()
          ? walk(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      )
  const corpus = walk(tests)
    .sort()
    .map(file => ({
      file: path.relative(sourceRoot, file).split(path.sep).join('/'),
      sha256: hash(file),
    }))
  if (
    corpus.length !== patchMetadata.compatibilityCorpus.files ||
    createHash('sha256').update(JSON.stringify(corpus)).digest('hex') !==
      patchMetadata.compatibilityCorpus.sha256
  )
    throw new Error('Zod supplier compatibility corpus changed')
  if (fs.existsSync(root)) fs.rmSync(root, {recursive: true})
  fs.cpSync(sourceRoot, root, {recursive: true})
  if (supplierState === 'original') {
    const result = spawnSync(
      'git',
      [
        'apply',
        '--no-index',
        '--directory=proof/zod-patch',
        path.resolve(...patchMetadata.patch.split('/')),
      ],
      {encoding: 'utf8'},
    )
    if (result.status !== 0)
      throw new Error(`Isolated patch application failed: ${result.stderr}`)
  }
  verifyZodFiles(root, 'patched')
  console.log(
    `Isolated Zod patch fixture prepared; installed supplier is ${supplierState}`,
  )
  return {root, supplierState}
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve('scripts', 'skyanchor', 'zod-fixture.mjs')
)
  prepareZodFixture()
