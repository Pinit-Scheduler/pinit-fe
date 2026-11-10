import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { findElement, hookRuntime, loadApp } from './support/app.mjs'

// Audit C5: a new display zone resets zone-scoped state in place instead of remounting the
// router tree. Only an account change re-keys the providers.

const source = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

function load(path, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(source(path), {
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
    Error,
    require: (name) => {
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
    ...globals,
  })
  return module.exports
}

/**
 * A hook runtime that behaves like React for render-phase updates: a setState called while the
 * component renders makes it render again before anything below it sees the value.
 */
function component(path, name, dependencies = {}) {
  const state = []
  let cursor = 0
  let rendering = false
  let dirty = false
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useState: (initial) => {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [
        state[index],
        (next) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next
          if (rendering) dirty = true
        },
      ]
    },
    useEffect() {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (initial) => react.useState(() => ({ current: initial }))[0],
  }
  const api = load(path, {
    react,
    'react/jsx-runtime': { jsx: (_type, props) => props },
    '@features/spaces/metadata': { isSpaceUnavailable: () => false, isResourceUnavailable: () => false },
    ...dependencies,
  }, { window: new EventTarget() })
  return (props = {}) => {
    let value
    let passes = 0
    do {
      dirty = false
      cursor = 0
      rendering = true
      value = api[name]({ children: null, ...props }).value
      rendering = false
      assert.ok(++passes < 10, 'render loop')
    } while (dirty)
    return value
  }
}

test('the task cache empties in place, in the same render, when its reset key changes', () => {
  const render = component('shared/contexts/TaskCacheContext.tsx', 'TaskCacheProvider')
  render({ resetKey: 'Asia/Seoul@540' }).setTask({ id: 1, version: 2 })
  assert.equal(render({ resetKey: 'Asia/Seoul@540' }).tasksById[1].id, 1)
  assert.deepEqual(
    Object.keys(render({ resetKey: 'America/New_York@-300' }).tasksById),
    [],
    'the first render with the new zone already reads an empty cache',
  )
  render({ resetKey: 'America/New_York@-300' }).setTask({ id: 2, version: 1 })
  assert.equal(render({ resetKey: 'America/New_York@-300' }).tasksById[2].id, 2, 'a same-zone render keeps new entries')
})

test('the schedule cache empties in place but keeps the running schedule', () => {
  const render = component('shared/contexts/ScheduleCacheContext.tsx', 'ScheduleCacheProvider')
  const cache = render({ resetKey: 'a' })
  cache.setSchedule({ id: 3, version: 1, state: 'IN_PROGRESS' })
  cache.setSchedule({ id: 4, version: 1, state: 'NOT_STARTED' })
  render({ resetKey: 'a' }).setActiveSchedule(3)
  const next = render({ resetKey: 'b' })
  assert.deepEqual(Object.keys(next.schedulesById), ['3'])
  assert.equal(next.activeScheduleId, 3)
  assert.equal(next.activeSchedule.id, 3, 'the mini player keeps its schedule')
  render({ resetKey: 'b' }).setActiveSchedule(null)
  assert.deepEqual(Object.keys(render({ resetKey: 'c' }).schedulesById), [], 'nothing running: the cache empties')
})

test('the schedule view goes back to today in the new zone, in the same render', () => {
  let time = { zoneId: 'Asia/Seoul', offsetMinutes: 540 }
  const day = (key, offset) => ({
    key,
    offset,
    utcOffset: () => ({ format: (format) => (format === 'YYYY-MM-DD' ? key : `label ${key}`) }),
  })
  const render = component('shared/contexts/ScheduleViewStateContext.tsx', 'ScheduleViewStateProvider', {
    '@shared/utils/datetime': {
      getTodayWithOffset: (offset) => day(offset === 540 ? '2026-11-11' : '2026-11-10', offset),
      getWeekStart: (date) => ({ week: date.key }),
    },
    '@contexts/TimePreferencesContext': { useTimePreferences: () => time },
  })
  const first = render()
  assert.equal(first.selectedDateKey, '2026-11-11')
  first.selectDate(day('2026-11-20', 540))
  assert.equal(render().selectedDateKey, '2026-11-20', 'a picked date stays while the zone stays')
  time = { zoneId: 'America/New_York', offsetMinutes: -300 }
  const moved = render()
  assert.equal(moved.selectedDateKey, '2026-11-10')
  assert.equal(moved.selectedDate.offset, -300)
  assert.deepEqual(moved.currentWeekStart, { week: '2026-11-10' })
  time = { zoneId: 'Asia/Tokyo', offsetMinutes: 540 }
  assert.equal(render().selectedDateKey, '2026-11-11', 'a new zone with another id resets too')
})

