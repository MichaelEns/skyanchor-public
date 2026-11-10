import fs from 'node:fs'
import path from 'node:path'
import spawn from 'cross-spawn'
import {fileURLToPath} from 'node:url'
export function spawnPnpm(invocation, args, options = {}) {
  return spawn.sync(invocation.command, [...invocation.args, ...args], {
    ...options,
    shell: false,
  })
}

export function selectPnpmCandidate(candidates, home = process.env.PNPM_HOME) {
  if (
    !Array.isArray(candidates) ||
    candidates.some(value => typeof value !== 'string')
  )
    throw new Error('pnpm discovery requires an array of executable paths')
  if (home && (!path.isAbsolute(home) || !fs.statSync(home).isDirectory()))
    throw new Error('Action PNPM_HOME must be an absolute installed directory')
  const inHome = file => {
    if (!home) return true
    const relative = path.relative(fs.realpathSync(home), fs.realpathSync(file))
    return (
      !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    )
  }
  const supported =
    process.platform === 'win32'
      ? ['pnpm.exe', 'pnpm.cmd', 'pnpm.mjs', 'pnpm.cjs', 'pnpm.js']
      : ['pnpm.mjs', 'pnpm.cjs', 'pnpm.js', 'pnpm']
  const ordered = [...new Set(candidates)].filter(
    file =>
      path.isAbsolute(file) &&
      !/[\r\n]|depot_tools/i.test(file) &&
      supported.includes(path.basename(file).toLowerCase()) &&
      fs.existsSync(file) &&
      fs.statSync(file).isFile() &&
      inHome(file),
  )
  ordered.sort(
    (a, b) =>
      supported.indexOf(path.basename(a).toLowerCase()) -
      supported.indexOf(path.basename(b).toLowerCase()),
  )
  if (!ordered.length)
    throw new Error('No supported installed pnpm executable found')
  const invocation = pnpmInvocation(ordered[0])
  const result = spawnPnpm(invocation, ['--version'], {encoding: 'utf8'})
  if (result.error) throw result.error
  if (result.status !== 0 || result.stdout.trim() !== '11.28.5')
    throw new Error(
      `Discovered pnpm must be exactly 11.28.5: ${result.stderr || result.stdout}`,
    )
  return ordered[0]
}

export function pnpmInvocation(binary) {
  if (!binary || !path.isAbsolute(binary) || /[\r\n]|depot_tools/i.test(binary))
    throw new Error('Absolute pinned personal pnpm path required')
  if (!fs.existsSync(binary) || !fs.statSync(binary).isFile())
    throw new Error(`pnpm executable is missing: ${binary}`)
  const name = path.basename(binary).toLowerCase()
  if (['pnpm.mjs', 'pnpm.cjs', 'pnpm.js'].includes(name))
    return {command: process.execPath, args: [binary]}
  if (!['pnpm', 'pnpm.exe', 'pnpm.cmd'].includes(name))
    throw new Error('Unrecognized pnpm executable')
  return {command: binary, args: []}
}

export function pnpmCommand() {
  const local = path.resolve('proof', 'tooling', 'package', 'bin', 'pnpm.cjs')
  const binary = process.env.SKYANCHOR_PNPM_BINARY || process.env.npm_execpath
  const invocation = fs.existsSync(local)
    ? {command: process.execPath, args: [local]}
    : binary
      ? pnpmInvocation(binary)
      : undefined
  if (!invocation)
    throw new Error(
      'Pinned personal pnpm CLI required; ambient npm/depot launchers are not supported',
    )
  if (process.env.SKYANCHOR_CHECKS_NO_INSTALL === '1')
    invocation.args.push('--config.verifyDepsBeforeRun=false')
  const result = spawnPnpm(invocation, ['--version'], {encoding: 'utf8'})
  if (result.error) throw result.error
  if (result.status !== 0 || result.stdout.trim() !== '11.28.5')
    throw new Error(
      'pnpm 11.28.5 required: ' +
        JSON.stringify({
          command: invocation.command,
          args: invocation.args,
          status: result.status,
          stdout: result.stdout.trim().slice(0, 1024),
          stderr: result.stderr.trim().slice(0, 1024),
        }),
    )
  return invocation
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] !== 'resolve') throw new Error('Expected resolve')
  if (!process.env.PNPM_HOME)
    throw new Error('Action-provided PNPM_HOME required for discovery')
  console.log(
    selectPnpmCandidate(
      JSON.parse(process.env.SKYANCHOR_PNPM_CANDIDATES || 'null'),
    ),
  )
}
