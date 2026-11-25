import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { requireFrom } from './support/errors.mjs'

// 일정은 개인 단위다. 일정 추가 화면은 폼이 무엇을 들고 있든 나의 스페이스에만 만들고 담당자를 보내지 않는다.
// 이 화면이 그 규칙을 지키는 마지막 자리다(반복 만들기 API는 위치가 없으면 고른 스페이스를 빌려 쓴다).

const plain = (value) => JSON.parse(JSON.stringify(value))

const createHarness = ({ workspace, affiliation = { spaceId: workspace.defaultSpaceId } }) => {
  const created = []
  const series = []
  const toasts = []
  const events = []
  const kinds = []
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
    '@features/spaces/useCreateAffiliation': {
      useCreateAffiliation: (kind) => {
        kinds.push(kind)
        return affiliation
      },
    },
    '@features/spaces/store': { useSpaces: () => workspace },
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
  return { created, series, toasts, events, kinds, closed, form }
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

test('a new schedule is always saved under my own space, and never names an assignee', async () => {
  const h = createHarness({ workspace: { defaultSpaceId: -7, error: null } })
  assert.deepEqual(h.kinds, [], 'nothing rendered yet')
  const form = h.form()
  assert.deepEqual(h.kinds, ['schedule'], 'the form starts from the schedule rule, not the screen behind it')
  assert.deepEqual(plain(form.props.initialValues), { spaceId: -7 })

  await form.props.onSubmit(teamValues, null)
  assert.equal(h.created.length, 1)
  assert.equal(h.created[0].spaceId, -7, 'the team space the form held is not used')
  assert.equal(h.created[0].projectId, null, 'nor a project of that space')
  assert.equal(Object.hasOwn(h.created[0], 'assigneeId'), false, 'the server default is the creator')
  assert.deepEqual(h.closed, ['/app/schedules'])

  // 나의 스페이스의 프로젝트는 그대로 보낸다. 폼이 아직 스페이스를 못 받았을 때(undefined)도 같다.
  await form.props.onSubmit({ ...teamValues, spaceId: -7, categoryId: 5 }, null)
  assert.deepEqual([h.created[1].spaceId, h.created[1].projectId], [-7, 5])
  await form.props.onSubmit({ ...teamValues, spaceId: undefined, categoryId: 5 }, null)
  assert.deepEqual([h.created[2].spaceId, h.created[2].projectId], [-7, 5])
})

test('a new recurring schedule follows the same rule', async () => {
  const h = createHarness({ workspace: { defaultSpaceId: -7, error: null } })
  await h.form().props.onSubmit(teamValues, rule)
  assert.equal(h.created.length, 0)
  assert.equal(h.series.length, 1)
  assert.equal(h.series[0].mode, 'FIXED')
  assert.deepEqual([h.series[0].spaceId, h.series[0].projectId], [-7, null])
  assert.equal(Object.hasOwn(h.series[0], 'assigneeId'), false)
})

test('while my space is unknown nothing is saved, rather than borrowing the selected space', async () => {
  // 불러오는 중의 나의 스페이스 id는 0이다.
  const loading = createHarness({ workspace: { defaultSpaceId: 0, error: null }, affiliation: {} })
  assert.equal(loading.form().props.initialValues, undefined)
  assert.equal(await loading.form().props.onSubmit(teamValues, null), false, 'the form keeps the draft')
  assert.equal(await loading.form().props.onSubmit(teamValues, rule), false)
  assert.deepEqual([loading.created.length, loading.series.length], [0, 0])
  assert.match(loading.toasts[0][0], /불러오는 중이에요\. 잠시 뒤 다시 저장해 주세요\./)
  assert.deepEqual(loading.closed, [])

  // 못 받은 것이면 기다려도 풀리지 않는다. 다시 확인하라고 알린다.
  const failed = createHarness({ workspace: { defaultSpaceId: 0, error: '스페이스를 불러오지 못했어요.' }, affiliation: {} })
  assert.equal(await failed.form().props.onSubmit(teamValues, null), false)
  assert.equal(failed.created.length, 0)
  assert.match(failed.toasts[0][0], /불러오지 못했어요\. 위의 "스페이스 다시 확인"을 누른 뒤 다시 저장해 주세요\./)
})