test('the time preferences key changes with the zone or its offset', () => {
  const offsets = { 'Asia/Seoul': 540, 'Asia/Tokyo': 540, 'America/New_York': -300 }
  let zone = 'Asia/Seoul'
  const runtime = hookRuntime()
  const { TimePreferencesProvider } = load('shared/contexts/TimePreferencesContext.tsx', {
    react: runtime.react,
    'react/jsx-runtime': { jsx: (_type, props) => props },
    '@shared/utils/datetime': {
      formatOffsetLabel: (minutes) => String(minutes),
      getDisplayOffsetMinutes: () => offsets[zone],
      getDisplayZoneId: () => zone,
      setDisplayZone: (next) => (zone = next),
    },
    '@shared/utils/safeStorage': { readText: () => null, writeText() {}, STORAGE_KEYS: { displayZoneId: 'zone' } },
  })
  const render = () => runtime.render(TimePreferencesProvider, { children: null }).value
  assert.equal(render().zoneKey, 'Asia/Seoul@540')
  render().applyZone('Asia/Tokyo')
  assert.equal(render().zoneKey, 'Asia/Tokyo@540', 'another zone with the same offset is still another key')
  render().applyZone('America/New_York')
  assert.equal(render().zoneKey, 'America/New_York@-300')
})

const appHarness = () => {
  const runtime = hookRuntime()
  const h = { zoneKey: 'Asia/Seoul@540', clears: 0, location: null, runtime }
  const app = loadApp(runtime, {
    '@contexts/TimePreferencesContext': { useTimePreferences: () => ({ zoneKey: h.zoneKey, isLoading: false }) },
    '@shared/api/authTokens': { getAccessToken: () => 'token', getTokenSubject: () => 'member-7' },
    '@shared/utils/queryStore': { queryStore: { clear: () => h.clears++ } },
    'react-router-dom': { useLocation: () => h.location },
  })
  return { ...app, h }
}
const byName = (name) => (node) => node.type?.displayName === name

test('a zone change clears the query store before the new pages render; only the account re-keys the caches', () => {
  const { AppContent, h } = appHarness()
  const render = () => h.runtime.render(AppContent)
  let tree = render()
  const tasks = findElement(tree, byName('@contexts/TaskCacheContext#TaskCacheProvider'))
  assert.equal(tasks.key, 'member-7', 'only the account keys the caches')
  assert.equal(tasks.props.resetKey, 'Asia/Seoul@540')
  render()
  assert.equal(h.clears, 0, 'a render in the same zone keeps the cache')

  h.zoneKey = 'America/New_York@-300'
  tree = render()
  // The tree this render returns already mounts the new zone's pages, so the store is empty by now.
  assert.equal(h.clears, 1)
  const schedules = findElement(tree, byName('@contexts/ScheduleCacheContext#ScheduleCacheProvider'))
  assert.equal(schedules.key, null)
  assert.equal(schedules.props.resetKey, 'America/New_York@-300')
  assert.equal(findElement(tree, byName('@contexts/TaskCacheContext#TaskCacheProvider')).key, 'member-7')
  assert.equal(findElement(tree, byName('@contexts/ScheduleViewStateContext#ScheduleViewStateProvider')).key, null)
  render()
  assert.equal(h.clears, 1)
})

test('an open surface page remounts with a new zone, like the background page', () => {
  const { WorkspaceRoutes, h } = appHarness()
  h.location = { pathname: '/app/tasks/7', search: '', hash: '', state: null, key: 'surface' }
  const surfaceRoutes = () => {
    const tree = h.runtime.render(WorkspaceRoutes)
    const surface = findElement(tree, byName('@shared/routing/RouteSurface#RouteSurface'))
    return findElement(surface.props.children, byName('Routes'))
  }
  assert.equal(surfaceRoutes().key, 'Asia/Seoul@540')
  h.zoneKey = 'America/New_York@-300'
  assert.equal(surfaceRoutes().key, 'America/New_York@-300')
  // AppShell builds the whole shell (sidebar, bars, player), too much to mount here; its Outlet
  // must carry the zone key so the background page remounts while the shell stays.
  const shell = readFileSync(new URL('../src/shared/components/layout/AppShell.tsx', import.meta.url), 'utf8')
  assert.match(shell, /<Outlet key=\{zoneKey\} \/>/)
})
