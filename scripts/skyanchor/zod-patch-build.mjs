import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import ts from 'typescript'
import {digest} from './dependency-evidence.mjs'
import {
  patchMetadata,
  prepareZodFixture,
  verifyZodFiles,
} from './zod-fixture.mjs'

const root = path.resolve('proof', 'zod-patch')
const original = path.resolve('proof', 'zod-original')
const metadataFile = path.join('patches', 'zod-security.json')
const patchFile = path.resolve(...patchMetadata.patch.split('/'))
const runGit = args => {
  const result = spawnSync('git', args, {encoding: 'utf8'})
  if (result.error) throw result.error
  if (![0, 1].includes(result.status))
    throw new Error(`Patch tooling failed: ${result.stderr}`)
  return result
}

if (process.argv[2] === 'prepare') {
  prepareZodFixture()
  if (fs.existsSync(original)) fs.rmSync(original, {recursive: true})
  fs.cpSync(root, original, {recursive: true})
  const result = runGit([
    'apply',
    '--reverse',
    '--no-index',
    '--directory=proof/zod-original',
    patchFile,
  ])
  if (result.status !== 0) throw new Error(result.stderr)
  verifyZodFiles(original, 'original')
  console.log(
    'Verified original and candidate copies prepared; installed package unchanged',
  )
} else if (process.argv[2] === 'build') {
  verifyZodFiles(original, 'original')
  for (const file of ['types', path.join('helpers', 'parseUtil')]) {
    const source = fs.readFileSync(
      path.join(root, 'src', 'v3', file + '.ts'),
      'utf8',
    )
    for (const [module, extension] of [
      [ts.ModuleKind.ES2020, '.js'],
      [ts.ModuleKind.CommonJS, '.cjs'],
    ]) {
      const result = ts.transpileModule(source, {
        compilerOptions: {target: ts.ScriptTarget.ES2020, module},
        reportDiagnostics: true,
      })
      if (
        result.diagnostics?.some(
          diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
        )
      )
        throw new Error(
          ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
            getCanonicalFileName: file => file,
            getCurrentDirectory: () => process.cwd(),
            getNewLine: () => '\n',
          }),
        )
      const output =
        extension === '.cjs'
          ? result.outputText.replace(
              /require\(("[^"]+)\.js"\)/g,
              'require($1.cjs")',
            )
          : result.outputText
      fs.writeFileSync(path.join(root, 'v3', file + extension), output)
    }
  }
  const sections = []
  for (const file of patchMetadata.files) {
    const parts = file.file.split('/')
    const before = path.join(original, ...parts)
    const after = path.join(root, ...parts)
    const result = runGit(['diff', '--no-index', '--', before, after])
    if (result.status !== 1)
      throw new Error(`Expected patched source change: ${file.file}`)
    const lines = result.stdout.replaceAll('\r\n', '\n').split('\n')
    lines[0] = `diff --git a/${file.file} b/${file.file}`
    const oldHeader = lines.findIndex(line => line.startsWith('--- '))
    const newHeader = lines.findIndex(line => line.startsWith('+++ '))
    lines[oldHeader] = `--- a/${file.file}`
    lines[newHeader] = `+++ b/${file.file}`
    sections.push(lines.join('\n'))
    if (digest(fs.readFileSync(before)) !== file.original)
      throw new Error(`Original supplier source drift: ${file.file}`)
    file.patched = digest(fs.readFileSync(after))
  }
  const patch = sections.join('')
  fs.writeFileSync(patchFile, patch)
  patchMetadata.patchSha256 = digest(Buffer.from(patch))
  fs.writeFileSync(metadataFile, JSON.stringify(patchMetadata, null, 2) + '\n')
  verifyZodFiles(root, 'patched')
  console.log(
    `Candidate patch built: ${patchMetadata.patchSha256}; install with real pnpm before release`,
  )
} else {
  throw new Error('Expected prepare or build')
}
