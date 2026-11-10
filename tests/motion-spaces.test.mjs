import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { requireFrom } from './support/errors.mjs'

const plain = (value) => JSON.parse(JSON.stringify(value))
const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

function load(path, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(read(path), {
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
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    console: { error() {} },
    require: requireFrom(dependencies),
    ...globals,
  })
  return module.exports
}

// The real shared motion primitives, so presence and tweens behave as in the app.
const motion = () => {
  const tokens = load('shared/motion/tokens.ts', {}, { window: undefined })
  const presence = load('shared/motion/presence.ts')
  const list = load('shared/motion/useListPresence.ts', {
    react: React,
    './presence': presence,
    './tokens': tokens,
  })
  const tween = load('shared/motion/useTweenedNumber.ts', {
    react: React,
    './tokens': tokens,
  })
  return { ...tokens, ...list, ...tween }
}

// ---------------------------------------------------------------------------
// Spaces store: reloads that change nothing stay silent (audit sw-pwa 12-13)
// ---------------------------------------------------------------------------

function storeHarness(respond) {
  const window = new EventTarget()
  const clock = { now: 1_000_000 }
  const dispatched = []
  const effects = []
  let subscribe
  const store = load(
    'features/spaces/store.ts',
    {
      react: {
        useEffect: (effect) => effects.push(effect),
        useMemo: (compute) => compute(),
        useState: (initial) => [initial, () => {}],
        useSyncExternalStore: (next, get) => {
          subscribe = next
          return get()
        },
      },
      '@shared/api/authTokens': {
        getAccessToken: () => 'member-1',
        getTokenSubject: (token) => token,
      },
      '@shared/utils/events': {
        dispatchTaskChanged: (detail) => dispatched.push(['task', detail.reason]),
        dispatchScheduleChanged: (detail) => dispatched.push(['schedule', detail.reason]),
      },
      './metadata': {
        clearWorkspaceMetadata() {},
        syncAccessibleSpaces: () => ({ spaceIds: [] }),
      },
      './api': { fetchWorkspace: () => respond() },
      '@shared/utils/sameData': load('shared/utils/sameData.ts'),
    },
    {
      window,
      Date: { now: () => clock.now },
      sessionStorage: { getItem: () => null, setItem() {} },
    },
  )
  store.useSpaces()
  let emits = 0
  subscribe(() => emits++)
  return {
    store,
    window,
    clock,
    dispatched,
    effects,
    emits: () => emits,
  }
}

const snapshot = (overrides = {}) => ({
  memberId: 1,
  nickname: '나',
  defaultSpaceId: -4,
  spaces: [
    { id: -4, name: '나의 스페이스', members: [], allowedActions: {}, personal: true, deleted: false },
    { id: 22, name: '핀잇 개선', members: [], allowedActions: {}, personal: false, deleted: false },
  ],
  projects: [{ id: 5, spaceId: 22, name: '모션', completed: false, deleted: false }],
  taskAssignments: {},
  scheduleAssignments: {},
  ...overrides,
})

test('a reload that returns the same workspace emits nothing and refetches nothing', async () => {
  const h = storeHarness(async () => snapshot())
  await h.store.reloadSpaces()
  const first = h.store.useSpaces()
  const emitted = h.emits()
  h.dispatched.length = 0
  await h.store.reloadSpaces()
  assert.equal(h.emits(), emitted, 'no consumer re-renders')
  assert.deepEqual(h.dispatched, [], 'no list refetch')
  assert.equal(h.store.useSpaces().revision, first.revision)
})

test('a reload with a real change still emits once', async () => {
  let current = snapshot()
  const h = storeHarness(async () => current)
  await h.store.reloadSpaces()
  const emitted = h.emits()
  current = snapshot({
    projects: [{ id: 5, spaceId: 22, name: '모션', completed: true, deleted: false }],
  })
  await h.store.reloadSpaces()
  assert.equal(h.emits(), emitted + 1)
  assert.equal(h.store.useSpaces().projects[0].completed, true)
})

