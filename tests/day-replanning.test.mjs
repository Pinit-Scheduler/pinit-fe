import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const load = (file, dependencies = {}, globals = {}) => {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
  } })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module, exports: module.exports, console, AbortController, Error, Set, Date,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`)
      return dependencies[name]
    }, ...globals,
  })
  return module.exports
}
const utils = load('../src/features/planner/utils/replanning.ts')
const preview = () => ({
  spaceId: 10, projectId: null,
  date: '2026-11-09', zoneId: 'Asia/Seoul', delayMinutes: 30,
  plannedAt: '2026-11-09T00:00:00Z', snapshotToken: 'server-snapshot',
  windowStart: '2026-11-09T00:30:00Z', windowEnd: '2026-11-09T14:00:00Z',
  changes: [101, 102].map((scheduleId, index) => ({
    scheduleId, taskId: index + 1, title: `작업 ${index + 1}`, expectedVersion: 7,
    beforeStart: `2026-11-09T0${index + 1}:00:00Z`, beforeEnd: `2026-11-09T0${index + 1}:30:00Z`,
    afterStart: `2026-11-09T0${index + 1}:30:00Z`, afterEnd: `2026-11-09T0${index + 2}:00:00Z`,
    calibrationApplied: index === 0,
  })),
  protectedSchedules: [{ scheduleId: 103, title: '점심 약속', start: '2026-11-09T03:00:00Z', end: '2026-11-09T04:00:00Z', reason: 'INDEPENDENT_APPOINTMENT' }],
  unplaced: [{ scheduleId: 104, taskId: 4, title: '마감 작업', reason: 'DEADLINE_PASSED' }],
})
const plain = (value) => JSON.parse(JSON.stringify(value))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status }
}
const harness = ({ previewApi = async () => preview(), applyApi = async () => ({ appliedScheduleIds: [101] }), onApplied = () => {} } = {}) => {
  const state = []
  let cursor = 0
  let effectSetup = false
  let cleanup
  let subject = 'member-A'
  const events = new EventTarget()
  let selectedScope = { spaceId: 10, projectId: null }
  let resourceRevision = 0
  const evicted = []
  const emit = (name, detail) => events.dispatchEvent(new CustomEvent(name, { detail }))
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = { current: initial }
      return state[index]
    },
    useEffect(setup) {
      if (!effectSetup) { effectSetup = true; cleanup = setup() }
    },
  }
  const hook = load('../src/features/planner/hooks/useDayReplan.ts', {
    react,
    '@shared/api/httpClient': { ApiError },
    '@shared/api/authTokens': { getAccessToken: () => subject, getTokenSubject: (token) => token },
    '@features/spaces/store': { getSelectedScope: () => selectedScope },
    '@features/spaces/metadata': {
      getResourceRevision: () => resourceRevision,
      evictWorkspaceResource: (_kind, id) => {
        evicted.push(id)
        ++resourceRevision
        emit('workspace:resources-evicted', { scheduleIds: [id], taskIds: [] })
      },
    },
    '../api/replanning': { previewDayReplan: previewApi, applyDayReplan: applyApi },
    '../utils/replanning': utils,
  }, { window: events }).default
  return {
    render() { cursor = 0; return hook('2026-11-09', 'Asia/Seoul', onApplied, { spaceId: 10, projectId: null }) },
    unmount() { cleanup?.() },
    switchActor(value) { subject = value; events.dispatchEvent(new Event('auth:changed')) },
    switchScope(next) { selectedScope = next; emit('schedule:changed', { reason: 'space-scope' }) },
    revokeSpace() { emit('workspace:access-changed', { spaceIds: [10] }) },
    evictSchedule(id) { ++resourceRevision; emit('workspace:resources-evicted', { scheduleIds: [id], taskIds: [] }) },
    advanceRevision() { ++resourceRevision },
    evicted,
  }
}

test('delay input validates bounded integers before contacting the API', async () => {
  let calls = 0
  const host = harness({ previewApi: async () => { ++calls; return preview() } })
  for (const invalid of ['', '-1', '1.5', '241', 'Infinity']) {
    host.render().changeDelay(invalid)
    await host.render().loadPreview()
    assert.match(host.render().error, /0~240분/)
  }
  assert.equal(calls, 0)
  for (const valid of ['0', '30', '240']) assert.equal(utils.validateReplanDelay(valid), null)
})

test('selected apply retains existing IDs and the exact server snapshot; no edited times or foreign IDs', () => {
  const payload = plain(utils.buildReplanApplyRequest(preview(), [999, 102, 102, 101]))
  assert.deepEqual(payload, {
    spaceId: 10, projectId: null,
    date: '2026-11-09', zoneId: 'Asia/Seoul', delayMinutes: 30,
    plannedAt: '2026-11-09T00:00:00Z', snapshotToken: 'server-snapshot', selectedScheduleIds: [101, 102],
  })
})

test('changing delay cancels old preview and ignores its late response', async () => {
  const pending = deferred()
  let signal
  const host = harness({ previewApi: (_body, nextSignal) => { signal = nextSignal; return pending.promise } })
  const loading = host.render().loadPreview()
  host.render().changeDelay('60')
  assert.equal(signal.aborted, true)
  pending.resolve(preview())
  await loading
  assert.equal(host.render().preview, null)
  assert.equal(host.render().delay, '60')
  assert.equal(host.render().phase, 'idle')
})

test('unmount and account change each suppress late previews', async () => {
  for (const action of ['unmount', 'switchActor']) {
    const pending = deferred()
    const host = harness({ previewApi: () => pending.promise })
    const loading = host.render().loadPreview()
    host[action]('member-B')
    pending.resolve(preview())
    await loading
    assert.equal(host.render().preview, null)
  }
})

test('account change removes an already loaded preview and selection', async () => {
  const host = harness()
  await host.render().loadPreview()
  assert.equal(host.render().preview.snapshotToken, 'server-snapshot')
  host.switchActor('member-B')
  assert.equal(host.render().preview, null)
  assert.deepEqual(plain(host.render().selectedIds), [])
  assert.equal(host.render().requiresPreview, true)
})

test('double click sends one apply request and only selected Schedule IDs', async () => {
  const pending = deferred(), sent = [], refreshed = []
  const host = harness({ applyApi: (payload) => { sent.push(plain(payload)); return pending.promise }, onApplied: (ids) => refreshed.push(plain(ids)) })
  await host.render().loadPreview()
  host.render().toggle(102, false)
  const first = host.render().applySelection()
  await host.render().applySelection()
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].selectedScheduleIds, [101])
  pending.resolve({ appliedScheduleIds: [101] })
  await first
  assert.deepEqual(host.evicted, [101])
  assert.deepEqual(refreshed, [[101]])
  assert.equal(host.render().appliedCount, 1)
  assert.equal(host.render().preview, null)
  await host.render().applySelection()
  assert.equal(sent.length, 1)
})

test('409 selection conflict retains preview and checkbox selection for correction', async () => {
  const host = harness({ applyApi: async () => { throw new ApiError('원래 일정과 겹칩니다.', 409) } })
  await host.render().loadPreview()
  host.render().toggle(102, false)
  await host.render().applySelection()
  assert.equal(host.render().preview.snapshotToken, 'server-snapshot')
  assert.deepEqual(plain(host.render().selectedIds), [101])
  assert.match(host.render().error, /현재 상태에서는 이 동작을 할 수 없어요/)
  assert.match(host.render().error, /선택하지 않은 일정과 선행 작업/)
  assert.equal(host.render().requiresPreview, false)
})

test('unknown apply outcome cannot be retried until a fresh preview succeeds', async () => {
  let applies = 0, previewFails = false
  const host = harness({
    applyApi: async () => { ++applies; throw new ApiError('응답을 받지 못했습니다.', 0) },
    previewApi: async () => { if (previewFails) throw new Error('조회 실패'); return preview() },
  })
  await host.render().loadPreview()
  await host.render().applySelection()
  assert.match(host.render().error, /적용 결과를 확인하지 못했어요/)
  await host.render().applySelection()
  assert.equal(applies, 1)
  previewFails = true
  await host.render().loadPreview()
  await host.render().applySelection()
  assert.equal(applies, 1)
  previewFails = false
  await host.render().loadPreview()
  await host.render().applySelection()
  assert.equal(applies, 2)
})

test('follow-up refresh failure cannot label a committed apply as failed or restore an applicable preview', async () => {
  const host = harness({ onApplied: async () => { throw new Error('follow-up refresh failed') } })
  await host.render().loadPreview()
  await host.render().applySelection()
  assert.equal(host.render().appliedCount, 1)
  assert.match(host.render().error, /일정 변경은 저장됐어요/)
  assert.equal(host.render().preview, null)
  assert.equal(host.render().requiresPreview, true)
})

test('snapshot expires at 15 minutes and malformed timestamp is never actionable', () => {
  const generated = Date.parse(preview().plannedAt)
  assert.equal(utils.isReplanExpired(preview().plannedAt, generated + 899_999), false)
  assert.equal(utils.isReplanExpired(preview().plannedAt, generated + 900_000), true)
  assert.equal(utils.isReplanExpired('invalid', generated), true)
})

test('API contract uses authenticated v2 POST routes and returns server response unchanged', async () => {
  const calls = []
  const api = load('../src/features/planner/api/replanning.ts', {
    '@shared/api/config': { buildApiUrl: (path, version) => `/${version}${path}` },
    '@shared/api/httpClient': { httpClient: async (url, options) => { calls.push({ url, options }); return preview() } },
  })
  const signal = new AbortController().signal
  const body = { spaceId: 10, projectId: 7, date: '2026-11-09', zoneId: 'Asia/Seoul', delayMinutes: 30 }
  assert.equal((await api.previewDayReplan(body, signal)).snapshotToken, 'server-snapshot')
  await api.applyDayReplan(utils.buildReplanApplyRequest(preview(), [102]))
  assert.equal(calls[0].url, '/v2/plans/replan')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.signal, signal)
  assert.deepEqual(calls[0].options.json, body)
  assert.equal(calls[1].url, '/v2/plans/replan/apply')
  assert.deepEqual(plain(calls[1].options.json.selectedScheduleIds), [102])
  assert.equal(calls[1].options.json.spaceId, 10)
  assert.equal(calls[1].options.json.projectId, null)
})

test('space and project switches immediately discard loaded proposals and block old-scope apply', async () => {
  for (const next of [{ spaceId: 20, projectId: null }, { spaceId: 10, projectId: 7 }]) {
    let applies = 0
    const host = harness({ applyApi: async () => { ++applies; return { appliedScheduleIds: [101] } } })
    await host.render().loadPreview()
    host.switchScope(next)
    assert.equal(host.render().preview, null)
    assert.deepEqual(plain(host.render().selectedIds), [])
    await host.render().applySelection()
    assert.equal(applies, 0)
  }
})

test('old-space preview arriving after selection changes cannot expose its titles', async () => {
  const pending = deferred()
  const host = harness({ previewApi: () => pending.promise })
  const loading = host.render().loadPreview()
  host.switchScope({ spaceId: 20, projectId: null })
  pending.resolve(preview())
  await loading
  assert.equal(host.render().preview, null)
  assert.equal(host.render().phase, 'idle')
})

test('late committed apply after space switch evicts only known IDs without publishing old-scope success', async () => {
  const pending = deferred(), published = []
  const host = harness({ applyApi: () => pending.promise, onApplied: (ids) => published.push(ids) })
  await host.render().loadPreview()
  const applying = host.render().applySelection()
  host.switchScope({ spaceId: 20, projectId: null })
  pending.resolve({ appliedScheduleIds: [101] })
  await applying
  assert.equal(host.render().preview, null)
  assert.equal(host.render().appliedCount, null)
  assert.deepEqual(published, [])
  assert.deepEqual(host.evicted, [101])
})

test('resource eviction and membership loss erase independent preview copies immediately', async () => {
  for (const event of ['evictSchedule', 'revokeSpace']) {
    const host = harness()
    await host.render().loadPreview()
    host[event](101)
    assert.equal(host.render().preview, null)
    assert.deepEqual(plain(host.render().selectedIds), [])
    assert.equal(host.render().requiresPreview, true)
    assert.equal(host.render().accessDenied, event === 'revokeSpace')
  }
})

test('metadata revision prevents stale preview and apply responses even when no event was delivered', async () => {
  const pendingPreview = deferred()
  const host = harness({ previewApi: () => pendingPreview.promise })
  const loading = host.render().loadPreview()
  host.advanceRevision()
  pendingPreview.resolve(preview())
  await loading
  assert.equal(host.render().preview, null)
  const pendingApply = deferred(), published = []
  const host2 = harness({ applyApi: () => pendingApply.promise, onApplied: (ids) => published.push(ids) })
  await host2.render().loadPreview()
  const applying = host2.render().applySelection()
  host2.advanceRevision()
  pendingApply.resolve({ appliedScheduleIds: [101] })
  await applying
  assert.equal(host2.render().appliedCount, null)
  assert.deepEqual(published, [])
})

test('403/404/410 preview or apply denial removes sensitive proposals and prevents retry until refreshed membership', async () => {
  for (const status of [403, 404, 410]) {
    for (const stage of ['preview', 'apply']) {
      let calls = 0
      const fail = async () => { ++calls; throw new ApiError('이 공간에 접근할 수 없어요.', status) }
      const host = harness(stage === 'preview' ? { previewApi: fail } : { applyApi: fail })
      await host.render().loadPreview()
      if (stage === 'apply') await host.render().applySelection()
      assert.equal(host.render().preview, null)
      assert.deepEqual(plain(host.render().selectedIds), [])
      assert.equal(host.render().accessDenied, true)
      await host.render().loadPreview()
      await host.render().applySelection()
      assert.equal(calls, 1)
    }
  }
})

test('mismatched response scope is rejected before any preview titles are stored', async () => {
  const host = harness({ previewApi: async () => ({ ...preview(), spaceId: 20 }) })
  await host.render().loadPreview()
  assert.equal(host.render().preview, null)
  assert.match(host.render().error, /선택한 스페이스·프로젝트의 제안이 아니에요/)
})

test('rendered preview exposes before/after, protected reasons and original-slot policy in requested timezone', () => {
  const dayjs = require('dayjs')
  dayjs.extend(require('dayjs/plugin/utc'))
  dayjs.extend(require('dayjs/plugin/timezone'))
  const panel = load('../src/features/planner/components/DayReplanningPanel.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), dayjs,
    '@features/spaces/store': { useSpaces: () => ({ loading: false, error: null, memberId: 1, selectedProjectId: null,
      selectedSpace: { id: 10, name: '공유 공간', version: 1, members: [{ memberId: 1, role: 'MEMBER' }], allowedActions: { edit: false } }, selectedProject: null }) },
    '../hooks/useDayReplan': () => ({ delay: '30', preview: preview(), phase: 'idle', selectedIds: [101], appliedCount: null }),
    '../utils/replanning': utils, './DayReplanningPanel.css': {},
  }).default
  const html = renderToStaticMarkup(React.createElement(panel, { date: '2026-11-09', zoneId: 'Asia/Seoul', onApplied() {} }))
  assert.match(html, /변경 전/)
  assert.match(html, /10:00–10:30/)
  assert.match(html, /10:30–11:00/)
  assert.match(html, /약속은 유지/)
  assert.match(html, /마감 안에 끝낼 수 없어/)
  assert.match(html, /원래 시간에 남아요/)
  assert.match(html, /전체 적용이 거절될 수 있어요/)
  assert.match(html, /시간 보정 설정 반영/)
  assert.match(html, /체크한 일정만/)
  assert.match(html, /공유 공간 전체/)
  assert.match(html, /나에게 배정된 작업 일정/)
})

test('central cache invalidation removes changed IDs and preserves protected active state and other entries', () => {
  const states = []
  let cursor = 0
  const provider = load('../src/shared/contexts/ScheduleCacheContext.tsx', {
    react: {
      createContext: () => ({ Provider: 'provider' }),
      useEffect() {},
      useState(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
        return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
      },
      useRef(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = { current: initial }
        return states[index]
      },
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
    },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    '@features/spaces/metadata': { isSpaceUnavailable: () => false, isResourceUnavailable: () => false },
  }).ScheduleCacheProvider
  const render = () => { cursor = 0; return provider({ children: null }).props.value }
  render().upsertSchedule({ id: 101, state: 'NOT_STARTED' })
  render().upsertSchedule({ id: 105, state: 'IN_PROGRESS' })
  render().setActiveSchedule(105)
  const before = render().schedulesById
  render().invalidateSchedules([101])
  const after = render()
  assert.equal(after.schedulesById[101], undefined)
  assert.equal(after.schedulesById[105].state, 'IN_PROGRESS')
  assert.equal(after.activeSchedule.id, 105)
  assert.equal(before[101].state, 'NOT_STARTED')
})
