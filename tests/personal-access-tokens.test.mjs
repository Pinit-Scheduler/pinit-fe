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

const pat = loadModule('../src/features/settings/utils/personalAccessTokens.ts')
const mcp = loadModule('../src/features/settings/utils/mcpConnection.ts')

const NOW = Date.parse('2026-10-24T00:00:00Z')
const token = (overrides = {}) => ({
  id: 1,
  name: 'Claude Code',
  tokenPrefix: 'abc123def456',
  scopes: ['mcp:read'],
  createdAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-12-30T00:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
  ...overrides,
})

test('token status follows the backend rule: revoked, then expired at or before now, else active', () => {
  assert.equal(pat.getTokenStatus(token(), NOW), 'active')
  assert.equal(pat.getTokenStatus(token({ expiresAt: '2026-10-24T00:00:00Z' }), NOW), 'expired')
  assert.equal(pat.getTokenStatus(token({ expiresAt: '2026-10-23T23:59:59Z' }), NOW), 'expired')
  assert.equal(pat.getTokenStatus(token({ revokedAt: '2026-10-02T00:00:00Z' }), NOW), 'revoked')
  assert.equal(
    pat.getTokenStatus(token({ expiresAt: '2026-10-01T00:00:00Z', revokedAt: '2026-09-30T00:00:00Z' }), NOW),
    'revoked',
  )
})

test('only active tokens count toward the 10-token limit', () => {
  const tokens = [
    token({ id: 1 }),
    token({ id: 2, expiresAt: '2026-10-01T00:00:00Z' }),
    token({ id: 3, revokedAt: '2026-10-02T00:00:00Z' }),
    token({ id: 4 }),
  ]
  assert.equal(pat.countActiveTokens(tokens, NOW), 2)
  assert.equal(pat.MAX_ACTIVE_PERSONAL_ACCESS_TOKENS, 10)
})

test('create form validation rejects blank or long names and out-of-range expiry', () => {
  const valid = { name: 'Claude Code', access: 'read', expiresInDays: 90 }
  assert.deepEqual({ ...pat.validateCreateForm(valid) }, {})
  assert.ok(pat.validateCreateForm({ ...valid, name: '   ' }).name)
  assert.ok(pat.validateCreateForm({ ...valid, name: 'a'.repeat(101) }).name)
  assert.equal(pat.validateCreateForm({ ...valid, name: ` ${'a'.repeat(100)} ` }).name, undefined)
  for (const expiresInDays of [0, 366, 1.5, Number.NaN]) {
    assert.ok(pat.validateCreateForm({ ...valid, expiresInDays }).expiresInDays, `expiresInDays=${expiresInDays}`)
  }
  assert.ok(pat.EXPIRY_DAY_OPTIONS.every((days) => days >= 1 && days <= pat.MAX_EXPIRY_DAYS))
  assert.ok(pat.EXPIRY_DAY_OPTIONS.includes(pat.DEFAULT_EXPIRY_DAYS))
})

test('create request trims the name and maps access to the backend scope lists', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(pat.toCreateRequest({ name: '  Claude  ', access: 'read', expiresInDays: 30 }))),
    { name: 'Claude', scopes: ['mcp:read'], expiresInDays: 30 },
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(pat.toCreateRequest({ name: 'Claude', access: 'write', expiresInDays: 365 }))),
    { name: 'Claude', scopes: ['mcp:read', 'mcp:write'], expiresInDays: 365 },
  )
  assert.equal(pat.accessFromScopes(['mcp:read', 'mcp:write']), 'write')
  assert.equal(pat.accessFromScopes(['mcp:read']), 'read')
})

test('created token metadata kept in list state never carries the plaintext token', () => {
  const metadata = pat.toTokenMetadata({
    id: 7,
    name: 'Claude',
    token: 'pinit_pat_abc123def456_secret',
    tokenPrefix: 'abc123def456',
    scopes: ['mcp:read'],
    createdAt: '2026-10-24T00:00:00Z',
    expiresAt: '2027-01-22T00:00:00Z',
  })
  assert.equal('token' in metadata, false)
  assert.ok(!JSON.stringify(metadata).includes('secret'))
  assert.equal(pat.getTokenStatus(metadata, NOW), 'active')
  assert.equal(pat.formatTokenHint('abc123def456'), 'pinit_pat_abc123def456_…')
})

