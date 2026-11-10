import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {test} from 'node:test'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

test('Generated Lucide exports preserve independent supplier paths, primitive layout and stroked metadata', () => {
  const inventory = JSON.parse(
    fs.readFileSync(
      path.join('scripts', 'skyanchor', 'asset-mappings.json'),
      'utf8',
    ),
  )
  for (const entry of inventory.filter(
    entry => entry.source !== 'skyanchor-original',
  )) {
    const supplier = fs.readFileSync(
      path.join(
        'node_modules',
        'lucide-static',
        'icons',
        entry.source + '.svg',
      ),
      'utf8',
    )
    const output = {}
    runInNewContext(
      ts.transpileModule(fs.readFileSync(entry.file, 'utf8'), {
        compilerOptions: {module: ts.ModuleKind.CommonJS},
      }).outputText,
      {
        exports: output,
        require: name => {
          assert.equal(name, '#/components/icons/TEMPLATE')
          return {
            createSVG: options => ({
              ...options,
              svgPaths: options.elements.map(element => element.d),
              svgViewBox: options.viewBox,
            }),
          }
        },
      },
    )
    const icon = output[entry.export]
    const supplierPaths = [
      ...supplier.matchAll(/<path\b[^>]*\bd="([^"]*)"/g),
    ].map(match => match[1])
    const supplierElements = [
      ...supplier.matchAll(/<(path|circle|rect|line|polyline|polygon)\b/g),
    ]
    assert.equal(icon.elements.length, supplierElements.length, entry.export)
    assert.deepEqual(
      Array.from(icon.svgPaths).filter(d => supplierPaths.includes(d)),
      supplierPaths,
      entry.export + ': original path strings must remain independent',
    )
    assert.equal(icon.svgViewBox, '0 0 24 24', entry.export)
    assert.equal(icon.svgStrokeWidth, 2, entry.export)
    for (const element of icon.elements) {
      assert.equal(element.type, 'path')
      assert.ok(element.d)
      assert.equal(element.fill, 'none')
      assert.equal(element.stroke, 'currentColor')
      assert.equal(element.strokeWidth, 2)
      assert.equal(element.strokeLinecap, 'round')
      assert.equal(element.strokeLinejoin, 'round')
    }
    if (entry.source === 'x') {
      assert.deepEqual(Array.from(icon.svgPaths), ['M18 6 6 18', 'm6 6 12 12'])
    }
    if (entry.source === 'circle') {
      assert.deepEqual(Array.from(icon.svgPaths), [
        'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0',
      ])
    }
  }
})