test('a reload after a failure clears the error even when the data is the same', async () => {
  let fail = false
  const h = storeHarness(async () => {
    if (fail) throw new Error('서버 오류')
    return snapshot()
  })
  await h.store.reloadSpaces()
  fail = true
  await h.store.reloadSpaces().catch(() => {})
  assert.notEqual(h.store.useSpaces().error, null)
  fail = false
  const emitted = h.emits()
  await h.store.reloadSpaces()
  assert.equal(h.store.useSpaces().error, null)
  assert.equal(h.emits(), emitted + 1)
})

test('choosing the space or project already chosen changes nothing', async () => {
  const h = storeHarness(async () => snapshot())
  await h.store.reloadSpaces()
  h.store.selectSpace(22)
  const emitted = h.emits()
  h.dispatched.length = 0
  h.store.selectSpace(22)
  h.store.selectProject(null)
  assert.equal(h.emits(), emitted)
  assert.deepEqual(h.dispatched, [])
  h.store.selectProject(5)
  assert.equal(h.emits(), emitted + 1)
  assert.deepEqual(plain(h.dispatched), [
    ['task', 'space-scope'],
    ['schedule', 'space-scope'],
  ])
})

test('window focus reloads the workspace at most once per throttle window', async () => {
  let calls = 0
  const h = storeHarness(async () => {
    calls++
    return snapshot()
  })
  h.store.useWorkspaceEvents()
  h.effects.at(-1)()
  await h.store.reloadSpaces()
  assert.equal(calls, 1)
  h.window.dispatchEvent(new Event('focus'))
  await Promise.resolve()
  assert.equal(calls, 1, 'focus right after a load is ignored')
  h.clock.now += h.store.FOCUS_RELOAD_MS
  h.window.dispatchEvent(new Event('focus'))
  await Promise.resolve()
  assert.equal(calls, 2, 'focus after the window reloads')
})

test('window focus retries at once after a failed load', async () => {
  let calls = 0
  const h = storeHarness(async () => {
    calls++
    if (calls === 1) throw new Error('끊김')
    return snapshot()
  })
  h.store.useWorkspaceEvents()
  h.effects.at(-1)()
  await h.store.reloadSpaces().catch(() => {})
  h.window.dispatchEvent(new Event('focus'))
  await Promise.resolve()
  assert.equal(calls, 2)
})

test('sameData compares plain server data structurally', () => {
  const { sameData } = load('shared/utils/sameData.ts')
  assert.equal(sameData(snapshot(), snapshot()), true)
  assert.equal(sameData({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }), false)
  assert.equal(sameData({ a: 1 }, { a: 1, b: undefined }), false)
  assert.equal(sameData([1, 2], { 0: 1, 1: 2 }), false)
  assert.equal(sameData(null, {}), false)
})

// ---------------------------------------------------------------------------
// Hub data: cached per space, kept through refetches
// ---------------------------------------------------------------------------

test('hub data reads through the revalidating cache, keyed by space and week', async () => {
  const calls = []
  const reads = []
  const useHubData = load('features/spaces/hub/useHubData.ts', {
    '@shared/hooks/useRevalidatingQuery': {
      useRevalidatingQuery: (key, fetcher, options) => {
        calls.push({ key, fetcher, options })
        return {
          data: key === 'spaces/hub/summaries' ? { spaces: [] } : undefined,
          error: null,
          isInitialLoading: key !== null && key !== 'spaces/hub/summaries',
          refetch: () => calls.push({ refetch: key }),
        }
      },
    },
    '../api': {
      fetchSpaceSummaries: (signal) => reads.push(['summaries', typeof signal]),
      fetchSpaceSummary: (spaceId, signal) => reads.push(['summary', spaceId, typeof signal]),
      fetchWeeklyRecord: (spaceId, weekStart, signal) => reads.push(['record', spaceId, weekStart, typeof signal]),
    },
  }).default
  const { summaries, summary, record } = useHubData(22, '2026-11-09', true)
  assert.deepEqual(
    calls.map((call) => call.key),
    ['spaces/hub/summaries', 'spaces/hub/summary:22', 'spaces/hub/record:22:2026-11-09'],
  )
  for (const call of calls) {
    assert.deepEqual(plain(call.options.invalidateOn), ['task', 'schedule'])
    assert.equal(call.options.group, 'spaces/hub/')
    await call.fetcher(new AbortController().signal)
  }
  assert.deepEqual(reads, [
    ['summaries', 'object'],
    ['summary', 22, 'object'],
    ['record', 22, '2026-11-09', 'object'],
  ], 'each key reads the space and week it names')
  assert.deepEqual(plain(summaries.data), { spaces: [] })
  assert.equal(summary.data, null, 'no data yet is null, never another space')
  assert.equal(summary.isLoading, true)
  record.reload()
  assert.equal(calls.at(-1).refetch, 'spaces/hub/record:22:2026-11-09')

  calls.length = 0
  useHubData(null, '2026-11-09', false)
  assert.deepEqual(
    calls.map((call) => call.key),
    ['spaces/hub/summaries', null, null],
  )
})

