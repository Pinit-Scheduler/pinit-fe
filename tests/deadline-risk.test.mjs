import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

const load = (path, dependencies = {}, globals = {}) => {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Intl, Date, AbortController,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    ...globals,
  })
  return module.exports
}

const view = load('../src/features/deadline-risk/utils/deadlineRiskView.ts')
const duration = load('../src/shared/utils/isoDuration.ts')
const baseItem = {
  taskId: 41, title: '금요일 제출', deadline: '2026-11-13T15:00:00Z', status: 'SHORTAGE',
  requiredMinutes: 300, availableMinutes: 120, shortageMinutes: 180,
  predecessorTaskIds: [10], reasons: ['생활 시간과 기존 일정으로 시간이 부족해요.'],
  suggestedFinish: null, recurrenceSeriesId: null,
}
const Link = ({ to, children }) => React.createElement('a', { href: to }, children)
const personalSpaces = {
  defaultSpaceId: -7,
  selectedSpaceId: 42,
  selectedProjectId: 99,
  spaces: [{ id: -7, personal: true }, { id: 42, personal: false }],
  selectSpace() {},
}
const Item = load('../src/features/deadline-risk/components/DeadlineRiskItem.tsx', {
  'react/jsx-runtime': jsxRuntime,
  'react-router-dom': { Link, useLocation: () => ({ pathname: '/app/deadline-risk' }) },
  '@shared/utils/isoDuration': duration,
  '../utils/deadlineRiskView': view,
}).default

test('page announces personal-space-only tasks and schedules before forecast loading completes', () => {
  const Page = load('../src/features/deadline-risk/pages/DeadlineRiskPage.tsx', {
    react: { useState: React.useState, useRef: React.useRef, useEffect: React.useEffect },
    'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { useNavigate: () => () => {} },
    '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ zoneId: 'Asia/Seoul' }) },
    '@features/spaces/store': { useSpaces: () => personalSpaces },
    '../components/DeadlineRiskItem': { default: Item },
    '../hooks/useDeadlineRisk': { default: () => ({ forecast: null, error: null, isLoading: true, refresh() {} }) },
    '../utils/deadlineRiskView': view,
    './DeadlineRiskPage.css': {},
  }).default
  const html = renderToStaticMarkup(React.createElement(Page))
  assert.match(html, /개인 스페이스의 작업과 일정만 반영해요/)
  assert.match(html, /팀이나 다른 스페이스의 작업·일정은 포함하지 않아요/)
  assert.match(html, /계산하고 있어요/)
})

test('personal plan and empty-task actions switch team/project view only on click before navigating', () => {
  const actions = []
  const spaces = { ...personalSpaces, selectSpace(id, projectId = null) { actions.push(['select', id, projectId]) } }
  const Page = load('../src/features/deadline-risk/pages/DeadlineRiskPage.tsx', {
    react: { useState: (initial) => [initial, () => {}] },
    'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { useNavigate: () => (path) => actions.push(['navigate', path]) },
    '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ zoneId: 'Asia/Seoul' }) },
    '@features/spaces/store': { useSpaces: () => spaces },
    '../components/DeadlineRiskItem': { default: Item },
    '../hooks/useDeadlineRisk': { default: () => ({
      forecast: { ...baseItem, generatedAt: '2026-11-09T00:00:00Z', horizonEnd: '2026-11-15T15:00:00Z', zoneId: 'Asia/Seoul', items: [], assumptions: [], limitations: [] },
      error: null, isLoading: false, refresh() {},
    }) },
    '../utils/deadlineRiskView': view,
    './DeadlineRiskPage.css': {},
  }).default
  const buttons = []
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    if (node.type === 'button') buttons.push(node)
    walk(node.props?.children)
  }
  walk(Page())
  assert.equal(actions.length, 0, 'reading a personal forecast does not silently change team selection')
  buttons.find((button) => button.props.children === '개인 스페이스에서 하루 계획 열기').props.onClick()
  assert.deepEqual(actions, [['select', -7, null], ['navigate', '/app/plan']])
  actions.length = 0
  buttons.find((button) => button.props.children === '개인 스페이스의 작업과 마감 확인하기').props.onClick()
  assert.deepEqual(actions, [['select', -7, null], ['navigate', '/app/tasks']])
})

