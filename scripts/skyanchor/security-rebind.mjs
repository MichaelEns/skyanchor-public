import fs from 'node:fs'
import path from 'node:path'
import {dependencyEvidence} from './dependency-evidence.mjs'
import {boundaryHash, textHash, usagePolicy} from './security-policy.mjs'
import {verifyZodFiles} from './zod-fixture.mjs'

verifyZodFiles(path.resolve('node_modules', 'zod'), 'patched')
const reviewedLock =
  'a34079622ae1cb80267738d9bfc3766b21ee17f3e97d0881ba52ea9b92563edc'
if (textHash('pnpm-lock.yaml') !== reviewedLock)
  throw new Error(
    'Frozen public supplier lock changed; separate security review required',
  )
const inventory = dependencyEvidence(Object.keys(usagePolicy.reviews))
for (const [name, review] of Object.entries(usagePolicy.reviews)) {
  if (inventory[name].sha256 !== review.inventorySha256)
    throw new Error(
      `Installed ${name} copy/consumer source changed; do not auto-rebind`,
    )
}
usagePolicy.lockSha256 = reviewedLock
usagePolicy.boundarySha256 = boundaryHash(usagePolicy.boundaryFiles)
fs.writeFileSync(
  path.join('patches', 'security-usage.json'),
  JSON.stringify(usagePolicy, null, 2) + '\n',
)
console.log(
  'Public snapshot boundaries rebound to the fixed reviewed lock and installed consumer inventories; full exact gate still required',
)
