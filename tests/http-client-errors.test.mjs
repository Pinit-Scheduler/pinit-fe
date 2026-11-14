import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { apiError, errorMessage } from './support/errors.mjs'

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
  './authSession': { refreshSession: async () => ({ kind: 'unauthorized' }) },
  './errorMessage': errorMessage,
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

const ACTION = '일정을 저장하지 못했어요.'
const failureMessage = async (client) => {
  try {
    await client.httpClient('/workspaces/schedules', { method: 'POST', json: { title: 'x' } })
  } catch (error) {
    return errorMessage.getRequestFailureMessage(error, ACTION)
  }
  assert.fail('request should fail')
}

for (const [name, response] of [
  ['HTML error', () => new Response('<html>Bad Gateway</html>', { status: 502 })],
  ['empty error', () => new Response(null, { status: 400 })],
  ['malformed message', () => Response.json({ message: { internal: 'details' } }, { status: 400 })],
]) {
  test(`${name} carries no message, so the screen sentence asks to retry later`, async () => {
    await assert.rejects(createClient(response()).httpClient('/schedules'), { message: '' })
    assert.equal(await failureMessage(createClient(response())), `${ACTION} 잠시 후 다시 시도해 주세요.`)
  })
}

for (const [status, body] of [
  [403, { code: 'FORBIDDEN', message: '이 프로젝트에 일정을 만들 권한이 없어요.' }],
  [409, { message: '같은 이름의 태그가 이미 있어요.' }],
  [503, { message: '잠시 후 다시 시도해 주세요.' }],
]) {
  test(`a ${status} response shows the server wording instead of the screen sentence`, async () => {
    assert.equal(await failureMessage(createClient(Response.json(body, { status }))), body.message)
  })
}

test('a network failure shows the screen sentence with a connection hint instead of the browser wording', async () => {
  const client = loadModule('../src/shared/api/httpClient.ts', {
    './config': { API_BASE_URL: 'https://api.example.test/v2', buildUrl: (base, path) => `${base}${path}` },
    './authTokens': { getAccessToken: () => null, isAccessTokenExpired: () => false, setAuthTokens: () => {} },
    './httpClientHelpers': { debugLog: () => {} },
    './authSession': { refreshSession: async () => ({ kind: 'unauthorized' }) },
    './errorMessage': errorMessage,
  }, { fetch: async () => { throw new TypeError('Failed to fetch') } })
  assert.equal(await failureMessage(client), `${ACTION} 인터넷 연결을 확인한 뒤 다시 시도해 주세요.`)
})

test('only a response or a client guard supplies wording that is shown as is', () => {
  const { ClientGuardError, readFailureMessage } = errorMessage
  assert.equal(readFailureMessage(apiError(' 서버 문구 ', 500)), '서버 문구')
  assert.equal(readFailureMessage(new ClientGuardError('  일정을 다시 열어 최신 상태를 확인해 주세요. ')), '일정을 다시 열어 최신 상태를 확인해 주세요.')
  assert.equal(readFailureMessage(apiError('Failed to fetch', 0)), undefined)
  assert.equal(
    readFailureMessage(Object.assign(apiError(' 점검 중이에요. ', 0), { responseStatus: 503 })),
    '점검 중이에요.',
    'a status-0 error stopped by an answered refresh keeps the server wording',
  )
  assert.equal(readFailureMessage(new Error('internal')), undefined)
  assert.equal(readFailureMessage(apiError('  ', 400)), undefined)
  assert.equal(readFailureMessage(undefined), undefined)
})

