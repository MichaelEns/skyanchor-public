import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {patchMetadata, verifyZodFiles} from './zod-fixture.mjs'
import {isDeepStrictEqual} from 'node:util'
import {advisoryIdentity} from './dependency-evidence.mjs'

export function isReviewedZodAdvisory(advisory) {
  return isDeepStrictEqual(advisoryIdentity(advisory), {
    id: patchMetadata.advisory,
    supplierId: patchMetadata.advisorySupplierId,
    cwe: patchMetadata.advisoryCwe,
    url: patchMetadata.advisoryUrl,
    package: patchMetadata.package,
    severity: patchMetadata.advisorySeverity,
    title: patchMetadata.advisoryTitle,
    vulnerable: patchMetadata.supplierVulnerableRange,
    patched: patchMetadata.supplierPatchedRange,
    versions: [patchMetadata.version],
  })
}

export function resolveFindingPath(
  findingPath,
  packageName,
  version,
  root = process.cwd(),
) {
  const segments = findingPath.split('>')
  if (segments.shift() !== '.' || segments.at(-1) !== packageName)
    throw new Error(`Unresolved supplier finding path: ${findingPath}`)
  let owner = path.join(root, 'package.json')
  for (const name of segments) {
    if (
      !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name) ||
      name === '.' ||
      name === '..'
    )
      throw new Error(
        `Invalid dependency name in supplier path: ${findingPath}`,
      )
    const require = createRequire(owner)
    const manifest = require.resolve
      .paths(name)
      ?.map(directory =>
        path.join(directory, ...name.split('/'), 'package.json'),
      )
      .find(file => fs.existsSync(file))
    if (!manifest)
      throw new Error(`Installed dependency path is missing: ${findingPath}`)
    const value = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    if (value.name !== name)
      throw new Error(
        `Supplier finding resolves to a different package: ${findingPath}`,
      )
    owner = manifest
  }
  const value = JSON.parse(fs.readFileSync(owner, 'utf8'))
  if (value.version !== version)
    throw new Error(`Supplier finding version does not resolve: ${findingPath}`)
  return path.dirname(owner)
}

/** Mandatory even if the supplier audit omits or removes the known advisory. */
export function verifyRequiredZodRuntime(packages, verify = verifyZodFiles) {
  const zod = packages.filter(pkg => pkg.name === patchMetadata.package)
  if (!zod.length) throw new Error('Expected Zod runtime package is missing')
  for (const pkg of zod) {
    if (pkg.version !== patchMetadata.version)
      throw new Error(`Unreviewed shipped Zod version: ${pkg.version}`)
    verify(
      path.isAbsolute(pkg.directory)
        ? pkg.directory
        : path.resolve(...pkg.directory.split('/')),
      'patched',
    )
  }
}

export function verifyZodFindingPaths(
  finding,
  root = process.cwd(),
  verify = verifyZodFiles,
) {
  if (!finding.paths?.length)
    throw new Error('Zod finding has no resolvable dependency paths')
  return finding.paths.map(findingPath => {
    const directory = resolveFindingPath(
      findingPath,
      patchMetadata.package,
      finding.version,
      root,
    )
    verify(directory, 'patched')
    return {
      path: findingPath,
      directory: path.relative(root, directory).split(path.sep).join('/'),
      verified: true,
    }
  })
}
