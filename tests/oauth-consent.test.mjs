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
    URL,
    ...globals,
  })
  return module.exports
}

const returnTo = loadModule('../src/features/auth/utils/returnTo.ts')
const consent = loadModule('../src/features/oauth/utils/consent.ts')

const createStorage = () => {
  const values = new Map()
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

const NOW = Date.parse('2026-10-24T00:00:00Z')

test('login return path survives a round trip once and only for same-origin app paths', () => {
  const storage = createStorage()
  returnTo.rememberReturnTo('/oauth/consent?request=abc123', storage, NOW)
  assert.equal(returnTo.consumeReturnTo(storage, NOW + 60_000), '/oauth/consent?request=abc123')
  assert.equal(returnTo.consumeReturnTo(storage, NOW + 60_000), null, 'consumed values are cleared')

  for (const unsafe of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', '/a\nb', '']) {
    returnTo.rememberReturnTo(unsafe, storage, NOW)
    assert.equal(returnTo.consumeReturnTo(storage, NOW), null, `rejects ${JSON.stringify(unsafe)}`)
  }
  for (const authPath of ['/login', '/login/callback/naver?code=x', '/signup']) {
    returnTo.rememberReturnTo(authPath, storage, NOW)
    assert.equal(returnTo.consumeReturnTo(storage, NOW), null, `does not return to ${authPath}`)
  }
})

test('stale or tampered return paths fall back to the default destination', () => {
  const storage = createStorage()
  returnTo.rememberReturnTo('/oauth/consent?request=old', storage, NOW)
  assert.equal(returnTo.consumeReturnTo(storage, NOW + returnTo.RETURN_TO_TTL_MS + 1), null)

  storage.setItem('pinit.authReturnTo', JSON.stringify({ path: '//evil.example', savedAt: NOW }))
  assert.equal(returnTo.consumeReturnTo(storage, NOW), null)
  storage.setItem('pinit.authReturnTo', 'not json')
  assert.equal(returnTo.consumeReturnTo(storage, NOW), null)
  assert.equal(returnTo.consumeReturnTo(null, NOW), null)
})

test('consent return uses a full page load so the anti-framing headers apply', () => {
  assert.deepEqual({ ...returnTo.resolvePostLoginTarget('/oauth/consent?request=abc') }, {
    path: '/oauth/consent?request=abc',
    fullPageLoad: true,
  })
  assert.deepEqual({ ...returnTo.resolvePostLoginTarget('/app/settings') }, { path: '/app/settings', fullPageLoad: false })
  assert.deepEqual({ ...returnTo.resolvePostLoginTarget(null) }, { path: '/app', fullPageLoad: false })
})

test('optInScopes render unchecked and are granted only when the user checks them', () => {
  const requested = ['mcp:read', 'mcp:write']
  const optIn = ['mcp:delete']
  const options = consent.buildConsentScopeOptions(requested, optIn)
  assert.deepEqual([...options.map((o) => [o.scope, o.required, o.defaultChecked])], [
    ['mcp:read', true, true],
    ['mcp:write', false, true],
    ['mcp:delete', false, false],
  ])
  assert.equal(options[2].label, '일정·작업 삭제 (AI가 삭제할 때마다 미리보기 후 확인)')
  assert.ok(options[2].warning, 'delete carries a warning')

  const defaults = consent.getDefaultSelectedScopes(requested, optIn)
  assert.deepEqual([...defaults], ['mcp:write'])
  assert.deepEqual([...consent.toDecisionScopes(requested, optIn, defaults)], ['mcp:read', 'mcp:write'])
  assert.deepEqual([...consent.toDecisionScopes(requested, optIn, [...defaults, 'mcp:delete'])], ['mcp:read', 'mcp:write', 'mcp:delete'])
  assert.deepEqual([...consent.toDecisionScopes(requested, optIn, ['mcp:delete'])], ['mcp:read', 'mcp:delete'])
})

test('a missing optInScopes (current backend) behaves like an empty list', () => {
  for (const missing of [undefined, null, []]) {
    assert.deepEqual([...consent.buildConsentScopeOptions(['mcp:read', 'mcp:write'], missing).map((o) => o.scope)], [
      'mcp:read',
      'mcp:write',
    ])
    assert.deepEqual([...consent.toDecisionScopes(['mcp:read', 'mcp:write'], missing, ['mcp:write', 'mcp:delete'])], [
      'mcp:read',
      'mcp:write',
    ], 'scopes that were never offered are not sent')
  }
})

test('opt-in wins over requested, and unknown scopes in either list show raw and unchecked', () => {
  // 같은 scope가 양쪽에 오면 더 안전한 쪽(체크 해제)으로 보인다.
  const both = consent.buildConsentScopeOptions(['mcp:read', 'mcp:write'], ['mcp:write'])
  assert.deepEqual([...both.map((o) => [o.scope, o.defaultChecked])], [['mcp:read', true], ['mcp:write', false]])
  // 필수 scope는 opt-in으로 와도 해제할 수 없다.
  assert.equal(consent.buildConsentScopeOptions([], ['mcp:read'])[0].required, true)

  const options = consent.buildConsentScopeOptions(['mcp:read', 'mcp:future'], ['mcp:later'])
  assert.deepEqual([...options.map((o) => [o.scope, o.label, o.defaultChecked, Boolean(o.unknown)])], [
    ['mcp:read', '일정·작업 보기', true, false],
    ['mcp:future', 'mcp:future', false, true],
    ['mcp:later', 'mcp:later', false, true],
  ])
})

test('requestedScopes fallback: delete listed there still starts unchecked', () => {
  const requested = ['mcp:read', 'mcp:write', 'mcp:delete']
  assert.deepEqual([...consent.getDefaultSelectedScopes(requested)], ['mcp:write'])
  assert.deepEqual([...consent.toDecisionScopes(requested, [], [])], ['mcp:read'])
  assert.deepEqual([...consent.toDecisionScopes(requested, undefined, ['mcp:delete'])], ['mcp:read', 'mcp:delete'])
})

test('only offered scopes can be approved, and read is always included', () => {
  assert.deepEqual([...consent.toDecisionScopes(['mcp:read'], [], ['mcp:write', 'mcp:delete'])], ['mcp:read'])
  assert.deepEqual([...consent.toDecisionScopes(['mcp:write'], [], ['mcp:write'])], ['mcp:read', 'mcp:write'], 'write implies read')
  assert.deepEqual([...consent.toDecisionScopes([], [], [])], ['mcp:read'])
  assert.equal(consent.hasDeleteScope(['mcp:read', 'mcp:delete']), true)
  assert.equal(consent.hasDeleteScope(['mcp:read', 'mcp:write']), false)
})

test('only http(s) redirect URIs are followed, including localhost and other origins', () => {
  for (const uri of ['http://localhost:6274/callback?code=x&state=y', 'http://127.0.0.1:33418/cb', 'https://claude.ai/api/mcp/auth_callback?code=x']) {
    assert.equal(consent.isNavigableRedirectUri(uri), true, uri)
  }
  for (const uri of ['javascript:alert(1)', 'data:text/html,hi', '/relative', '', null, undefined]) {
    assert.equal(consent.isNavigableRedirectUri(uri), false, String(uri))
  }
})

test('request expiry and API errors map to the consent screen states', () => {
  assert.equal(consent.isRequestExpired('2026-10-24T00:10:00Z', NOW), false)
  assert.equal(consent.isRequestExpired('2026-10-24T00:00:00Z', NOW), true)
  assert.equal(consent.isRequestExpired('garbage', NOW), true)

  assert.equal(consent.toConsentError({ status: 404, message: 'Not Found' }).kind, 'expired')
  assert.equal(consent.toConsentError({ status: 404 }).message, consent.EXPIRED_REQUEST_MESSAGE)
  assert.equal(consent.toConsentError({ status: 401 }).kind, 'unauthorized')
  assert.equal(consent.toConsentError({ status: 0, message: 'Failed to fetch' }).kind, 'network')
  assert.deepEqual({ ...consent.toConsentError({ status: 409, message: '이미 처리된 요청입니다.' }) }, {
    kind: 'unknown',
    message: '이미 처리된 요청입니다.',
  })
})

test('OAuth API calls follow the fixed O1/O3 contract and hide the code-bearing redirect from logs', async () => {
  const calls = []
  const api = loadModule('../src/features/oauth/api/oauth.ts', {
    '@shared/api/config': {
      buildApiUrl: (path, version) => `https://mono.example.test${version ? `/${version}` : ''}${path}`,
    },
    '@shared/api/httpClient': {
      httpClient: async (url, options) => {
        calls.push({ url, options })
        return undefined
      },
    },
  })

  await api.fetchAuthorizationRequest('req/1')
  await api.submitAuthorizationDecision({ requestId: 'req1', approve: true, scopes: ['mcp:read'] })
  await api.fetchOAuthGrants()
  await api.revokeOAuthGrant(7)

  assert.deepEqual(calls.map(({ url, options }) => [url, options?.method ?? 'GET']), [
    ['https://mono.example.test/oauth/authorize/requests/req%2F1', 'GET'],
    ['https://mono.example.test/oauth/authorize/decision', 'POST'],
    ['https://mono.example.test/v2/oauth/grants', 'GET'],
    ['https://mono.example.test/v2/oauth/grants/7', 'DELETE'],
  ])
  assert.deepEqual(calls[1].options.json, { requestId: 'req1', approve: true, scopes: ['mcp:read'] })
  assert.equal(calls[1].options.sensitiveResponse, true)
})

test('production frames are denied for the consent route', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const oauthHeaders = config.headers.find((entry) => entry.source === '/oauth/(.*)')
  assert.ok(oauthHeaders, 'vercel.json has an /oauth/(.*) header rule')
  const values = Object.fromEntries(oauthHeaders.headers.map(({ key, value }) => [key, value]))
  assert.equal(values['X-Frame-Options'], 'DENY')
  assert.equal(values['Content-Security-Policy'], "frame-ancestors 'none'")
})

test('settings AI connection shows one Claude Code command and a device count only above one', () => {
  const settings = loadModule('../src/features/settings/utils/mcpConnection.ts')
  assert.equal(
    settings.buildClaudeCodeCommand('https://mono.pinit.go-gradually.me/mcp'),
    'claude mcp add --transport http pinit https://mono.pinit.go-gradually.me/mcp',
  )
  assert.equal(settings.formatConnectionCount(3), '기기 3개')
  assert.equal(settings.formatConnectionCount(2), '기기 2개')
  for (const value of [1, 0, undefined, null, 2.5, '3']) {
    assert.equal(settings.formatConnectionCount(value), null, `hides ${String(value)}`)
  }
})
