const path = require('node:path')
const runtime =
  process.env.SKYANCHOR_ZOD_CANDIDATE === '1'
    ? '<rootDir>/proof/zod-patch'
    : '<rootDir>/node_modules/zod'

module.exports = {
  rootDir: path.resolve(__dirname, '..'),
  testEnvironment: 'node',
  testMatch: ['<rootDir>/proof/zod-patch/src/v3/tests/*.test.ts'],
  transform: {'\\.[jt]s$': '<rootDir>/proof/zod-transform.cjs'},
  transformIgnorePatterns: ['/node_modules/'],
  moduleNameMapper: {
    '^vitest$': '<rootDir>/proof/zod-jest-globals.cjs',
    '^zod/v3$': runtime + '/v3/index.cjs',
    '^\\.\\./(helpers/[^/]+|ZodError)\\.js$': runtime + '/v3/$1.cjs',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}
