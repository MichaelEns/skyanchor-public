const {transformSync} = require('esbuild')

module.exports = {
  process(source, filename) {
    return {
      code: transformSync(source, {
        loader: filename.endsWith('.ts') ? 'ts' : 'js',
        format: 'cjs',
        target: 'es2022',
        sourcefile: filename,
        sourcemap: 'inline',
      }).code,
    }
  },
}
