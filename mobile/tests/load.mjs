// 의존성 없는 TS 모듈을 node 테스트에서 불러온다. 저장소의 tests/와 같은 방식이다(transpile 후 vm에서 실행).
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

export const load = (relativePath, requires = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  const require = (name) => {
    if (name in requires) return requires[name]
    throw new Error('Unexpected dependency ' + name)
  }
  vm.runInNewContext(outputText, { module, exports: module.exports, require, URLSearchParams, Date, JSON, Map, Set })
  return module.exports
}

/** vm 컨텍스트에서 만든 객체는 프로토타입이 달라 deepStrictEqual이 어긋난다. 값만 비교하게 옮긴다. */
export const plain = (value) => JSON.parse(JSON.stringify(value))
