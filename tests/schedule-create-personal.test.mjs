import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { requireFrom } from './support/errors.mjs'

// 일정은 개인 것이고 어느 스페이스에도 속하지 않는다. 일정 추가 화면은 폼이 무엇을 들고 있든
// 스페이스·프로젝트·담당자를 보내지 않는다. 서버는 위치 없는 일정을 만든 사람의 것으로 둔다.

const plain = (value) => JSON.parse(JSON.stringify(value))

const createHarness = () => {
  const created = []
  const series = []
  const toasts = []
  const events = []
  const closed = []
  const ScheduleForm = () => null
  const dependencies = {
    'react/jsx-runtime': {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    react: { useMemo: (factory) => factory() },
    'react-router-dom': { useLocation: () => ({ state: null, search: '' }) },
    '@shared/routing/RouteSurface': {
      useRouteSurfaceNavigation: () => ({ complete: (path) => closed.push(path) }),
    },
    '../../components/ScheduleForm': { default: ScheduleForm },
    '@shared/utils/datetime': {
      getDisplayZoneId: () => 'Asia/Seoul',
      getTodayWithOffset: () => ({ hour: () => 9 }),
      toApiDateTimeWithZone: (date) => ({ dateTime: date, zoneId: 'Asia/Seoul' }),
      toDisplayDayjs: () => ({ format: () => '09:00', isValid: () => true }),
    },
    '../../api/schedules': {
      createSchedule: async (payload) => {
        created.push(payload)
        return { id: 9 }
      },
    },
    '@contexts/ToastContext': { useToast: () => ({ addToast: (...args) => toasts.push(args) }) },
    '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ offsetMinutes: 540 }) },
    '@shared/utils/events': { dispatchScheduleChanged: (detail) => events.push(detail) },
    '@shared/utils/isoDuration': {
      minutesToIsoDuration: (minutes) => `PT${minutes}M`,
      parseDurationInput: (text) => (text ? { kind: 'value', minutes: Number(text) } : { kind: 'empty' }),
    },
    './ScheduleFormPage.css': {},
    '@features/recurrence/api/recurrences': {
      createRecurrence: async (payload) => {
        series.push(payload)
        return { id: 4 }
      },
    },
    '@features/recurrence/utils/recurrenceRules': {
      mapRecurrenceServerErrors: () => ({}),
      toRule: (rule) => rule,
    },
    '@shared/api/httpClient': { ApiError: class ApiError extends Error {} },
    '@shared/api/errorMessage': { getRequestFailureMessage: (error, fallback) => fallback },
    '@shared/utils/dateKey': { parseDateKey: () => null },
  }
  const source = readFileSync(
    new URL('../src/features/schedules/pages/form/ScheduleCreatePage.tsx', import.meta.url),
    'utf8',
  )
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    URLSearchParams,
    console: { error() {} },
    // 스페이스 저장소(@features/spaces/store)나 기본 소속 훅을 다시 불러오면 여기서 실패한다:
    // 일정 추가 화면은 스페이스를 알 필요가 없다.
    require: requireFrom(dependencies),
  })
  const findForm = (node) => {
    if (!node || typeof node !== 'object') return null
    if (node.type === ScheduleForm) return node
    const children = [node.props?.children].flat(Infinity)
    for (const child of children) {
      const found = findForm(child)
      if (found) return found
    }
    return null
  }
  const form = () => findForm(module.exports.default())
  return { created, series, toasts, events, closed, form }
}

// 폼이 들고 있을 수 있는 가장 나쁜 값: 팀 스페이스, 그 프로젝트, 다른 사람.
const teamValues = {
  title: '산책',
  description: '한강',
  date: '2026-11-26T09:00:00',
  scheduleType: 'QUICK_TASK',
  plannedDurationMinutes: '',
  spaceId: 31,
  categoryId: 88,
  assigneeId: 9,
}
const rule = { frequency: 'DAILY', startDate: '2026-11-26' }

test('a new schedule names no space, project or assignee, whatever the form holds', async () => {
  const h = createHarness()
  const form = h.form()
  assert.equal(form.props.initialValues, undefined, 'the form starts from nothing but an optional date')

  await form.props.onSubmit(teamValues, null)
  assert.equal(h.created.length, 1)
  for (const key of ['spaceId', 'projectId', 'assigneeId'])
    assert.equal(Object.hasOwn(h.created[0], key), false, `${key} is not sent: a schedule belongs to no space`)
  assert.deepEqual(plain(h.created[0]), {
    title: '산책',
    description: '한강',
    date: { dateTime: '2026-11-26T09:00:00', zoneId: 'Asia/Seoul' },
    scheduleType: 'QUICK_TASK',
  })
  assert.deepEqual(h.closed, ['/app/schedules'])
  assert.deepEqual(h.toasts, [])
})

test('a new recurring schedule follows the same rule', async () => {
  const h = createHarness()
  await h.form().props.onSubmit(teamValues, rule)
  assert.equal(h.created.length, 0)
  assert.equal(h.series.length, 1)
  assert.equal(h.series[0].mode, 'FIXED')
  for (const key of ['spaceId', 'projectId', 'assigneeId'])
    assert.equal(Object.hasOwn(h.series[0], key), false, `${key} is not sent`)
  assert.deepEqual(h.closed, ['/app/schedules'])
})
