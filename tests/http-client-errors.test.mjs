import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const loadModule = (relativePath, dependencies = {}, globals = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    console: { error: () => {} },
    ...globals,
  })
  return module.exports
}

const createClient = (response) => loadModule('../src/shared/api/httpClient.ts', {
  './config': {
    API_BASE_URL: 'https://api.example.test/v2',
    AUTH_BASE_URL: 'https://api.example.test/v0',
    buildAuthUrl: (path) => `https://api.example.test/v0${path}`,
    buildUrl: (base, path) => `${base}${path}`,
  },
  './authTokens': { getAccessToken: () => null, isAccessTokenExpired: () => false, setAuthTokens: () => {} },
  './httpClientHelpers': { debugLog: () => {}, createCookieTokenRefresher: () => async () => null },
  './errorMessage': loadModule('../src/shared/api/errorMessage.ts'),
}, { fetch: async () => response })

test('login displays the server message and retains HTTP error details', async () => {
  const payload = { message: '아이디 또는 비밀번호가 올바르지 않습니다.' }
  const { httpClient, ApiError } = createClient(Response.json(payload, { status: 400 }))
  await assert.rejects(httpClient('https://api.example.test/v0/login', {
    method: 'POST', json: { username: 'invalid', password: 'invalid' },
  }), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.message, payload.message)
    assert.equal(error.status, 400)
    assert.equal(error.data.message, payload.message)
    assert.equal(error.url, 'https://api.example.test/v0/login')
    return true
  })
})

test('validation errors display the field reasons instead of an aggregate message', async () => {
  const { httpClient } = createClient(Response.json({
    message: 'Validation failed for 2 field(s)',
    errors: [{ field: 'title', reason: '제목을 입력해주세요.' }, { field: 'date', reason: '날짜를 확인해주세요.' }],
  }, { status: 400 }))
  await assert.rejects(httpClient('/schedules'), { message: '제목을 입력해주세요. 날짜를 확인해주세요.' })
})

for (const [name, response] of [
  ['HTML error', () => new Response('<html>Bad Gateway</html>', { status: 502 })],
  ['empty error', () => new Response(null, { status: 400 })],
  ['malformed message', () => Response.json({ message: { internal: 'details' } }, { status: 400 })],
]) {
  test(`${name} displays a readable fallback`, async () => {
    const { httpClient } = createClient(response())
    await assert.rejects(httpClient('/schedules'), { message: '요청을 처리하지 못했습니다. 다시 시도해주세요.' })
  })
}

test('successful JSON and empty responses remain unchanged', async () => {
  const jsonClient = createClient(Response.json({ token: 'test-token' }))
  assert.equal((await jsonClient.httpClient('/login')).token, 'test-token')
  const emptyClient = createClient(new Response(null, { status: 204 }))
  assert.equal(await emptyClient.httpClient('/schedules'), undefined)
})
