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
  './httpClientHelpers': { debugLog: () => {} },
  './authSession': { refreshAccessTokenFromCookie: async () => null },
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

const failureMessage = async (client, fallback = '일정 저장에 실패했습니다.') => {
  const { getRequestFailureMessage } = loadModule('../src/shared/api/errorMessage.ts')
  try {
    await client.httpClient('/workspaces/schedules', { method: 'POST', json: { title: 'x' } })
  } catch (error) {
    return getRequestFailureMessage(error, fallback)
  }
  assert.fail('request should fail')
}

for (const [status, body] of [
  [403, { code: 'FORBIDDEN', message: '이 프로젝트에 일정을 만들 권한이 없어요.' }],
  [503, { message: '잠시 후 다시 시도해 주세요.' }],
]) {
  test(`a ${status} response shows the server wording instead of the screen fallback`, async () => {
    assert.equal(await failureMessage(createClient(Response.json(body, { status }))), body.message)
  })
}

test('a network failure keeps the screen fallback instead of the browser wording', async () => {
  const client = loadModule('../src/shared/api/httpClient.ts', {
    './config': { API_BASE_URL: 'https://api.example.test/v2', buildUrl: (base, path) => `${base}${path}` },
    './authTokens': { getAccessToken: () => null, isAccessTokenExpired: () => false, setAuthTokens: () => {} },
    './httpClientHelpers': { debugLog: () => {} },
    './authSession': { refreshAccessTokenFromCookie: async () => null },
    './errorMessage': loadModule('../src/shared/api/errorMessage.ts'),
  }, { fetch: async () => { throw new TypeError('Failed to fetch') } })
  assert.equal(await failureMessage(client), '일정 저장에 실패했습니다.')
})

test('failures without a server response keep the screen fallback', () => {
  const { getRequestFailureMessage } = loadModule('../src/shared/api/errorMessage.ts')
  assert.equal(getRequestFailureMessage(new Error('internal'), '기본'), '기본')
  assert.equal(getRequestFailureMessage(undefined, '기본'), '기본')
  assert.equal(getRequestFailureMessage({ status: 400, message: '  ' }, '기본'), '기본')
})

test('a client guard keeps its own wording while other non-server errors fall back', () => {
  const { ClientGuardError, getRequestFailureMessage } = loadModule('../src/shared/api/errorMessage.ts')
  const guard = new ClientGuardError('  일정을 다시 열어 최신 상태를 확인해 주세요. ')
  assert.equal(guard.name, 'ClientGuardError')
  assert.equal(getRequestFailureMessage(guard, '기본'), '일정을 다시 열어 최신 상태를 확인해 주세요.')
  assert.equal(getRequestFailureMessage(new ClientGuardError(' '), '기본'), '기본')
  assert.equal(getRequestFailureMessage(new Error('internal'), '기본'), '기본')
})

test('successful JSON and empty responses remain unchanged', async () => {
  const jsonClient = createClient(Response.json({ token: 'test-token' }))
  assert.equal((await jsonClient.httpClient('/login')).token, 'test-token')
  const emptyClient = createClient(new Response(null, { status: 204 }))
  assert.equal(await emptyClient.httpClient('/schedules'), undefined)
})

test('sensitive responses stay out of debug logs and are not sent as fetch options', async () => {
  const secret = 'http://localhost:6274/callback?code=one-time-authorization-code&state=s'
  const logs = []
  const fetchInits = []
  const { httpClient } = loadModule('../src/shared/api/httpClient.ts', {
    './config': {
      API_BASE_URL: 'https://api.example.test/v2',
      AUTH_BASE_URL: 'https://api.example.test/v0',
      buildAuthUrl: (path) => `https://api.example.test/v0${path}`,
      buildUrl: (base, path) => `${base}${path}`,
    },
    './authTokens': { getAccessToken: () => 'access-jwt', isAccessTokenExpired: () => false, setAuthTokens: () => {} },
    './httpClientHelpers': {
      debugLog: (...args) => logs.push(JSON.stringify(args)),
    },
    './authSession': { refreshAccessTokenFromCookie: async () => null },
    './errorMessage': loadModule('../src/shared/api/errorMessage.ts'),
  }, {
    fetch: async (_url, init) => {
      fetchInits.push(init)
      return Response.json({ redirectUri: secret })
    },
  })

  const response = await httpClient('/oauth/authorize/decision', {
    method: 'POST', json: { approve: true }, sensitiveResponse: true,
  })
  assert.equal(response.redirectUri, secret)
  assert.ok(logs.length > 0)
  assert.ok(logs.every((line) => !line.includes('one-time-authorization-code')))
  assert.equal('sensitiveResponse' in fetchInits[0], false)
  assert.equal(fetchInits[0].headers.Authorization, 'Bearer access-jwt')

  logs.length = 0
  await httpClient('/oauth/authorize/decision', { method: 'POST', json: { approve: true } })
  assert.ok(logs.some((line) => line.includes('one-time-authorization-code')), 'non-sensitive responses are still logged')
})