// ---------------------------------------------------------------------------
// Which hub pane animates after a selection
// ---------------------------------------------------------------------------

test('only the pane whose content changed rises in', () => {
  const { hubPaneToAnimate } = load(
    'features/spaces/motion.ts',
    { '@shared/motion': motion() },
    { window: undefined },
  )
  const at = (spaceId, detail) => ({ spaceId, detail })
  assert.equal(hubPaneToAnimate(at(null, false), at(22, false), false), null, 'first load')
  assert.equal(hubPaneToAnimate(at(22, true), at(22, true), false), null, 'same space')
  assert.equal(hubPaneToAnimate(at(22, true), at(-4, true), false), 'overview')
  assert.equal(hubPaneToAnimate(at(22, false), at(22, true), true), 'overview', 'narrow: open detail')
  assert.equal(hubPaneToAnimate(at(22, false), at(22, true), false), null, 'wide: detail is not a pane switch')
  assert.equal(hubPaneToAnimate(at(22, true), at(22, false), true), 'rail', 'narrow: back to the list')
})

// ---------------------------------------------------------------------------
// Project completion: optimistic strike in place
// ---------------------------------------------------------------------------

const projectsComponent = () => {
  const hub = load('features/spaces/hub.ts', {
    '@shared/utils/isoDuration': { parseIsoDurationMinutes: () => 0 },
  })
  const shared = motion()
  return load('features/spaces/hub/HubProjects.tsx', {
    'react/jsx-runtime': jsxRuntime,
    '@shared/motion': shared,
    '../UnavailableNote': { default: () => null },
    '../hub': hub,
    '../unavailable': load('features/spaces/unavailable.ts'),
    '../types': {},
    '@shared/components/motion/TweenedNumber': load('shared/components/motion/TweenedNumber.tsx', {
      'react/jsx-runtime': jsxRuntime,
      '@shared/motion': shared,
    }),
    './RowMenu': { default: () => null },
    './TaskDots': { default: () => null },
  }).default
}
const project = (id, completed) => ({
  id,
  spaceId: 22,
  name: '프로젝트 ' + id,
  outcome: null,
  completed,
  deleted: false,
  version: 1,
  allowedActions: { update: true, move: true, delete: true },
})
const renderProjects = (props) =>
  renderToStaticMarkup(
    React.createElement(projectsComponent(), {
      space: { id: 22, members: [], allowedActions: { update: true } },
      rows: [
        { project: project(1, false), counts: { total: 4, completed: 1 }, nearestDueDate: null },
        { project: project(2, true), counts: null, nearestDueDate: null },
      ],
      withoutProject: null,
      loadError: null,
      onRetry() {},
      busy: false,
      onOpen() {},
      onCreate() {},
      onEdit() {},
      onToggle() {},
      onMove() {},
      onDelete() {},
      ...props,
    }),
  )

test('completed projects carry the strike; the open one does not', () => {
  const html = renderProjects()
  assert.match(html, /<span class="motion-strike">프로젝트 1<\/span>/)
  assert.match(html, /<span class="motion-strike" data-done="true">프로젝트 2<\/span>/)
  assert.match(html, /class="hub-count">1\/4</)
  assert.match(html, /class="hub-count" data-pending="true">–</)
})

test('a first load failure shows the message it was given, and a refresh failure keeps the numbers', () => {
  const html = renderProjects({ loadError: '스페이스 참여자만 볼 수 있어요.' })
  assert.match(html, /class="hub-load-error" role="alert">스페이스 참여자만 볼 수 있어요. <button/)
  assert.doesNotMatch(renderProjects(), /hub-load-error/)
})

