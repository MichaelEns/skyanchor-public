import fs from 'node:fs'
import path from 'node:path'
import {isDeepStrictEqual} from 'node:util'
import {advisoryIdentity, digest} from './dependency-evidence.mjs'

export const usagePolicy = JSON.parse(
  fs.readFileSync(path.join('patches', 'security-usage.json'), 'utf8'),
)
export const textHash = file =>
  digest(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))
export function boundaryHash(files) {
  return digest(
    JSON.stringify(
      files.map(file => ({
        file,
        sha256: textHash(path.resolve(...file.split('/'))),
      })),
    ),
  )
}

export function assessBuildUsage(advisory, inventory, context) {
  const review = usagePolicy.reviews[advisory.module_name]
  if (!review) return 'UNRESOLVED: no reviewed usage boundary'
  const identity = advisoryIdentity(advisory)
  if (!review.advisories.some(known => isDeepStrictEqual(known, identity)))
    return 'UNRESOLVED: advisory identity, severity, ranges or versions changed'
  if (context.bundled)
    return 'UNRESOLVED: reviewed build/native dependency is now shipped'
  if (
    context.lock !== usagePolicy.lockSha256 ||
    context.boundary !== usagePolicy.boundarySha256 ||
    inventory.sha256 !== review.inventorySha256
  )
    return 'UNRESOLVED: reviewed lock, release config or complete consumer source inventory changed'
  return `Reviewed restricted build/native use, not vendor-fixed: ${review.assessment}`
}
