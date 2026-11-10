import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import {performance} from 'node:perf_hooks'
import {test} from 'node:test'
import {pathToFileURL} from 'node:url'
import {verifyZodFiles} from '../scripts/skyanchor/zod-fixture.mjs'

const require = createRequire(import.meta.url)
const candidate = process.env.SKYANCHOR_ZOD_CANDIDATE === '1'
const draft = candidate
  ? path.resolve('proof', 'zod-patch')
  : path.resolve('node_modules', 'zod')
verifyZodFiles(draft, 'patched')
const cjs = require(path.join(draft, 'v3', 'index.cjs'))
const esm = await import(pathToFileURL(path.join(draft, 'v3', 'index.js')).href)
const results = []
const maximumIssues = 129

function failure(result) {
  assert.equal(result.success, false)
  assert.ok(result.error.issues.length > 0)
  assert.ok(result.error.issues.length <= maximumIssues)
  return result.error
}

for (const [dialect, z] of [
  ['cjs', cjs],
  ['esm', esm],
]) {
  test(`Zod ${dialect}: constrained/unconstrained huge arrays fail before element access`, async () => {
    let reads = 0
    const values = new Array(1_000_000)
    Object.defineProperty(values, 0, {
      get() {
        reads++
        return 'invalid'
      },
    })
    const start = performance.now()
    for (const schema of [
      z.array(z.number()),
      z.array(z.number()).max(2),
      z.array(z.number()).length(2),
    ]) {
      failure(schema.safeParse(values))
      failure(await schema.safeParseAsync(values))
    }
    assert.equal(reads, 0)
    const small = z.array(z.number()).max(2).safeParse([1, 2, 3])
    assert.equal(failure(small).issues[0].code, 'too_big')
    results.push({
      dialect,
      case: 'million-element-array',
      elementReads: reads,
      milliseconds: performance.now() - start,
    })
  })

  test(`Zod ${dialect}: global issue/traversal budgets survive nested unions, catch and async refinements`, async () => {
    let parsed = 0
    const invalid = z.string().superRefine(async (_value, ctx) => {
      parsed++
      await Promise.resolve()
      for (let i = 0; i < 1000; i++)
        ctx.addIssue({code: 'custom', message: 'invalid'})
    })
    const input = Array.from({length: 200}, () => 'x')
    const result = await z
      .array(z.union([invalid, invalid]))
      .safeParseAsync(input)
    const error = failure(result)
    assert.ok(parsed > 0)
    assert.ok(
      error.issues.some(
        issue => issue.message === 'Validation resource limit exceeded',
      ),
    )
    assert.equal(
      failure(
        z.array(z.number()).catch([]).safeParse(new Array(1_000_000)),
      ).issues.at(-1).message,
      'Validation resource limit exceeded',
    )
    failure(
      await z.array(z.number()).catch([]).safeParseAsync(new Array(1_000_000)),
    )
    failure(await z.array(invalid).safeParseAsync(input))
    assert.deepEqual(z.array(z.string()).parse(['a', 'b']), ['a', 'b'])
    assert.deepEqual(await z.array(z.string()).parseAsync(['a', 'b']), [
      'a',
      'b',
    ])
    results.push({
      dialect,
      case: 'async-union-issues',
      refinements: parsed,
      topLevelIssues: error.issues.length,
    })
  })

  test(`Zod ${dialect}: map/set/record fanout and cyclic/deep recursion terminate`, async () => {
    const map = new Map(Array.from({length: 5000}, (_, i) => [i, 'bad']))
    const set = new Set(map.keys())
    const record = Object.fromEntries(map)
    for (const [schema, input] of [
      [z.map(z.number(), z.number()), map],
      [z.set(z.number()), set],
      [z.record(z.number()), record],
    ]) {
      failure(schema.safeParse(input))
      failure(await schema.safeParseAsync(input))
    }
    const recursive = z.lazy(() => z.object({next: recursive.optional()}))
    const cycle = {}
    cycle.next = cycle
    failure(recursive.safeParse(cycle))
    failure(await recursive.safeParseAsync(cycle))
    let deep = {}
    for (let i = 0; i < 100; i++) deep = {next: deep}
    failure(recursive.safeParse(deep))
    const nested = z.array(z.array(z.number()))
    failure(
      nested.safeParse(
        Array.from({length: 100}, () => new Array(1000).fill(1)),
      ),
    )
    failure(
      await nested.safeParseAsync(
        Array.from({length: 100}, () => new Array(1000).fill(1)),
      ),
    )
    assert.equal(
      failure(
        z
          .set(z.number())
          .max(2)
          .safeParse(new Set([1, 2, 3])),
      ).issues[0].code,
      'too_big',
    )
    results.push({
      dialect,
      case: 'nested-collections-and-recursion',
      passed: true,
    })
  })

  test(`Zod ${dialect}: missing fields and huge union options reserve fanout before child work`, async () => {
    let visits = 0
    const child = z.any().superRefine(() => {
      visits++
    })
    const shape = Object.fromEntries(
      Array.from({length: 100_000}, (_, i) => ['key' + i, child]),
    )
    const wide = z.object(shape)
    failure(wide.safeParse({}))
    failure(await wide.safeParseAsync({}))
    assert.equal(visits, 0)
    const option = z.number()
    let optionContexts = 0
    const parseSync = option._parseSync.bind(option)
    const parseAsync = option._parseAsync.bind(option)
    option._parseSync = input => {
      optionContexts++
      return parseSync(input)
    }
    option._parseAsync = input => {
      optionContexts++
      return parseAsync(input)
    }
    const union = z.union(new Array(100_000).fill(option))
    failure(union.safeParse('value'))
    failure(await union.safeParseAsync('value'))
    assert.equal(visits, 0)
    assert.equal(optionContexts, 0)
    const nestedUnion = z.array(z.union(new Array(1000).fill(option)))
    failure(await nestedUnion.safeParseAsync(new Array(200).fill(1)))
    assert.ok(
      optionContexts <= 16_384,
      `Scheduled ${optionContexts} of 200000 option contexts`,
    )
    const bounded = z.object(
      Object.fromEntries(
        Array.from({length: 4000}, (_, i) => ['key' + i, z.number()]),
      ),
    )
    const number = z.number()
    const original = number._parse.bind(number)
    let invalidVisits = 0
    number._parse = function (input) {
      invalidVisits++
      return original(input)
    }
    try {
      const invalid = z.object(
        Object.fromEntries(
          Array.from({length: 4000}, (_, i) => ['key' + i, number]),
        ),
      )
      failure(invalid.safeParse({}))
      assert.ok(
        invalidVisits <= 130,
        `Visited ${invalidVisits} of 4000 missing fields`,
      )
    } finally {
      number._parse = original
    }
    failure(await bounded.safeParseAsync({}))
    results.push({
      dialect,
      case: 'schema-fanout',
      hugeChildVisits: visits,
      nestedOptionContexts: optionContexts,
      theoreticalOptionContexts: 200_000,
      invalidMissingFieldVisits: invalidVisits,
    })
  })

  test(`Zod ${dialect}: native promise descendants share the original parse budget`, async () => {
    let visits = 0
    const scalar = z.number()
    const parseScalar = scalar._parse.bind(scalar)
    scalar._parse = input => {
      visits++
      return parseScalar(input)
    }
    const schema = z.array(z.promise(z.array(scalar)))
    const promises = Array.from({length: 100}, () =>
      Promise.resolve(new Array(1000).fill(1)),
    )
    const output = schema.parse(promises)
    const settled = await Promise.allSettled(output)
    assert.ok(settled.some(result => result.status === 'rejected'))
    assert.ok(
      visits < 16_384,
      `Visited ${visits} of 100000 promised descendants`,
    )
    for (const result of settled) {
      if (result.status === 'rejected') {
        assert.ok(result.reason instanceof z.ZodError)
        assert.ok(
          result.reason.issues.some(
            issue => issue.message === 'Validation resource limit exceeded',
          ),
        )
      }
    }
    const syncVisits = visits
    visits = 0
    assert.deepEqual(
      await z.promise(z.array(z.number())).parse(Promise.resolve([1, 2])),
      [1, 2],
    )
    await assert.rejects(
      schema.parseAsync(
        Array.from({length: 100}, () =>
          Promise.resolve(new Array(1000).fill(1)),
        ),
      ),
      z.ZodError,
    )
    assert.ok(
      visits < 16_384,
      `Async parse visited ${visits} of 100000 promised descendants`,
    )
    const valid = await z
      .array(z.promise(z.array(z.number())))
      .parseAsync([Promise.resolve([1, 2])])
    assert.ok(valid[0] instanceof Promise)
    assert.deepEqual(await Promise.all(valid), [[1, 2]])
    const reason = new Error('Original promise rejection')
    await assert.rejects(
      z.promise(z.number()).parse(Promise.reject(reason)),
      error => error === reason,
    )
    const failed = await z
      .array(z.promise(z.number()))
      .parseAsync([Promise.reject(reason)])
    await assert.rejects(Promise.all(failed), error => error === reason)
    results.push({
      dialect,
      case: 'shared-native-promise-budget',
      descendants: syncVisits,
      asyncDescendants: visits,
      rejected: settled.filter(result => result.status === 'rejected').length,
    })
  })

  test(`Zod ${dialect}: parse/parseAsync and standard schema fail explicitly at resource limits`, async () => {
    const schema = z.array(z.number())
    const input = new Array(1_000_000)
    assert.throws(() => schema.parse(input), z.ZodError)
    await assert.rejects(schema.parseAsync(input), z.ZodError)
    assert.ok(
      (await schema['~standard'].validate(input)).issues.length <=
        maximumIssues,
    )
    const valid = z.union([z.object({name: z.string()}), z.number()])
    assert.deepEqual(valid.parse({name: 'SkyAnchor'}), {name: 'SkyAnchor'})
    assert.deepEqual(await valid.parseAsync({name: 'SkyAnchor'}), {
      name: 'SkyAnchor',
    })
  })
}

test('Record quantitative CJS/ESM evidence with explicit installed/candidate identity', () => {
  fs.writeFileSync(
    'proof-zod-security-report.json',
    JSON.stringify(
      {
        installedPatch: !candidate,
        candidatePatch: candidate,
        supplierVersion: '3.25.76',
        bounds: {
          nodes: 16384,
          slots: 32768,
          ordinaryIssues: 128,
          terminalIssues: 1,
          depth: 64,
          collectionSlots: 4096,
        },
        limitations:
          'Bounds cover owning parser allocations/traversal for inert data and trusted schemas. Arbitrary user refinements, getters/proxies, strings/regex work and input allocation outside the parser are not sandboxed.',
        results,
      },
      null,
      2,
    ) + '\n',
  )
})
