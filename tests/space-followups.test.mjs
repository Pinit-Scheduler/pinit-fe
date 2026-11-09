import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(
    new URL('../src/' + path, import.meta.url),
    'utf8',
  )
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    console: { error() {} },
    require: (name) => {
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
    ...globals,
  })
  return module.exports
}

test('space marks are stable per id and neutral for personal spaces', () => {
  const { spaceMark, SPACE_MARKS } = load('features/spaces/marks.ts')
  assert.deepEqual([...SPACE_MARKS], ['#3e8391', '#9165b0', '#a77d35', '#43886b', '#ad6280'])
  assert.equal(spaceMark({ id: 31, personal: false }), '#9165b0')
  assert.equal(spaceMark({ id: 35, personal: false }), '#3e8391')
  assert.equal(spaceMark({ id: -4, personal: true }), null)
  assert.equal(spaceMark({ id: -7, personal: false }), '#a77d35')
})
