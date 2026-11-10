import fs from 'node:fs'
import {buildInputs} from './inputs.mjs'
import {createHash} from 'node:crypto'
import {pnpmCommand, spawnPnpm} from './pnpm-cli.mjs'
import path from 'node:path'
import {patchMetadata, verifyZodFiles} from './zod-fixture.mjs'
import {dependencyEvidence, digest} from './dependency-evidence.mjs'
import {
  assessBuildUsage,
  boundaryHash,
  textHash,
  usagePolicy,
} from './security-policy.mjs'
import {parseAllDocuments} from 'yaml'
import {
  verifyBrowserArtifacts,
  verifyDependencySources,
} from './bundle-evidence.mjs'
import {
  verifyRequiredZodRuntime,
  verifyZodFindingPaths,
  isReviewedZodAdvisory,
} from './zod-runtime-evidence.mjs'

const evidence = JSON.parse(
  fs.readFileSync(path.join('dist', 'skyanchor-runtime.json'), 'utf8'),
)
if (evidence.inputs !== buildInputs().sha256)
  throw new Error('Security evidence is stale; rebuild the current export')
verifyDependencySources(evidence.dependencySources)
verifyBrowserArtifacts(evidence.artifacts)
const finalArtifacts = JSON.parse(
  fs.readFileSync('proof-browser-artifacts.json', 'utf8'),
)
if (finalArtifacts.inputs !== evidence.inputs)
  throw new Error('Final browser artifact receipt is stale')
verifyBrowserArtifacts(finalArtifacts.artifacts, process.cwd(), true)
if (!evidence.bundles?.length)
  throw new Error('Export is missing executable artifact evidence')
for (const bundle of evidence.bundles) {
  if (
    digest(fs.readFileSync(path.resolve(...bundle.file.split('/')))) !==
    bundle.sha256
  )
    throw new Error(`Export executable changed: ${bundle.file}`)
}
const worker = JSON.parse(
  fs.readFileSync(path.join('worker', 'build', 'runtime.json'), 'utf8'),
)
for (const source of worker.sources) {
  if (
    createHash('sha256').update(fs.readFileSync(source.file)).digest('hex') !==
    source.sha256
  )
    throw new Error('Worker source evidence is stale')
}
if (
  createHash('sha256')
    .update(fs.readFileSync(path.join('worker', 'build', 'index.mjs')))
    .digest('hex') !== worker.sha256
)
  throw new Error('Worker artifact evidence does not match')
