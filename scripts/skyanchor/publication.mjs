import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'

function command(root, args, encoding = 'utf8', input) {
  const result = spawnSync('git', ['--no-replace-objects', ...args], {
    cwd: root,
    encoding,
    input,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Publication Git ${args[0]} failed`)
  return result.stdout
}
const hash = data => createHash('sha256').update(data).digest('hex')

function readBlobs(root, ids) {
  const blobs = new Map()
  for (let start = 0; start < ids.length; start += 64) {
    const batch = ids.slice(start, start + 64)
    const bytes = command(
      root,
      ['cat-file', '--batch'],
      null,
      batch.join('\n') + '\n',
    )
    let offset = 0
    for (const oid of batch) {
      const end = bytes.indexOf(10, offset)
      const header = /^([0-9a-f]{40}) blob (\d+)$/.exec(
        bytes.subarray(offset, end).toString('ascii'),
      )
      if (!header || header[1] !== oid)
        throw new Error('Invalid publication blob stream')
      offset = end + 1
      const length = Number(header[2])
      if (!Number.isSafeInteger(length) || bytes[offset + length] !== 10)
        throw new Error('Truncated publication blob stream')
      blobs.set(oid, bytes.subarray(offset, offset + length))
      offset += length + 1
    }
    if (offset !== bytes.length)
      throw new Error('Unexpected publication blob stream suffix')
  }
  return blobs
}
const privateContent = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/,
  /\b(?:accessJwt|refreshJwt|access_token|refresh_token|client_secret)\s*["']?\s*:\s*["'][A-Za-z0-9_.-]{32,}["']/,
  /[A-Za-z]:[\\/]+Users[\\/]+(?!<|example(?:[\\/]|$))[^\\/\s"'<>]+/i,
  /(?:^|[\s"'`=(])\/(?:Users|home)\/(?!<|example(?:\/|$))[^/\s"'<>]+/,
  /https:\/\/(?!app-cms-production\.bsky\.workers\.dev(?:[\/\s]|$))[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/i,
  /https:\/\/github\.com\/MichaelEns\/skyanchor(?:[\/#?"'\s]|$)/,
  /["']account_id["']\s*:\s*["'][0-9a-f]{32}["']/i,
]
export function inspectFile(file, bytes) {
  if (
    !/^[A-Za-z0-9_./@+()[\] -]+$/.test(file) ||
    file.split('/').some(part => !part || part === '.' || part === '..') ||
    /(?:^|\/)(?:\.git|\.wrangler|node_modules|dist|tooling)(?:\/|$)/i.test(
      file,
    ) ||
    /^(?:sessions?|backups?|captures?)(?:\/|$)/i.test(file) ||
    /(?:^|\/)\.pre-pr-sweep-state$/.test(file) ||
    /(?:^|\/)(?:default\.enc|wrangler\.local\.jsonc|proof-[^/]+\.(?:json|png|txt)|.*\.(?:bundle|zip|tgz|tar|gz|enc|log|bak|sqlite|sqlite3|db|p12|p8|key))$/i.test(
      file,
    ) ||
    (/\.pem$/i.test(file) && file !== 'code-signing/certificate.pem') ||
    (/\.sql$/i.test(file) &&
      file !== 'worker/schema.sql' &&
      !/^worker\/migrations\/\d{4}_[a-z_]+\.sql$/.test(file)) ||
    (/(?:^|\/)\.env(?:\.|$)/.test(file) &&
      !['.env.e2e', '.env.example'].includes(file))
  )
    throw new Error(`Excluded publication path: ${file}`)
  const text = bytes.toString('utf8')
  if (privateContent.some(pattern => pattern.test(text)))
    throw new Error(`Potential private metadata in ${file}; review locally`)
  if (bytes.includes(0)) return
  if (
    file === 'code-signing/certificate.pem' &&
    !/^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n?$/.test(
      text,
    )
  )
    throw new Error('Only the upstream public certificate is allowed here')
  if (file === 'public/skyanchor.html' && /mailto:/i.test(text))
    throw new Error(
      'Public support must use repository issues, not a private mailbox',
    )
  if (text.includes('\r')) throw new Error(`Tracked text must use LF: ${file}`)
  if (
    /["']database_id["']\s*:\s*["']([^"']+)["']/.test(text) &&
    !text.includes('"database_id": "00000000-0000-4000-8000-000000000000"')
  )
    throw new Error(`Non-placeholder deployment identifier in ${file}`)
}

export function inspectWorkflow(file, text) {
  const guard =
    "github.repository == 'MichaelEns/skyanchor-public' && github.event.repository.private == false && vars.SKYANCHOR_ZERO_SPEND_VERIFIED == 'true' && vars.SKYANCHOR_AUTOMATION_ENABLED == 'true'"
  const jobs = text.split(/^jobs:\s*$/m)
  if (jobs.length !== 2)
    throw new Error(`Unknown workflow job structure in ${file}`)
  const blocks = jobs[1]
    .split(/(?=^ {2}[a-z][a-z0-9_-]*:\s*$)/m)
    .filter(block => block.trim())
  if (!blocks.length) throw new Error(`Missing guarded jobs in ${file}`)
  for (const block of blocks) {
    const conditional = /^ {4}if: (.+)$/m.exec(block)?.[1]
    if (
      !conditional ||
      !conditional.replace(/^always\(\) && /, '').startsWith(guard) ||
      [...block.matchAll(/^ {4}runs-on: (.+)$/gm)].length !== 1 ||
      !/^ {4}timeout-minutes: [1-9]\d*$/m.test(block)
    )
      throw new Error(`Missing per-job public/cost/time guard in ${file}`)
  }
  for (const required of [
    "github.repository == 'MichaelEns/skyanchor-public'",
    'github.event.repository.private == false',
    "vars.SKYANCHOR_ZERO_SPEND_VERIFIED == 'true'",
    "vars.SKYANCHOR_AUTOMATION_ENABLED == 'true'",
    'timeout-minutes:',
  ])
    if (!text.includes(required))
      throw new Error(`Missing public/cost/time guard in ${file}`)
  if (
    /upload-artifact|download-artifact|actions\/cache|cache:\s*(?:true|npm|pnpm|yarn)|pull_request_target|workflow_run|secrets\.|self-hosted|ubuntu-\w+-\d+x|packages:\s*write|id-token:\s*write/i.test(
      text,
    ) ||
    [...text.matchAll(/runs-on:\s*([^\r\n]+)/g)].some(
      match => !['windows-latest', 'ubuntu-latest'].includes(match[1]),
    ) ||
    !text.includes('persist-credentials: false')
  )
    throw new Error(`Unapproved workflow capability in ${file}`)
}

function inspectSurfaces(files, read) {
  for (const file of [
    'LICENSE',
    'NOTICE.md',
    'ASSETS.md',
    'package.json',
    '.gitattributes',
  ])
    if (!files.includes(file))
      throw new Error(`Required publication surface missing: ${file}`)
  if (JSON.parse(read('package.json').toString('utf8')).private !== true)
    throw new Error(
      'Application packages must remain private to prevent registry publishing',
    )
  const attributes = read('.gitattributes').toString('utf8')
  if (
    /\bexport-(?:ignore|subst)\b/.test(attributes) ||
    !attributes.includes('* text=auto eol=lf')
  )
    throw new Error(
      'Archive must preserve reviewed LF source and legal notices without substitutions',
    )
}

export function verifyCurrent(root = process.cwd()) {
  const files = command(root, [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ])
    .split('\0')
    .filter(Boolean)
  const errors = []
  const inventory = [...new Set(files)].sort().map(file => {
    const absolute = path.join(root, ...file.split('/'))
    if (!fs.lstatSync(absolute).isFile())
      throw new Error(`Non-regular publication file: ${file}`)
    const raw = fs.readFileSync(absolute)
    const bytes = raw.includes(0)
      ? raw
      : Buffer.from(raw.toString('latin1').replaceAll('\r\n', '\n'), 'latin1')
    try {
      inspectFile(file, bytes)
      if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file))
        inspectWorkflow(file, bytes.toString('utf8'))
    } catch (error) {
      errors.push(error.message)
    }
    return {file, bytes: bytes.length, sha256: hash(bytes)}
  })
  if (errors.length)
    throw new Error(`Publication review failed:\n${errors.join('\n')}`)
  inspectSurfaces(
    inventory.map(entry => entry.file),
    file => fs.readFileSync(path.join(root, ...file.split('/'))),
  )
  return {
    prospectiveLfNormalized: true,
    files: inventory.length,
    inventorySha256: hash(JSON.stringify(inventory)),
    inventory,
  }
}

export function verifyPublication(root = process.cwd(), ref = 'HEAD') {
  const commits = command(root, ['rev-list', '--parents', ref])
    .trim()
    .split('\n')
  const roots = commits.filter(line => line.split(' ').length === 1)
  if (roots.length !== 1)
    throw new Error(
      'Exactly one independent sanitized publication root required',
    )
  const rootHeader = command(root, ['cat-file', 'commit', roots[0]]).split(
    '\n\n',
  )[0]
  if (/^parent /m.test(rootHeader))
    throw new Error(
      'Publication root must be genuinely parentless, not a shallow boundary',
    )
  const rootAuthor = command(root, [
    'show',
    '-s',
    '--format=%ae%n%ce',
    roots[0],
  ])
    .trim()
    .split('\n')
  if (
    rootAuthor.some(
      email => email !== '44419611+MichaelEns@users.noreply.github.com',
    )
  )
    throw new Error('Publication root must have the owning no-reply identity')
  const identities = command(root, ['log', '--format=%ae%n%ce', ref])
    .trim()
    .split('\n')
  if (
    identities.some(
      email =>
        !/^(?:[^@\s]+@users\.noreply\.github\.com|noreply@github\.com)$/.test(
          email,
        ),
    )
  )
    throw new Error('Non-public author or committer identity')
  const trees = [
    ...new Set(command(root, ['log', '--format=%T', ref]).trim().split('\n')),
  ]
  const entries = trees.map(tree =>
    command(root, ['ls-tree', '-rz', tree])
      .split('\0')
      .filter(Boolean)
      .map(record => {
        const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(record)
        if (!match)
          throw new Error('Symlinks/submodules/unknown Git modes are excluded')
        const [, mode, oid, file] = match
        return {mode, oid, file}
      }),
  )
  const blobs = readBlobs(root, [
    ...new Set(entries.flat().map(entry => entry.oid)),
  ])
  let inventory
  const checked = new Set()
  for (const treeEntries of entries) {
    inspectSurfaces(
      treeEntries.map(entry => entry.file),
      file => blobs.get(treeEntries.find(entry => entry.file === file).oid),
    )
    const files = treeEntries.map(({mode, oid, file}) => {
      const bytes = blobs.get(oid)
      const key = `${file}:${oid}`
      if (!checked.has(key)) {
        inspectFile(file, bytes)
        if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file))
          inspectWorkflow(file, bytes.toString('utf8'))
        checked.add(key)
      }
      return {file, mode, bytes: bytes.length, sha256: hash(bytes)}
    })
    if (!inventory) inventory = files
  }
  return {
    head: command(root, ['rev-parse', ref]).trim(),
    root: roots[0],
    commits: commits.length,
    trees: trees.length,
    files: inventory.length,
    inventorySha256: hash(JSON.stringify(inventory)),
    inventory,
    limitation:
      'Generic scanning requires independent owner review of all reachable objects and export/package surfaces.',
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report =
    process.argv[2] === '--current' ? verifyCurrent() : verifyPublication()
  fs.writeFileSync(
    'proof-publication-report.json',
    JSON.stringify(report, null, 2) + '\n',
  )
  console.log(JSON.stringify({...report, inventory: undefined}))
}
