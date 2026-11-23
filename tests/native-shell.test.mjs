import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const load = (relativePath, requires = {}, globals = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  const require = (name) => {
    if (name in requires) return requires[name]
    throw new Error('Unexpected dependency ' + name)
  }
  vm.runInNewContext(outputText, { module, exports: module.exports, require, ...globals })
  return module.exports
}

const rules = load('../src/shared/native/nativeShellRules.ts')

test('핀잇 앱의 WebView는 User-Agent의 표식으로 안다', () => {
  assert.equal(rules.isNativeShellUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 PinitApp/1'), true)
  assert.equal(rules.isNativeShellUserAgent('Mozilla/5.0 (Linux; Android 15) Chrome/130 Mobile Safari/537.36 PinitApp/2'), true)
  assert.equal(rules.isNativeShellUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1'), false)
  assert.equal(rules.isNativeShellUserAgent(''), false)
  assert.equal(rules.isNativeShellUserAgent(undefined), false)
  assert.equal(rules.isNativeShellUserAgent(null), false)
})

test('오늘과 로그인은 앱이 그린다', () => {
  for (const path of ['/', '/login', '/login/', '/app', '/app/', '/app/today', '/app/today/'])
    assert.equal(rules.isNativeRoute(path), true, path)
})

test('일정·작업 목록과 그 밖의 화면은 웹이 그린다', () => {
  for (const path of [
    '/app/tasks', '/app/schedules', '/app/tasks/12', '/app/schedules/new', '/app/statistics', '/app/settings',
    '/app/todayish', '/signup', '/forgot-password', '/login/callback/naver', '/email-registration', '/spaces/join/abc',
  ])
    assert.equal(rules.isNativeRoute(path), false, path)
})

test('목록으로 돌아가는 이동에 실린 닫기 표식을 읽는다', () => {
  assert.equal(rules.isNativeCloseState({ [rules.NATIVE_CLOSE_STATE]: true }), true)
  assert.equal(rules.isNativeCloseState({ [rules.NATIVE_CLOSE_STATE]: 'true' }), false)
  assert.equal(rules.isNativeCloseState({ backgroundLocation: {} }), false)
  assert.equal(rules.isNativeCloseState(null), false)
  assert.equal(rules.isNativeCloseState(undefined), false)
})

test('앱이 돌려준 갱신 결과만 받아들인다', () => {
  assert.equal(rules.isNativeRefreshReply({ id: 'r1', kind: 'token', token: 't' }), true)
  assert.equal(rules.isNativeRefreshReply({ id: 'r1', kind: 'unauthorized' }), true)
  assert.equal(rules.isNativeRefreshReply({ id: 'r1', kind: 'transient' }), true)
  for (const value of [null, 'x', {}, { id: 'r1' }, { id: '', kind: 'unauthorized' }, { id: 'r1', kind: 'token' }, { id: 'r1', kind: 'token', token: '' }, { id: 7, kind: 'transient' }, { id: 'r1', kind: 'refreshed' }])
    assert.equal(rules.isNativeRefreshReply(value), false, JSON.stringify(value))
})

// 세션 갱신: 앱 안에서는 쿠키 요청 대신 앱이 답한다(setRefreshTransport).
const sessionWith = (fetchImpl) => {
  let token = 'stale'
  const tokens = {
    getAccessToken: () => token,
    isAccessTokenExpired: () => false,
    isLoggedOut: () => false,
    setAuthTokens: ({ accessToken }) => {
      token = accessToken
    },
  }
  const session = load(
    '../src/shared/api/authSession.ts',
    { './config': { buildAuthUrl: (path) => 'https://fixture.invalid/v0' + path }, './authTokens': tokens },
    { fetch: fetchImpl, AbortController, setTimeout, clearTimeout, Date, Promise },
  )
  return { session, stored: () => token }
}

test('전송을 바꾸지 않으면 쿠키로 /v0/refresh를 부른다', async () => {
  const calls = []
  const { session, stored } = sessionWith(async (url, init) => {
    calls.push([url, init.method, init.credentials])
    return { status: 200, ok: true, text: async () => JSON.stringify({ token: 'from-cookie' }) }
  })
  const result = await session.refreshSession()
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { kind: 'refreshed', token: 'from-cookie' })
  assert.deepEqual(calls, [['https://fixture.invalid/v0/refresh', 'POST', 'include']])
  assert.equal(stored(), 'from-cookie')
})

test('앱이 준 토큰을 저장하고 /v0/refresh는 부르지 않는다', async () => {
  let fetched = 0
  const { session, stored } = sessionWith(async () => {
    fetched += 1
    throw new Error('must not be called')
  })
  const limits = []
  session.setRefreshTransport(async (timeoutMs) => {
    limits.push(timeoutMs)
    return { kind: 'token', token: 'from-app' }
  })
  const result = await session.refreshSession()
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { kind: 'refreshed', token: 'from-app' })
  assert.equal(stored(), 'from-app')
  assert.equal(fetched, 0)
  assert.deepEqual(limits, [session.REFRESH_TIMEOUT_MS])
})

test('앱이 세션이 끝났다고 하면 unauthorized, 답이 없으면 transient다', async () => {
  const { session, stored } = sessionWith(async () => {
    throw new Error('must not be called')
  })
  session.setRefreshTransport(async () => ({ kind: 'transient', status: 0, data: null }))
  assert.equal((await session.refreshSession()).kind, 'transient')
  assert.equal(stored(), 'stale')
  session.setRefreshTransport(async () => ({ kind: 'unauthorized' }))
  assert.equal((await session.refreshSession()).kind, 'unauthorized')
  assert.equal(stored(), 'stale')
})