verifyRequiredZodRuntime([...evidence.browser, ...worker.packages])
const pnpm = pnpmCommand()
const result = spawnPnpm(pnpm, ['audit', '--json'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
if (result.error) throw result.error
let audit
try {
  audit = JSON.parse(result.stdout)
} catch {
  throw new Error(`Audit did not produce valid JSON: ${result.stderr}`)
}
if (
  !audit.advisories ||
  !audit.metadata?.vulnerabilities ||
  ![0, 1].includes(result.status) ||
  Object.values(audit.advisories).some(
    advisory =>
      Object.keys(advisory).sort().join(',') !==
        [
          'cwe',
          'findings',
          'github_advisory_id',
          'id',
          'module_name',
          'patched_versions',
          ...(Object.hasOwn(advisory, 'patched_versions_unpublished')
            ? ['patched_versions_unpublished']
            : []),
          'severity',
          'title',
          'url',
          'vulnerable_versions',
        ].join(',') ||
      !advisory.github_advisory_id ||
      !Array.isArray(advisory.findings) ||
      !advisory.findings.length ||
      advisory.findings.some(
        finding => !finding.version || !Array.isArray(finding.paths),
      ),
  ) ||
  Object.values(audit.metadata.vulnerabilities).reduce(
    (sum, count) => sum + count,
    0,
  ) !== Object.keys(audit.advisories).length
)
  throw new Error('Audit failed or returned an unknown format')
const inventory = dependencyEvidence([
  ...Object.keys(usagePolicy.reviews),
  'zod',
])
const context = {
  lock: textHash('pnpm-lock.yaml'),
  boundary: boundaryHash(usagePolicy.boundaryFiles),
}
const lock = Object.assign(
  {},
  ...parseAllDocuments(fs.readFileSync('pnpm-lock.yaml', 'utf8')).map(
    document => {
      if (document.errors.length) throw document.errors[0]
      return document.toJSON()
    },
  ),
)
if (
  lock.packages?.['zod@3.25.76']?.resolution?.integrity !==
    patchMetadata.supplierIntegrity ||
  lock.patchedDependencies?.['zod@3.25.76'] !== patchMetadata.patchSha256
)
  throw new Error(
    'Zod supplier integrity or installed lock patch identity drift',
  )
const packageState = new Map()
for (const pkg of [
  ...evidence.browser,
  ...worker.packages,
  ...inventory.zod.copies
    .filter(
      pkg =>
        pkg.name === patchMetadata.package &&
        pkg.version === patchMetadata.version,
    )
    .map(pkg => ({
      ...pkg,
      manifestSha256: digest(
        fs.readFileSync(
          path.resolve(...pkg.directory.split('/'), 'package.json'),
        ),
      ),
    })),
]) {
  const root = path.resolve(...pkg.directory.split('/'))
  const manifestHash = createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'package.json')))
    .digest('hex')
  if (manifestHash !== pkg.manifestSha256)
    throw new Error('Bundled dependency identity evidence changed')
  if (pkg.name === 'zod' && pkg.version === patchMetadata.version) {
    verifyZodFiles(root, 'patched')
    packageState.set(pkg.directory, 'verified-backport')
  }
}
const advisories = Object.values(audit.advisories).map(advisory => ({
  id: advisory.github_advisory_id,
  package: advisory.module_name,
  severity: advisory.severity,
  patched: advisory.patched_versions,
  findings: advisory.findings.map(finding => ({
    version: finding.version,
    paths: finding.paths,
    pathEvidence:
      advisory.module_name === patchMetadata.package
        ? verifyZodFindingPaths(finding)
        : undefined,
    browser: evidence.browser.some(
      pkg =>
        pkg.name === advisory.module_name && pkg.version === finding.version,
    ),
    worker: worker.packages.some(
      pkg =>
        pkg.name === advisory.module_name && pkg.version === finding.version,
    ),
    assessment:
      isReviewedZodAdvisory(advisory) &&
      finding.version === patchMetadata.version &&
      inventory.zod.copies.filter(
        pkg =>
          pkg.name === advisory.module_name && pkg.version === finding.version,
      ).length > 0 &&
      inventory.zod.copies
        .filter(
          pkg =>
            pkg.name === advisory.module_name &&
            pkg.version === finding.version,
        )
        .every(pkg => packageState.get(pkg.directory) === 'verified-backport')
        ? 'Owning-parser backport verified by exact six-file hashes; supplier advisory retained, not a vendor-fixed version'
        : assessBuildUsage(advisory, inventory[advisory.module_name], {
            ...context,
            bundled: [...evidence.browser, ...worker.packages].some(
              pkg => pkg.name === advisory.module_name,
            ),
          }),
  })),
}))
fs.writeFileSync(
  'proof-security-report.json',
  JSON.stringify(
    {
      inputs: evidence.inputs,
      browserPackages: evidence.browser.length,
      workerPackages: worker.packages,
      advisories,
      metadata: audit.metadata,
      patch: {
        metadata: patchMetadata,
        installedRuntime: [...packageState.entries()],
      },
      reviewedBuildUsage: {context, inventory},
      unresolvedShippedRuntime: advisories.filter(advisory =>
        advisory.findings.some(
          finding =>
            (finding.browser || finding.worker) &&
            finding.assessment.startsWith('UNRESOLVED'),
        ),
      ).length,
      passed: advisories.every(advisory =>
        advisory.findings.every(
          finding => !finding.assessment.startsWith('UNRESOLVED'),
        ),
      ),
    },
    null,
    2,
  ) + '\n',
)
const unresolved = advisories.filter(advisory =>
  advisory.findings.some(finding =>
    finding.assessment.startsWith('UNRESOLVED'),
  ),
)
if (unresolved.length || (!advisories.length && result.status !== 0))
  throw new Error(
    `Release blocked: ${unresolved.length} unresolved of ${advisories.length} supplier advisory entries. See proof-security-report.json; exact backport evidence never exempts other versions/advisories or unreviewed build/native findings.`,
  )
console.log(
  `Security gate passed: zero unresolved shipped/runtime or reviewed release-use findings; ${advisories.length} raw supplier advisory entries retained`,
)
