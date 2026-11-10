import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { requireFrom } from './support/errors.mjs'

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(
    new URL('../src/' + path, import.meta.url),
    'utf8',
  )
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    console: { error() {} },
    require: requireFrom(dependencies),
    ...globals,
  })
  return module.exports
}

const duration = (table = {}) => ({
  '@shared/utils/isoDuration': { parseIsoDurationMinutes: (value) => table[value] ?? 0 },
})
const counts = (completed, running, open, unassigned) => ({
  total: completed + running + open + unassigned,
  completed,
  running,
  open,
  unassigned,
})

test('dots follow the server counts in a fixed order and become a bar past twenty', () => {
  const { taskDots, countsLabel } = load('features/spaces/hub.ts', duration())
  assert.deepEqual(plain(taskDots(counts(1, 1, 1, 1))), {
    kind: 'dots',
    dots: ['done', 'running', 'todo', 'unassigned'],
  })
  assert.deepEqual(plain(taskDots(counts(15, 0, 5, 1))), {
    kind: 'bar',
    segments: [
      { state: 'done', count: 15 },
      { state: 'todo', count: 5 },
      { state: 'unassigned', count: 1 },
    ],
  })
  assert.equal(countsLabel(counts(1, 1, 1, 1)), '작업 4개 중 1개 완료, 진행 중 1개, 담당자 미정 1개')
  assert.equal(countsLabel(counts(0, 0, 0, 0)), '작업 없음')
})

test('the rail says who uses the space and how many tasks are open', () => {
  const { railLine } = load('features/spaces/hub.ts', duration())
  const row = (memberCount, openTaskCount, unassignedOpenCount) => ({
    spaceId: 31,
    memberCount,
    openTaskCount,
    unassignedOpenCount,
  })
  assert.deepEqual(plain(railLine({ personal: true }, row(1, 4, 0))), { who: '본인 전용', open: '4' })
  assert.deepEqual(plain(railLine({ personal: false }, row(3, 7, 2))), { who: '3명 · 담당자 미정 2', open: '7' })
  assert.deepEqual(plain(railLine({ personal: false }, row(1, 0, 0))), { who: '혼자', open: '0' })
  assert.deepEqual(plain(railLine({ personal: false }, undefined)), { who: '', open: '–' })
  assert.deepEqual(plain(railLine({ personal: true }, undefined)), { who: '본인 전용', open: '–' })
})

test('rows missing from the summary show no number instead of zero', () => {
  const { projectRows, memberRows } = load('features/spaces/hub.ts', duration())
  const projects = [
    { id: 88, spaceId: 31, name: '작업 카드 개선', deleted: false },
    { id: 90, spaceId: 31, name: '지난 프로젝트', deleted: true },
    { id: 92, spaceId: 31, name: '방금 만든 프로젝트', deleted: false },
    { id: 91, spaceId: 44, name: '11월 대회 준비', deleted: false },
  ]
  const summary = {
    projects: [{ projectId: 88, counts: counts(1, 0, 2, 1), nearestDueDate: '2026-11-10' }],
    members: [{ memberId: 7, openAssignedCount: 2, nearestDueDate: null }],
  }
  assert.deepEqual(
    plain(projectRows(projects, 31, summary).map((row) => [row.project.id, row.counts?.total ?? null])),
    [[88, 4], [92, null]],
  )
  assert.deepEqual(plain(projectRows(projects, 31, null).map((row) => row.counts)), [null, null])
  const members = [
    { memberId: 7, nickname: '민수', role: 'ADMIN' },
    { memberId: 3, nickname: '준호', role: 'MEMBER' },
  ]
  assert.deepEqual(
    plain(memberRows(members, 7, summary).map((row) => [row.name, row.admin, row.me, row.openAssignedCount])),
    [['나', true, true, 2], ['준호', false, false, null]],
  )
})

