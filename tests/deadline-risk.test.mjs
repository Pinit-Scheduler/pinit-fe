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
const Item = load('../src/features/deadline-risk/components/DeadlineRiskItem.tsx', {
  'react/jsx-runtime': jsxRuntime,
  'react-router-dom': { Link, useLocation: () => ({ pathname: '/app/deadline-risk' }) },
  '@shared/utils/isoDuration': duration,
  '../utils/deadlineRiskView': view,
}).default

test('page announces personal-space-only tasks and schedules before forecast loading completes', () => {
  const Page = load('../src/features/deadline-risk/pages/DeadlineRiskPage.tsx', {
    react: { useState: React.useState },
    'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { Link },
    '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ zoneId: 'Asia/Seoul' }) },
    '../components/DeadlineRiskItem': { default: Item },
    '../hooks/useDeadlineRisk': { default: () => ({ forecast: null, error: null, isLoading: true, refresh() {} }) },
    '../utils/deadlineRiskView': view,
    './DeadlineRiskPage.css': {},
  }).default
  const html = renderToStaticMarkup(React.createElement(Page))
  assert.match(html, /개인 공간의 작업과 일정만 반영해요/)
  assert.match(html, /팀이나 다른 공간의 작업·일정은 포함하지 않아요/)
  assert.match(html, /계산하고 있어요/)
})

test('5 required hours versus 2 available hours shows 3 hours shortage and predecessor actions', () => {
  const html = renderToStaticMarkup(React.createElement(Item, { item: baseItem, zoneId: 'Asia/Seoul' }))
  for (const text of ['시간 부족', '5시간', '2시간', '3시간', '사용 가능 시간(상한)', '미완료 선행 작업 1개']) assert.ok(html.includes(text), text)
  for (const path of ['/app/tasks/41', '/app/tasks/10', '/app/plan']) assert.ok(html.includes(`href="${path}"`), path)
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
      onTaskChanged: (handler) => { changed.task = handler; return () => { delete changed.task } },
      onScheduleChanged: (handler) => { changed.schedule = handler; return () => { delete changed.schedule } },
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
  h.changed.task()
  h.render()
  h.changed.schedule()
  h.render()
  h.window.dispatchEvent(new Event('focus'))
  h.render()
  assert.equal(h.requests.length, 5)
  h.unmount()
  assert.ok(h.requests.every((request) => request.signal.aborted))
  assert.equal(h.changed.task, undefined)
  assert.equal(h.changed.schedule, undefined)
})