test('missing personal space during snapshot loading or failure disables every personal action without team fallback', () => {
  for (const error of [null, 'snapshot unavailable']) {
    for (const items of [[], [baseItem]]) {
      const actions = [], buttons = [], cards = []
      const Page = load('../src/features/deadline-risk/pages/DeadlineRiskPage.tsx', {
        react: { useState: (initial) => [initial, () => {}] },
        'react/jsx-runtime': jsxRuntime,
        'react-router-dom': { useNavigate: () => (path) => actions.push(['navigate', path]) },
        '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ zoneId: 'Asia/Seoul' }) },
        '@features/spaces/store': { useSpaces: () => ({ ...personalSpaces, spaces: [], loading: error === null, error, selectSpace: (id) => actions.push(['select', id]), reload: async () => {} }) },
        '../components/DeadlineRiskItem': { default: Item },
        '../hooks/useDeadlineRisk': { default: () => ({
          forecast: { generatedAt: '2026-11-09T00:00:00Z', horizonEnd: '2026-11-15T15:00:00Z', zoneId: 'Asia/Seoul', items, assumptions: [], limitations: [] },
          error: null, isLoading: false, refresh() {},
        }) },
        '../utils/deadlineRiskView': view,
        './DeadlineRiskPage.css': {},
      }).default
      const walk = (node) => {
        if (Array.isArray(node)) return node.forEach(walk)
        if (!node || typeof node !== 'object') return
        if (node.type === 'button' && typeof node.props.children === 'string' && node.props.children.startsWith('개인 스페이스')) buttons.push(node)
        if (node.type === Item) cards.push(node)
        walk(node.props?.children)
      }
      walk(Page())
      assert.equal(buttons.length, items.length ? 1 : 2)
      for (const button of buttons) {
        assert.equal(button.props.disabled, true)
        button.props.onClick()
      }
      for (const card of cards) {
        assert.equal(card.props.canOpenPlan, false)
        card.props.onOpenPlan()
        const html = renderToStaticMarkup(card)
        assert.match(html, /<button[^>]*disabled=""[^>]*>개인 스페이스에서 배치 검토/)
      }
      assert.equal(actions.length, 0, 'even an invoked stale callback must never fall back to selected team space')
    }
  }
})

test('workspace context labels personal forecast instead of the selected team purpose/project', () => {
  const { SpaceContextBar, SpaceSwitcher } = load('../src/features/spaces/SpaceChrome.tsx', {
    react: { useState: React.useState, useRef: React.useRef, useEffect: React.useEffect },
    'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { Link, useNavigate: () => () => {}, useLocation: () => ({ pathname: '/app/deadline-risk' }) },
    '@shared/components/common/Modal': { default: () => null },
    '@shared/components/common/WorkspaceIcon': { default: () => null },
    './store': { useSpaces: () => ({ ...personalSpaces, selectedSpace: { name: '선택한 팀', purpose: '팀 목적' }, selectedProject: { name: '팀 프로젝트', outcome: '팀 성과' } }) },
    'react-dom': { createPortal: (node) => node },
    './SpaceMark': { default: () => null },
    '@shared/hooks/useMediaQuery': { default: () => false },
    './scope': load('../src/features/spaces/scope.ts'),
    './spaces.css': {},
  })
  const html = renderToStaticMarkup(React.createElement(SpaceContextBar))
  assert.ok(html.includes('개인 스페이스 · 마감 위험 예보'))
  const switcher = renderToStaticMarkup(React.createElement(SpaceSwitcher, { variant: 'bar' }))
  assert.ok(switcher.includes('선택한 팀'), 'space switcher stays available without silently changing selection')
  assert.ok(!html.includes('팀 목적'))
  assert.ok(!html.includes('팀 프로젝트'))
})

test('5 required hours versus 2 available hours shows 3 hours shortage and predecessor actions', () => {
  const html = renderToStaticMarkup(React.createElement(Item, { item: baseItem, zoneId: 'Asia/Seoul' }))
  for (const text of ['시간 부족', '5시간', '2시간', '3시간', '사용 가능 시간(상한)', '미완료 선행 작업 1개']) assert.ok(html.includes(text), text)
  for (const path of ['/app/tasks/41', '/app/tasks/10']) assert.ok(html.includes(`href="${path}"`), path)
  assert.ok(html.includes('개인 스페이스에서 배치 검토'))
  assert.ok(!html.includes('href="/app/plan"'), 'plan uses explicit local personal-scope selection, not a team-scoped link')
  assert.match(html, /2026.*11.*14.*00:00/)
  assert.ok(!html.includes('확률'))
})

test('sufficient upper-bound hours with no fitting contiguous slot stays AT_RISK with zero shortage', () => {
  const html = renderToStaticMarkup(React.createElement(Item, {
    item: { ...baseItem, status: 'AT_RISK', requiredMinutes: 120, availableMinutes: 180, shortageMinutes: 0 }, zoneId: 'Asia/Seoul',
  }))
  assert.ok(html.includes('배치 확인 필요'))
  assert.ok(html.includes('다른 배치가 가능할 수 있어요'))
  assert.ok(html.includes('0분'))
  assert.ok(!html.includes('배치하지 못한 시간'))
  assert.ok(!html.includes('가정 안에서 배치 가능'))
})

test('UNKNOWN hides numeric capacity, OVERDUE calls for review, FEASIBLE describes conditional placement', () => {
  const unknown = renderToStaticMarkup(React.createElement(Item, { item: { ...baseItem, status: 'UNKNOWN' }, zoneId: 'Asia/Seoul' }))
  assert.ok(unknown.includes('계산 확인 필요'))
  assert.ok(!unknown.includes('<dl'))
  assert.ok(!unknown.includes('5시간'))
  assert.match(view.riskExplanation('OVERDUE'), /이미 마감이 지난/)
  assert.match(view.riskExplanation('FEASIBLE'), /보장하지는 않아요/)
  assert.match(view.riskStatusLabel('NEW_SERVER_STATUS'), /확인 필요/)
})

