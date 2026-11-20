import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { apiError, errorMessage, requireFrom } from './support/errors.mjs'

const load = (relativePath, dependencies = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, require: requireFrom(dependencies) })
  return module.exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))

const setup = () => {
  const requests = []
  const api = load('../src/features/mind-map/api/mindMapApi.ts', {
    '@shared/api/config': { buildApiUrl: (path, version) => `https://api.test/${version}${path}` },
    '@shared/api/httpClient': { httpClient: async (url, options = {}) => { requests.push({ url, options }); return {} } },
  })
  return { api, requests }
}

test('경로, 메서드, 본문, keepalive', async () => {
  const { api, requests } = setup()
  await api.fetchMindMap()
  await api.saveMindMap({ expectedVersion: 3, saveId: 's', root: { id: 'r' } }, { keepalive: true })
  await api.saveMindMapCursor('c')
  assert.deepEqual(requests.map((r) => [r.url, r.options.method ?? 'GET']), [
    ['https://api.test/v2/mind-map', 'GET'], ['https://api.test/v2/mind-map', 'PUT'], ['https://api.test/v2/mind-map/cursor', 'PUT'],
  ])
  assert.equal(JSON.stringify(requests[1].options.json), '{"expectedVersion":3,"saveId":"s","root":{"id":"r"}}')
  assert.equal(requests[1].options.keepalive, true)
  assert.equal(JSON.stringify(requests[2].options.json), '{"nodeId":"c"}')
})

test('저장 실패를 셋으로 가른다', () => {
  const { api } = setup()
  assert.deepEqual(plain(api.classifySaveError(apiError('먼저 바뀌었어요.', 409, { code: 'VERSION_CONFLICT', latestVersion: 4, lastSaveId: 's1' }))),
    { kind: 'conflict', latestVersion: 4, lastSaveId: 's1', message: '먼저 바뀌었어요.' })
  const rejected = api.classifySaveError(apiError('가지 글을 적어 주세요.', 400, { errors: [{ field: 'x', rejectedValue: 'TEXT_EMPTY', reason: '가지 글을 적어 주세요.' }] }))
  assert.deepEqual(plain(rejected.violations), [{ nodeId: 'x', rule: 'TEXT_EMPTY', reason: '가지 글을 적어 주세요.' }])
  assert.equal(api.classifySaveError(apiError('', 409, { code: 'MEMBER_WITHDRAWN' })).kind, 'rejected')
  assert.equal(api.classifySaveError(apiError('', 503, null)).kind, 'lost')
  assert.equal(api.classifySaveError(apiError('', 0, null)).kind, 'lost')
  assert.equal(api.classifySaveError(Object.assign(new Error('aborted'), { name: 'AbortError' })).kind, 'lost')
})

test('문구가 없으면 기본 문구를 쓴다', () => {
  const { api } = setup()
  assert.equal(api.classifySaveError(apiError('', 409, { code: 'VERSION_CONFLICT', latestVersion: 4, lastSaveId: null })).message,
    '다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러왔어요.')
  assert.equal(api.classifySaveError(apiError('', 409, { code: 'VERSION_CONFLICT', latestVersion: 4, lastSaveId: null })).lastSaveId, null)
  assert.equal(api.classifySaveError(apiError('', 409, { code: 'MEMBER_WITHDRAWN' })).message, '마인드맵을 저장하지 못했어요.')
  assert.equal(api.classifySaveError(apiError('', 503, null)).message, '마인드맵을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
  assert.equal(api.classifySaveError(apiError('Failed to fetch', 0, null)).message, '마인드맵을 저장하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
})

test('BE의 실패 본문 그대로를 가른다', () => {
  const { api } = setup()
  // httpClient처럼 본문에서 문구를 꺼내 ApiError를 만든다.
  const answered = (status, body) => apiError(errorMessage.getApiErrorMessage(body), status, body)
  const page = { timestamp: '2026-11-20T00:00:00Z', path: 'uri=/v2/mind-map' }
  const shape = '마인드맵의 내용을 읽지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.'
  const withdrawn = api.classifySaveError(answered(409,
    { code: 'MEMBER_WITHDRAWN', message: '탈퇴한 회원의 마인드맵은 쓸 수 없어요.', latestVersion: null, lastSaveId: null }))
  assert.deepEqual(plain(withdrawn), { kind: 'rejected', message: '탈퇴한 회원의 마인드맵은 쓸 수 없어요.', violations: [] })
  const unreadableBody = api.classifySaveError(answered(400,
    { ...page, status: 400, error: 'Bad Request', message: '요청을 처리하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.', errors: [] }))
  assert.deepEqual(plain(unreadableBody),
    { kind: 'rejected', message: '요청을 처리하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.', violations: [] })
  const typeMismatch = api.classifySaveError(answered(400,
    { ...page, status: 400, error: 'Bad Request', message: shape, errors: [{ field: 'root.children[0].children', rejectedValue: null, reason: shape }] }))
  assert.equal(typeMismatch.kind, 'rejected')
  assert.equal(typeMismatch.message, shape)
  const unreadable = api.classifySaveError(answered(500,
    { ...page, status: 500, error: 'Internal Server Error', message: '저장된 마인드맵을 읽지 못했어요. 잠시 후 다시 시도해 주세요.', errors: [] }))
  assert.deepEqual(plain(unreadable), { kind: 'lost', message: '저장된 마인드맵을 읽지 못했어요. 잠시 후 다시 시도해 주세요.' })
  const conflict = api.classifySaveError(answered(409,
    { code: 'VERSION_CONFLICT', message: '다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 고쳐 주세요.', latestVersion: 7, lastSaveId: null }))
  assert.deepEqual(plain(conflict), {
    kind: 'conflict', latestVersion: 7, lastSaveId: null, message: '다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 고쳐 주세요.',
  })
})
