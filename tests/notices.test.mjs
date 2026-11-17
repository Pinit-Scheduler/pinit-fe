import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { setup } from './support/mocks.mjs'
import { hookRunner, settle } from './support/hooks.mjs'

const load = (relativePath, dependencies = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    fileName: relativePath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
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
test('mock 알림 설정은 쪼개기 항목을 싣고, 빠진 채 저장하면 그대로 둔다', async () => {
  const { api } = setup()
  const first = (await api('/v2/notifications/preferences')).body
  assert.equal(first.taskSplitEnabled, true)
  const off = await api('/v2/notifications/preferences', 'PUT', { ...first, taskSplitEnabled: false })
  assert.equal(off.body.taskSplitEnabled, false)
  const { taskSplitEnabled: _omitted, ...old } = first
  const kept = await api('/v2/notifications/preferences', 'PUT', { ...old, scheduleStartEnabled: false })
  assert.equal(kept.body.taskSplitEnabled, false)
  assert.equal(kept.body.scheduleStartEnabled, false)
})

const paths = load('../src/features/task-split/utils/splitPaths.ts')
const view = load('../src/features/notices/utils/noticeView.ts', {
  '@features/task-split/utils/splitPaths': paths,
})
const NoticeList = load('../src/features/notices/components/NoticeList.tsx', {
  'react/jsx-runtime': jsxRuntime,
  '@shared/components/common/WorkspaceIcon': { default: () => null },
  '@features/task-split/utils/splitLabels': { agoLabel: load('../src/features/task-split/utils/splitLabels.ts', {}).agoLabel },
  '../utils/noticeView': view,
}).default
const noop = () => {}
const html = (Component, props) =>
  renderToStaticMarkup(React.createElement(Component, { onOpen: noop, onReadAll: noop, onOpenInbox: noop, onClose: noop, ...props }))

const notice = (over = {}) => ({ noticeId: 'n1', kind: 'SPLIT_READY', requestId: 31, originalTitle: '온보딩 개편 설계', createdAt: '2026-11-17T00:00:00Z', readAt: null, ...over })
test('알림 종류마다 문구와 갈 곳', () => {
  assert.equal(JSON.stringify(view.noticeViewOf(notice())), '{"title":"쪼개기 제안이 준비됐어요","icon":"split","target":"/app/tasks/splits/31"}')
  assert.equal(view.noticeViewOf(notice({ kind: 'SPLIT_FAILED' })).target, '/app/tasks/splits')
  assert.equal(view.noticeViewOf(notice({ kind: 'SPLIT_FAILED' })).title, '쪼개기를 끝내지 못했어요')
  assert.equal(view.noticeViewOf(notice({ kind: 'SPACE_INVITED' })), null)
  assert.equal(view.bellLabel(0), '알림')
  assert.equal(view.bellLabel(2), '알림, 새 알림 2개')
})
test('알림함은 알리기만 하고, 모르는 종류는 빼고, 비면 그렇다고 말한다', () => {
  const list = html(NoticeList, { items: [notice(), notice({ noticeId: 'n2', kind: 'SPACE_INVITED' }), notice({ noticeId: 'n3', kind: 'SPLIT_FAILED', originalTitle: '연말 회고 자료', readAt: '2026-11-17T00:10:00Z' })], unread: 1, now: Date.parse('2026-11-17T00:35:00Z') })
  assert.equal((list.match(/class="notice"/g) ?? []).length, 2)
  assert.match(list, /쪼개기 제안이 준비됐어요.*온보딩 개편 설계.*35분 전/s)
  assert.match(list, /data-unread/)
  assert.match(list, /모두 읽음/)
  assert.match(list, /쪼개기 보관함 열기/)
  assert.doesNotMatch(list, /취소|버리기/)
  const empty = html(NoticeList, { items: [], unread: 0, now: 0 })
  assert.match(empty, /새 알림이 없어요\./)
  assert.doesNotMatch(empty, /모두 읽음/)
})

const run = ({ readNotices }) => {
  const calls = [], set = []
  let unread = 2
  const runner = hookRunner()
  const { useReadNoticesWhileOpen } = load('../src/features/notices/hooks/useReadNoticesWhileOpen.ts', {
    react: runner.react,
    '../api/notices': { readNotices: async (filter) => { calls.push(filter); return readNotices(filter) } },
    './useNoticeUnread': { useNoticeUnread: () => ({ unread, setUnread: (count) => { set.push(count); unread = count }, refetch() {} }) },
  })
  return { calls, set, setUnread: (count) => { unread = count }, render: (filter) => runner.render(() => useReadNoticesWhileOpen(filter)) }
}
test('열면 한 번 읽음으로 바꾸고 받은 수로 종을 맞춘다', async () => {
  const h = run({ readNotices: async () => ({ unreadCount: 1 }) })
  const filter = { kind: 'SPLIT_READY', requestId: 31 }
  h.render(filter); await settle()
  h.render(filter); await settle()
  assert.equal(h.calls.length, 1)
  assert.equal(JSON.stringify(h.calls[0]), '{"kind":"SPLIT_READY","requestId":31}')
  assert.equal(JSON.stringify(h.set), '[1]')
})
test('열려 있는 동안 안 읽은 수가 늘면 한 번 더 부르고, 줄면 부르지 않는다', async () => {
  const h = run({ readNotices: async () => ({ unreadCount: 1 }) })
  const filter = { kind: 'SPLIT_FAILED' }
  h.render(filter); await settle()
  h.setUnread(2); h.render(filter); await settle()
  assert.equal(h.calls.length, 2)
  h.render(filter); await settle()
  h.setUnread(0); h.render(filter); await settle()
  assert.equal(h.calls.length, 2)
})
test('읽음 호출이 실패해도 조용하고 끝없이 돌지 않는다', async () => {
  const h = run({ readNotices: async () => { throw new Error('offline') } })
  const filter = { kind: 'SPLIT_READY', requestId: 31 }
  h.render(filter); await settle()
  h.render(filter); await settle()
  h.render(filter); await settle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.set.length, 0)
})
test('대상이 없으면 부르지 않는다', async () => {
  const h = run({ readNotices: async () => ({ unreadCount: 0 }) })
  h.render(null); await settle()
  assert.equal(h.calls.length, 0)
})
