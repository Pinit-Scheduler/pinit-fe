import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/shared/api/errorMessage.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const module = { exports: {} }
vm.runInNewContext(outputText, { module, exports: module.exports, Error })

/** The real src/shared/api/errorMessage.ts. It has no state, so every test can share it. */
export const errorMessage = module.exports

/** An error shaped like httpClient's ApiError (name, status, data) without loading httpClient. */
export const apiError = (message, status, data = null) =>
  Object.assign(new Error(message), { name: 'ApiError', status, data })

/** A vm `require` that serves `dependencies`, falls back to the real errorMessage module and rejects anything else. */
export const requireFrom = (dependencies) => (name) => {
  if (name in dependencies) return dependencies[name]
  if (name === '@shared/api/errorMessage') return errorMessage
  assert.fail(`Unexpected dependency ${name}`)
}