test('a completion that is saving strikes the row in place, before it moves lists', () => {
  const html = renderProjects({ settling: { id: 1, completed: true } })
  const [open, closed] = html.split('hub-closed')
  assert.match(open, /<li class="hub-row hub-project is-completed"><button[^>]*>.*data-done="true">프로젝트 1</)
  assert.ok(!closed.includes('>프로젝트 1<'), 'the row stays in the open list until the server confirms')
  const reopening = renderProjects({ settling: { id: 2, completed: false } })
  assert.match(reopening, /<span class="motion-strike">프로젝트 2<\/span>/)
})

// ---------------------------------------------------------------------------
// Time bars grow with transform, not width
// ---------------------------------------------------------------------------

test('time bars set a scale and never an animated width', () => {
  const TimeBars = load('features/spaces/TimeBars.tsx', {
    'react/jsx-runtime': jsxRuntime,
    '@shared/utils/isoDuration': { formatMinutesLabel: (minutes) => minutes + '분' },
    './TimeBars.css': {},
  }).default
  const html = renderToStaticMarkup(
    React.createElement(TimeBars, {
      rows: [
        { key: 'a', name: '모션', minutes: 120 },
        { key: 'b', name: '정리', minutes: 30 },
      ],
    }),
  )
  assert.match(html, /--time-bar-scale:1"/)
  assert.match(html, /--time-bar-scale:0\.25"/)
  assert.ok(!/width:/.test(html))
})

// ---------------------------------------------------------------------------
// Dialogs fade out instead of vanishing
// ---------------------------------------------------------------------------

test('the conflict notice stays mounted through its exit and hands it to the modal', () => {
  const Notice = (presence) =>
    load('features/spaces/ConflictNotice.tsx', {
      react: React,
      'react/jsx-runtime': jsxRuntime,
      '@shared/components/common/Modal': {
        default: ({ closing, children }) =>
          React.createElement('div', { role: 'dialog', 'data-closing': String(closing) }, children),
      },
      '@shared/motion': { usePresence: () => presence },
      './conflicts': { EVENT: 'workspace:edit-conflict' },
      './store': { useSpaces: () => ({ reload: async () => {} }) },
    }).default
  const render = (presence) => renderToStaticMarkup(React.createElement(Notice(presence)))
  assert.equal(render({ mounted: false, closing: false }), '')
  assert.match(render({ mounted: true, closing: false }), /data-closing="false"/)
  assert.match(render({ mounted: true, closing: true }), /data-closing="true"[^]*다른 참여자가 먼저 수정했어요/)
})

// ---------------------------------------------------------------------------
// CSS contract for the spaces area
// ---------------------------------------------------------------------------

// CSS is only readable as text here; these rules hold for every rule in the area, not one selector.
test('spaces CSS animates only transform, opacity and colors, with the motion tokens', () => {
  for (const file of [
    'features/spaces/spaces.css',
    'features/spaces/hub/hub.css',
    'features/spaces/TimeBars.css',
  ]) {
    const css = read(file)
    assert.ok(!/transition:\s*all\b/.test(css), file + ': transition: all')
    assert.ok(!/\binfinite\b/.test(css), file + ': looping animation')
    for (const [, body] of css.matchAll(/transition:([^;]+);/g)) {
      for (const part of body.split(',')) {
        const property = part.trim().split(/\s+/)[0]
        if (property === 'none') continue
        assert.ok(
          ['transform', 'opacity', 'color', 'background-color', 'border-color'].includes(property),
          `${file}: transitions ${property}`,
        )
        assert.match(part, /var\(--motion-/, `${file}: ${property} uses a token`)
      }
    }
    for (const [, name, body] of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\}\s*)\}/g)) {
      assert.ok(!/^(motion-|modalFadeIn|modalSlideUp|fadeIn|fadeSlideIn)/.test(name), `${file}: shared keyframe ${name}`)
      for (const [, property] of body.matchAll(/([\w-]+)\s*:/g))
        assert.ok(['transform', 'opacity'].includes(property), `${file}: ${name} animates ${property}`)
    }
    // A local grow keeps no end state, or the element's own transform could not transition later.
    const local = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(([, name]) => name)
    for (const [, value] of css.matchAll(/animation:\s*([^;]+);/g)) {
      const name = value.trim().split(/\s+/)[0]
      if (local.includes(name)) assert.match(value, /\bbackwards\b/, `${file}: ${name} fill mode`)
    }
  }
})

