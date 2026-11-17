import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { setup } from './support/mocks.mjs'

const load = (relativePath, dependencies = {}) => {
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
  })
  return module.exports
}

const setupApi = () => {
  const requests = []
  const api = load('../src/features/notices/api/notices.ts', {
    '@shared/api/config': { buildApiUrl: (path, version) => `https://api.test/${version}${path}` },
    '@shared/api/httpClient': { httpClient: async (url, options = {}) => { requests.push({ url, options }); return {} } },
  })
  return { api, requests }
}

test('알림함 호출의 경로와 본문', async () => {
  const { api, requests } = setupApi()
  await api.fetchNotices()
  await api.fetchUnreadNoticeCount()
  await api.readNotice('3f2b6c1e-0000-4000-8000-000000000001')
  await api.readNotices()
  await api.readNotices({ kind: 'SPLIT_READY', requestId: 31 })
  assert.equal(requests[0].url, 'https://api.test/v2/notifications/notices')
  assert.equal(requests[1].url, 'https://api.test/v2/notifications/notices/unread-count')
  assert.equal(requests[2].url, 'https://api.test/v2/notifications/notices/3f2b6c1e-0000-4000-8000-000000000001/read')
  assert.equal(requests[2].options.method, 'POST')
  assert.equal(requests[3].url, 'https://api.test/v2/notifications/notices/read')
  assert.equal(JSON.stringify(requests[3].options.json), '{}')
  assert.equal(JSON.stringify(requests[4].options.json), '{"kind":"SPLIT_READY","requestId":31}')
})
test('mock 알림함: 목록, 하나 읽기, 묶어 읽기', async () => {
  const { api, split } = setup()
  const f = split.mockSplitFixtures
  const list = (await api('/v2/notifications/notices')).body
  assert.equal(list.unreadCount, 2)
  assert.equal(list.items[0].kind, 'SPLIT_READY')
  assert.equal(list.items[0].requestId, f.ready.requestId)
  assert.equal(list.items[0].originalTitle, '온보딩 개편 설계')
  assert.equal(list.items[0].readAt, null)
  assert.equal((await api(`/v2/notifications/notices/${list.items[0].noticeId}/read`, 'POST')).status, 204)
  assert.equal((await api('/v2/notifications/notices/unread-count')).body.unreadCount, 1)
  assert.equal((await api('/v2/notifications/notices/read', 'POST', { kind: 'SPLIT_READY', requestId: f.ready.requestId })).body.unreadCount, 1)
  assert.equal((await api('/v2/notifications/notices/read', 'POST', { kind: 'SPLIT_FAILED' })).body.unreadCount, 0)
  const missing = await api('/v2/notifications/notices/nope/read', 'POST')
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, 'NOTICE_NOT_FOUND')
})
test('처리가 끝나면 알림이 하나 생긴다', async () => {
  const { api, split } = setup()
  split.finishMockSplit(split.mockSplitFixtures.queued.requestId, 'FAILED')
  const list = (await api('/v2/notifications/notices')).body
  assert.equal(list.unreadCount, 3)
  assert.equal(list.items[0].kind, 'SPLIT_FAILED')
  assert.equal(list.items[0].originalTitle, '결제 모듈 이관')
  assert.equal((await api('/v2/notifications/notices/read', 'POST', {})).body.unreadCount, 0)
})
