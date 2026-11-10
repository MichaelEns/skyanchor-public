import {build} from 'esbuild'
import fs from 'node:fs'
import {runtimePackages} from './runtime-packages.mjs'
import {createHash} from 'node:crypto'
import path from 'node:path'
const result = await build({
  entryPoints: [path.join('worker', 'index.ts')],
  outfile: path.join('worker', 'build', 'index.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  metafile: true,
})
fs.writeFileSync(
  path.join('worker', 'build', 'runtime.json'),
  JSON.stringify(
    {
      packages: runtimePackages(Object.keys(result.metafile.inputs)),
      inputs: Object.keys(result.metafile.inputs),
      sources: Object.keys(result.metafile.inputs).map(file => ({
        file,
        sha256: createHash('sha256')
          .update(fs.readFileSync(file))
          .digest('hex'),
      })),
      sha256: createHash('sha256')
        .update(fs.readFileSync(path.join('worker', 'build', 'index.mjs')))
        .digest('hex'),
      bytes: Object.values(result.metafile.outputs).reduce(
        (sum, output) => sum + output.bytes,
        0,
      ),
    },
    null,
    2,
  ) + '\n',
)