// Element trees keep React keys, which decide whether a node is kept or remounted.
const tree = (Component, props) => {
  const jsx = (type, elementProps, key) => ({ type, props: elementProps, key })
  const nodes = []
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    nodes.push(node)
    walk(node.props?.children)
  }
  walk(Component(jsx)(props))
  return nodes
}

test('hub numbers and record bars start fresh in another space instead of gliding from the last one', () => {
  const hub = load('features/spaces/hub.ts', {
    '@shared/utils/isoDuration': { parseIsoDurationMinutes: () => 0 },
  })
  const Tweened = () => null
  const people = tree(
    (jsx) =>
      load('features/spaces/hub/HubPeople.tsx', {
        'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
        '@shared/motion': {
          useListPresence: (items, getKey) =>
            (items ?? []).map((item) => ({ key: String(getKey(item)), item, phase: 'present' })),
          presenceProps: () => ({}),
        },
        '@shared/components/motion/TweenedNumber': { default: Tweened },
        '../UnavailableNote': { default: () => null },
        '../hub': hub,
        '../unavailable': load('features/spaces/unavailable.ts'),
        './RowMenu': { default: () => null },
      }).default,
    {
      space: { id: 22, members: [{ memberId: 7, nickname: '나', role: 'ADMIN' }], allowedActions: { assign: true } },
      rows: [{ memberId: 7, name: '나', admin: true, openAssignedCount: 2, nearestDueDate: null }],
      unassigned: { openCount: 3, nearestDueDate: null },
      loadError: null,
      onRetry() {},
      busy: false,
      onInvite() {},
      onToggleAdmin() {},
      onRemove() {},
      onAssign() {},
    },
  )
  const counts = people.filter((node) => node.type === Tweened)
  assert.equal(counts.length, 2, 'a member count and the unassigned count')
  for (const count of counts) assert.equal(String(count.key), '22')

  const record = tree(
    (jsx) =>
      load('features/spaces/hub/TeamRecord.tsx', {
        'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
        '@shared/utils/isoDuration': { formatIsoDurationLabel: () => '1시간', formatMinutesLabel: () => '1시간' },
        '../TimeBars': { default: () => null },
        '../hub': hub,
      }).default,
    {
      space: { id: 22, members: [] },
      projects: [],
      meId: 7,
      record: { spaceId: 22, start: '2026-11-09', end: '2026-11-16', completedCount: 1, elapsed: 'PT1H', days: [], byProject: [], byRunner: [] },
      loadError: null,
      loading: false,
      onRetry() {},
      today: '2026-11-10',
    },
  )
  const body = record.find((node) => node.props?.className === 'hub-record__body')
  assert.ok(body, 'the record renders its body')
  assert.equal(body.key, '22:2026-11-09')
})

// ---------------------------------------------------------------------------
// Form affiliation line: values that arrive or change fade in, the first one does not
// ---------------------------------------------------------------------------

test('the affiliation line fades in a changed value and leaves the first one still', () => {
  const { shouldFadeText, fadeIn } = load(
    'features/spaces/motion.ts',
    { '@shared/motion': motion() },
    { window: undefined },
  )
  assert.equal(shouldFadeText(null, '핀잇 개선 › 작업 카드 개선, 담당자 확인 중'), false, 'form opens')
  assert.equal(
    shouldFadeText('핀잇 개선 › 작업 카드 개선, 담당자 확인 중', '핀잇 개선 › 작업 카드 개선, 담당 나'),
    true,
    'server default assignee arrives',
  )
  assert.equal(shouldFadeText('나의 스페이스, 담당 나', '나의 스페이스, 담당 나'), false, 'same text')

  const calls = []
  fadeIn({ animate: (frames, options) => calls.push(plain({ frames, options })) })
  assert.deepEqual(calls, [
    { frames: [{ opacity: 0 }, { opacity: 1 }], options: { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' } },
  ], 'opacity only, so reduced motion keeps it')
  assert.doesNotThrow(() => fadeIn(null))
  assert.doesNotThrow(() => fadeIn({}), 'no Web Animations support')
})