test('limit conflicts get the shared 409 prefix and missing tokens get a 404 message', () => {
  const limit = { status: 409, message: '활성 개인 액세스 토큰은 최대 10개까지 보유할 수 있습니다.' }
  assert.equal(pat.toCreateErrorMessage(limit), `${pat.CONFLICT_MESSAGE_PREFIX} ${limit.message}`)
  assert.equal(pat.toCreateErrorMessage({ status: 400, message: '토큰 이름은 비어 있을 수 없습니다.' }), '토큰 이름은 비어 있을 수 없습니다.')
  assert.equal(pat.toCreateErrorMessage(null), '토큰을 발급하지 못했어요.')
  assert.match(pat.toRevokeErrorMessage({ status: 404, message: 'Not Found' }), /찾을 수 없어요/)
  assert.equal(pat.toRevokeErrorMessage({ status: 0, message: 'Failed to fetch' }), 'Failed to fetch')
})

test('MCP guide renders the documented Claude Code command and a parseable JSON config', () => {
  const url = 'https://mono.pinit.go-gradually.me/mcp'
  assert.equal(
    mcp.buildClaudeCodeCommand(url),
    'claude mcp add --transport http pinit https://mono.pinit.go-gradually.me/mcp --header "Authorization: Bearer <PAT>"',
  )
  assert.deepEqual(JSON.parse(mcp.buildMcpJsonConfig(url)), {
    mcpServers: {
      pinit: { type: 'http', url, headers: { Authorization: 'Bearer <PAT>' } },
    },
  })
})

test('PAT API calls hit /v2/personal-access-tokens and mark the create response sensitive', async () => {
  const calls = []
  const api = loadModule('../src/features/settings/api/personalAccessTokens.ts', {
    '@shared/api/config': { buildApiUrl: (path, version) => `https://api.example.test/${version}${path}` },
    '@shared/api/httpClient': {
      httpClient: async (url, options) => {
        calls.push({ url, options })
        return undefined
      },
    },
  })
  await api.fetchPersonalAccessTokens()
  await api.createPersonalAccessToken({ name: 'Claude', scopes: ['mcp:read'], expiresInDays: 90 })
  await api.revokePersonalAccessToken(42)

  assert.deepEqual(calls.map(({ url, options }) => [url, options?.method ?? 'GET']), [
    ['https://api.example.test/v2/personal-access-tokens', 'GET'],
    ['https://api.example.test/v2/personal-access-tokens', 'POST'],
    ['https://api.example.test/v2/personal-access-tokens/42', 'DELETE'],
  ])
  assert.deepEqual(calls[1].options.json, { name: 'Claude', scopes: ['mcp:read'], expiresInDays: 90 })
  assert.equal(calls[1].options.sensitiveResponse, true)
  assert.equal(calls[0].options?.sensitiveResponse, undefined)
})

test('httpClient keeps sensitive response bodies out of debug logs and fetch options', async () => {
  const plaintext = 'pinit_pat_abc123def456_secretsecretsecret'
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
      createCookieTokenRefresher: () => async () => null,
    },
    './errorMessage': loadModule('../src/shared/api/errorMessage.ts'),
  }, {
    fetch: async (_url, init) => {
      fetchInits.push(init)
      return Response.json({ id: 1, token: plaintext }, { status: 201 })
    },
  })

  const created = await httpClient('/personal-access-tokens', {
    method: 'POST', json: { name: 'Claude' }, sensitiveResponse: true,
  })
  assert.equal(created.token, plaintext)
  assert.ok(logs.length > 0)
  assert.ok(logs.every((line) => !line.includes(plaintext)))
  assert.equal('sensitiveResponse' in fetchInits[0], false)
  assert.equal(fetchInits[0].headers.Authorization, 'Bearer access-jwt')

  logs.length = 0
  await httpClient('/personal-access-tokens', { method: 'POST', json: { name: 'Claude' } })
  assert.ok(logs.some((line) => line.includes(plaintext)), 'non-sensitive responses are still logged in debug mode')
})