test('without shown wording the hint depends on whether a response arrived', () => {
  const { ClientGuardError, getRequestFailureMessage } = errorMessage
  const offline = '기본. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
  assert.equal(getRequestFailureMessage(new Error('internal'), '기본.'), offline)
  assert.equal(getRequestFailureMessage(undefined, '기본.'), offline)
  assert.equal(getRequestFailureMessage(new ClientGuardError(' '), '기본.'), offline)
  assert.equal(getRequestFailureMessage(apiError('', 500), '기본.'), '기본. 잠시 후 다시 시도해 주세요.')
  assert.equal(
    getRequestFailureMessage(apiError('', 0), '기본.', { retryFrom: '설정 → 휴지통에서' }),
    '기본. 인터넷 연결을 확인한 뒤 설정 → 휴지통에서 다시 시도해 주세요.',
  )
  assert.equal(
    getRequestFailureMessage(apiError('', 404), '기본.', { retryFrom: '설정 → 휴지통에서' }),
    '기본. 잠시 후 설정 → 휴지통에서 다시 시도해 주세요.',
  )
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
    './authSession': { refreshSession: async () => ({ kind: 'unauthorized' }) },
    './errorMessage': errorMessage,
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

// 공개 인증 요청(로그인·가입·코드 받기·비밀번호 재설정)은 남아 있는 토큰 상태에 묶이면 안 된다.
const createAnonymousHarness = ({
  accessToken = 'expired-jwt',
  responses,
  expired = true,
  refresh = { kind: 'unauthorized' },
}) => {
  const state = { accessToken, refreshCalls: 0, cleared: 0, fetches: [], logs: [] }
  const queue = [...responses]
  const { httpClient } = loadModule('../src/shared/api/httpClient.ts', {
    './config': {
      API_BASE_URL: 'https://api.example.test/v2',
      AUTH_BASE_URL: 'https://api.example.test/v0',
      buildAuthUrl: (path) => `https://api.example.test/v0${path}`,
      buildUrl: (base, path) => `${base}${path}`,
    },
    './authTokens': {
      getAccessToken: () => state.accessToken,
      getTokenSubject: () => 'member-1',
      isAccessTokenExpired: () => expired,
      setAuthTokens: ({ accessToken: next }) => {
        state.cleared += 1
        state.accessToken = next
      },
    },
    './httpClientHelpers': { debugLog: (...args) => state.logs.push(JSON.stringify(args)) },
    './authSession': {
      refreshSession: async () => {
        state.refreshCalls += 1
        if (refresh.kind === 'refreshed') state.accessToken = refresh.token
        return refresh
      },
    },
    './errorMessage': loadModule('../src/shared/api/errorMessage.ts'),
  }, {
    fetch: async (url, init) => {
      state.fetches.push({ url, init })
      return queue.shift()()
    },
  })
  return { httpClient, state }
}

test('anonymous requests skip token refresh even when an expired token and dead cookie remain', async () => {
  const { httpClient, state } = createAnonymousHarness({
    responses: [() => new Response(null, { status: 202 })],
  })
  await httpClient('https://api.example.test/v0/email-codes', {
    method: 'POST', json: { email: 'a@example.com', purpose: 'PASSWORD_RESET' }, anonymous: true,
  })
  assert.equal(state.refreshCalls, 0)
  assert.equal(state.fetches.length, 1)
  assert.equal('Authorization' in state.fetches[0].init.headers, false)
  assert.equal('anonymous' in state.fetches[0].init, false)
  assert.equal(state.accessToken, 'expired-jwt', 'an anonymous request leaves the stored token alone')
})

test('anonymous 401 responses surface the server message without refreshing or clearing tokens', async () => {
  const payload = { message: '아이디 또는 비밀번호가 올바르지 않습니다.' }
  const { httpClient, state } = createAnonymousHarness({
    responses: [() => Response.json(payload, { status: 401 })],
  })
  await assert.rejects(httpClient('https://api.example.test/v0/login', {
    method: 'POST', json: { username: 'u', password: 'p' }, anonymous: true,
  }), { status: 401, message: payload.message })
  assert.equal(state.refreshCalls, 0)
  assert.equal(state.cleared, 0)
})

test('authenticated requests still refresh an expired token first', async () => {
  const { httpClient, state } = createAnonymousHarness({ responses: [] })
  await assert.rejects(httpClient('/schedules'), { status: 401 })
  assert.equal(state.refreshCalls, 1)
  assert.equal(state.fetches.length, 0)
})

// 세션이 끝났다는 답(401/403)만 저장된 토큰을 지운다. 답이 없으면 토큰을 두고 네트워크 오류로 알린다.
const transientRefresh = { kind: 'transient', status: 502, data: '<html>Bad Gateway</html>' }

test('a transient preflight refresh keeps the stored token and fails as a network error', async () => {
  const { httpClient, state } = createAnonymousHarness({ responses: [], refresh: transientRefresh })
  await assert.rejects(httpClient('/schedules'), (error) => {
    assert.equal(error.name, 'ApiError')
    assert.equal(error.status, 0)
    assert.equal(errorMessage.readFailureMessage(error), undefined, 'the 502 page carries no wording')
    assert.equal(error.responseStatus, 502)
    assert.equal(
      errorMessage.getRequestFailureMessage(error, ACTION),
      `${ACTION} 잠시 후 다시 시도해 주세요.`,
      'the server answered, so the hint is to retry later rather than to check the connection',
    )
    return true
  })
  assert.equal(state.refreshCalls, 1)
  assert.equal(state.fetches.length, 0, 'the protected request is not sent without a token')
  assert.equal(state.cleared, 0)
  assert.equal(state.accessToken, 'expired-jwt')
})

test('a transient refresh answered with a server message keeps the token and shows that message', async () => {
  const { httpClient, state } = createAnonymousHarness({
    responses: [],
    refresh: { kind: 'transient', status: 429, data: { message: '요청이 많아요. 잠시 후 다시 시도해 주세요.' } },
  })
  await assert.rejects(httpClient('/schedules'), (error) => {
    assert.equal(error.status, 0, 'still a network-type failure, never a logout')
    assert.equal(error.responseStatus, 429)
    assert.equal(errorMessage.readFailureMessage(error), '요청이 많아요. 잠시 후 다시 시도해 주세요.')
    assert.equal(errorMessage.getRequestFailureMessage(error, ACTION), '요청이 많아요. 잠시 후 다시 시도해 주세요.')
    return true
  })
  assert.equal(state.cleared, 0)
  assert.equal(state.accessToken, 'expired-jwt')
})

test('a transient refresh without any answer keeps the connection hint', async () => {
  const { httpClient } = createAnonymousHarness({
    responses: [],
    refresh: { kind: 'transient', status: 0, data: new TypeError('Failed to fetch') },
  })
  await assert.rejects(httpClient('/schedules'), (error) => {
    assert.equal(error.status, 0)
    assert.equal(error.responseStatus, undefined)
    assert.equal(errorMessage.readFailureMessage(error), undefined)
    assert.equal(errorMessage.getRequestFailureMessage(error, ACTION), `${ACTION} 인터넷 연결을 확인한 뒤 다시 시도해 주세요.`)
    return true
  })
})

test('an unauthorized preflight refresh clears the stored token and asks to log in', async () => {
  const { httpClient, state } = createAnonymousHarness({ responses: [] })
  await assert.rejects(httpClient('/schedules'), { status: 401, message: '로그인이 필요해요. 다시 로그인해 주세요.' })
  assert.equal(state.accessToken, null)
})

test('a transient refresh after a server 401 keeps the token and fails as a network error', async () => {
  const { httpClient, state } = createAnonymousHarness({
    expired: false,
    refresh: { kind: 'transient', status: 0, data: new TypeError('Failed to fetch') },
    responses: [() => Response.json({ message: 'expired' }, { status: 401 })],
  })
  await assert.rejects(httpClient('/schedules'), { name: 'ApiError', status: 0 })
  assert.equal(state.refreshCalls, 1)
  assert.equal(state.fetches.length, 1, 'no retry without a new token')
  assert.equal(state.cleared, 0)
  assert.equal(state.accessToken, 'expired-jwt')
})

test('an unauthorized refresh after a server 401 clears the token and fails with a 401', async () => {
  const { httpClient, state } = createAnonymousHarness({
    expired: false,
    responses: [() => Response.json({ message: 'expired' }, { status: 401 })],
  })
  await assert.rejects(httpClient('/schedules'), { name: 'ApiError', status: 401 })
  assert.equal(state.refreshCalls, 1)
  assert.equal(state.accessToken, null)
})

test('a refreshed token after a server 401 retries the request once', async () => {
  const { httpClient, state } = createAnonymousHarness({
    expired: false,
    refresh: { kind: 'refreshed', token: 'fresh-jwt' },
    responses: [() => new Response(null, { status: 401 }), () => Response.json({ ok: true })],
  })
  assert.deepEqual({ ...(await httpClient('/schedules')) }, { ok: true })
  assert.equal(state.fetches.length, 2)
  assert.equal(state.fetches[1].init.headers.Authorization, 'Bearer fresh-jwt')
})

for (const path of ['/password-reset', '/email-codes', '/me/email-codes', '/me/email']) {
  test(`email auth request bodies stay out of debug logs: ${path}`, async () => {
    const { httpClient, state } = createAnonymousHarness({
      accessToken: null,
      responses: [() => new Response(null, { status: 204 })],
    })
    await httpClient(`https://api.example.test/v0${path}`, {
      method: 'POST', json: { email: 'secret@example.com', code: '987654', newPassword: 'secretpass1' },
    })
    assert.ok(state.logs.length > 0)
    for (const secret of ['987654', 'secretpass1', 'secret@example.com']) {
      assert.ok(state.logs.every((line) => !line.includes(secret)), `${secret} leaked for ${path}`)
    }
  })
}