test('record rows keep the server order and name former members', () => {
  const { recordRows, weekRange, dueLabel } = load(
    'features/spaces/hub.ts',
    duration({ PT1H30M: 90, PT1H: 60, PT30M: 30 }),
  )
  const names = new Map([[7, '나'], [3, '준호']])
  assert.deepEqual(
    plain(
      recordRows(
        [
          { id: 3, elapsed: 'PT1H30M' },
          { id: 12, elapsed: 'PT1H' },
          { id: 13, elapsed: 'PT1H' },
          { id: 7, elapsed: 'PT30M' },
        ],
        names,
        '이전 참여자',
        '',
      ).map((row) => [row.name, row.minutes]),
    ),
    [['준호', 90], ['이전 참여자', 60], ['이전 참여자', 60], ['나', 30]],
  )
  assert.deepEqual(
    plain(recordRows([{ id: null, elapsed: 'PT30M' }], new Map(), '삭제된 프로젝트', '프로젝트 없음').map((row) => row.name)),
    ['프로젝트 없음'],
  )
  assert.equal(weekRange({ start: '2026-11-09', end: '2026-11-16' }), '11/9–11/15')
  assert.equal(weekRange({ start: '2026-12-28', end: '2027-01-04' }), '12/28–1/3')
  assert.equal(dueLabel('2026-11-10'), '11/10 마감')
  assert.equal(dueLabel(null), '')
})

test('summary calls use the contract paths', async () => {
  const calls = []
  const { fetchSpaceSummaries, fetchSpaceSummary, fetchWeeklyRecord } = load('features/spaces/api.ts', {
    '@shared/api/config': { buildApiUrl: (path) => 'https://api' + path },
    '@shared/api/httpClient': {
      httpClient: async (url) => {
        calls.push(url)
        return {}
      },
    },
  })
  await fetchSpaceSummaries()
  await fetchSpaceSummary(31)
  await fetchWeeklyRecord(-7, '2026-11-09')
  assert.deepEqual(calls, [
    'https://api/spaces/summaries',
    'https://api/spaces/31/summary',
    'https://api/spaces/-7/weekly-record?start=2026-11-09',
  ])
})

test('spaces is a main destination right after today', () => {
  const source = readFileSync(
    new URL('../src/shared/components/layout/WorkspaceSidebar.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /\['today', '오늘', 'sun'\],\s*\['spaces', '스페이스', 'spaces'\]/)
  assert.equal(source.includes('스페이스·프로젝트'), false)
})

test('hub data is keyed by space so a stale space never shows', () => {
  const source = readFileSync(
    new URL('../src/features/spaces/hub/useHubData.ts', import.meta.url),
    'utf8',
  )
  // Cached per space (useRevalidatingQuery): the key names the space, so another space's
  // numbers never render, and a space seen before shows its last numbers at once.
  assert.match(source, /summary:\$\{spaceId\}`/)
  assert.match(source, /record:\$\{spaceId\}:\$\{weekStart\}`/)
  assert.match(source, /fetchWeeklyRecord\(spaceId as number, weekStart, signal\)/)
  assert.match(source, /useRevalidatingQuery/)
})

test('the hub never counts tasks itself', () => {
  for (const file of ['SpacesPage.tsx', 'hub/HubProjects.tsx', 'hub/HubPeople.tsx', 'hub/HubRail.tsx', 'hub/TeamRecord.tsx']) {
    const source = readFileSync(new URL('../src/features/spaces/' + file, import.meta.url), 'utf8')
    assert.equal(/fetchWorkspaceTasks|workspace\/tasks|\.reduce\(/.test(source), false, file)
  }
})

test('day bars keep seven server days and mark today', () => {
  const { dayBars } = load('features/spaces/hub.ts', duration({ PT1H30M: 90, PT45M: 45 }))
  const days = ['09', '10', '11', '12', '13', '14', '15'].map((day) => ({
    date: '2026-11-' + day,
    elapsed: day === '09' ? 'PT1H30M' : day === '10' ? 'PT45M' : 'PT0S',
  }))
  assert.deepEqual(
    plain(dayBars(days, '2026-11-10').map((bar) => [bar.label, bar.height, bar.today])),
    [['월', 48, false], ['화', 24, true], ['수', 2, false], ['목', 2, false], ['금', 2, false], ['토', 2, false], ['일', 2, false]],
  )
  assert.equal(dayBars(days.map((day) => ({ ...day, elapsed: 'PT0S' })), '2026-11-10')[0].height, 2)
})
