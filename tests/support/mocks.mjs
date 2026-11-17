import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

/**
 * 개발용 목업(`src/mocks`)을 node --test에서 부르는 하네스. 부를 때마다 모듈을 새로 불러오므로
 * 테스트마다 `setup()`을 부르면 목업 상태가 처음부터 다시 만들어진다.
 */
const require = createRequire(import.meta.url),
  root = fileURLToPath(new URL('../../', import.meta.url))

export const loadModules = () => {
  const cache = new Map()
  const load = (filename) => {
    if (!filename.endsWith('.ts')) filename += '.ts'
    if (cache.has(filename)) return cache.get(filename).exports
    const source = readFileSync(filename, 'utf8'),
      module = { exports: {} }
    cache.set(filename, module)
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    })
    const localRequire = (name) => {
      if (name.startsWith('.'))
        return load(path.resolve(path.dirname(filename), name))
      const alias = name
        .replace(/^@shared\//, 'src/shared/')
        .replace(/^@features\//, 'src/features/')
      if (alias !== name) return load(path.resolve(root, alias))
      return require(name)
    }
    vm.runInNewContext(
      outputText,
      {
        module,
        exports: module.exports,
        require: localRequire,
        Request,
        Response,
        Headers,
        URL,
        URLSearchParams,
        AbortController,
        ReadableStream,
        TextEncoder,
        TextDecoder,
        atob,
        btoa,
        structuredClone,
        console,
        setTimeout,
        clearTimeout,
      },
      { filename },
    )
    return module.exports
  }
  return (name) => load(path.resolve(root, name))
}

export const token = (sub) =>
  `${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(
    JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }),
  )}.mock`

/**
 * 새 목업 상태와 요청 도우미. `api`는 회원 1(demo)로 부르고, `as`를 주면 그 회원으로 부른다.
 * `load`로 같은 상태의 다른 목업 모듈을 더 불러올 수 있다.
 */
export const setup = () => {
  const load = loadModules()
  const { handleMockRequest } = load('src/mocks/handlers.ts')
  const workspace = load('src/mocks/workspace.ts')
  const split = load('src/mocks/taskSplit.ts')
  const proposals = load('src/mocks/taskSplitProposal.ts')
  const state = load('src/mocks/workspaceState.ts')
  const call = (route, method = 'GET', body, init = {}) =>
    handleMockRequest(
      new Request(`http://localhost:8080${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${token(init.as ?? 1)}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
        ...(init.signal ? { signal: init.signal } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  const api = async (route, method, body, init) => {
    const response = await call(route, method, body, init)
    assert.ok(response, `${method ?? 'GET'} ${route} has a mock handler`)
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
  return { api, call, load, workspace, split, proposals, state }
}