test('forecast labels use server timezone across midnight and invalid instants remain explicit', () => {
  const instant = '2026-11-09T15:00:00Z'
  assert.match(view.forecastTimeLabel(instant, 'Asia/Seoul'), /2026.*11.*10.*00:00/)
  assert.match(view.forecastTimeLabel(instant, 'UTC'), /2026.*11.*9.*15:00/)
  assert.equal(view.forecastTimeLabel('bad', 'Asia/Seoul'), '시각 확인 필요')
  assert.equal(view.forecastTimeLabel(instant, 'bad/zone'), '시각 확인 필요')
})

test('summary counts statuses without summing overlapping predecessor-chain minutes', () => {
  const counts = view.forecastCounts(['SHORTAGE', 'AT_RISK', 'UNKNOWN', 'FEASIBLE', 'OVERDUE'].map((status) => ({ ...baseItem, status })))
  assert.equal(counts.shortage, 1)
  assert.equal(counts.review, 2)
  assert.equal(counts.overdue, 1)
  assert.deepEqual(Object.keys(counts).sort(), ['overdue', 'review', 'shortage'])
})

test('forecast API uses bounded days and authenticated shared client with no-store plus abort signal', async () => {
  const requests = []
  const api = load('../src/features/deadline-risk/api/deadlineRisk.ts', {
    '@shared/api/config': { buildApiUrl: (path, version) => `https://api.test/${version}${path}` },
    '@shared/api/httpClient': { httpClient: async (url, options) => { requests.push({ url, options }); return { items: [] } } },
  })
  const controller = new AbortController()
  await api.fetchDeadlineRisk(14, controller.signal)
  assert.equal(requests[0].url, 'https://api.test/v2/plans/deadline-risk?days=14')
  assert.equal(requests[0].options.cache, 'no-store')
  assert.equal(requests[0].options.signal, controller.signal)
  assert.equal(requests[0].options.method, undefined, 'default GET, no write')
})

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const hookHarness = () => {
  const states = [], effects = [], pendingEffects = [], requests = [], changed = {}
  let index = 0
  const window = new EventTarget()
  const hook = load('../src/features/deadline-risk/hooks/useDeadlineRisk.ts', {
    react: {
      useState(initial) {
        const slot = index++
        if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial
        return [states[slot], (next) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next }]
      },
      useEffect(effect, deps) {
        const slot = index++
        if (!effects[slot] || deps.some((dep, at) => dep !== effects[slot].deps[at])) {
          pendingEffects.push(() => {
            effects[slot]?.cleanup?.()
            effects[slot] = { deps, cleanup: effect() }
          })
        }
      },
    },
    '@shared/utils/events': {
      onDataChanged: (handler) => { changed.data = handler; return () => { delete changed.data } },
    },
    '../api/deadlineRisk': { fetchDeadlineRisk: (days, signal) => {
      const request = { days, signal, ...deferred() }; requests.push(request); return request.promise
    } },
  }, { window }).default
  return {
    requests, changed, window,
    render(days = 7, zone = 'Asia/Seoul') {
      index = 0
      const result = hook(days, zone)
      while (pendingEffects.length) pendingEffects.shift()()
      return result
    },
    unmount() { effects.forEach((effect) => effect?.cleanup?.()) },
  }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve() }

test('range changes immediately hide old results and late responses cannot replace newer forecast', async () => {
  const h = hookHarness()
  assert.equal(h.render().isLoading, true)
  const first = h.requests[0]
  assert.equal(h.render(14).forecast, null)
  assert.equal(first.signal.aborted, true)
  h.requests[1].resolve({ days: 14, items: [] })
  await settle()
  assert.equal(h.render(14).forecast.days, 14)
  first.resolve({ days: 7, items: [baseItem] })
  await settle()
  assert.equal(h.render(14).forecast.days, 14)
  assert.equal(h.render(14, 'UTC').forecast, null, 'zone change hides old capacity immediately')
  h.unmount()
})

test('refresh failures discard old forecast; task/schedule/focus invalidation reloads and unmount aborts', async () => {
  const h = hookHarness()
  h.render()
  h.requests[0].resolve({ days: 7, items: [baseItem] })
  await settle()
  h.render().refresh()
  assert.equal(h.render().forecast, null)
  h.requests[1].reject(new Error('offline'))
  await settle()
  assert.match(h.render().error, /연결을 확인/)
  assert.equal(h.render().forecast, null)
  h.changed.data({ tasks: [{ reason: 'update' }], schedules: [] })
  h.render()
  h.changed.data({ tasks: [], schedules: [{ reason: 'created' }] })
  h.render()
  h.window.dispatchEvent(new Event('focus'))
  h.render()
  assert.equal(h.requests.length, 5)
  h.unmount()
  assert.ok(h.requests.every((request) => request.signal.aborted))
  assert.equal(h.changed.data, undefined)
})
