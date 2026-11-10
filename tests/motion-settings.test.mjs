import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { apiError, requireFrom } from './support/errors.mjs'
import { deferred, hookRunner, settle } from './support/hooks.mjs'

const plain = (value) => JSON.parse(JSON.stringify(value))
const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

function load(path, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: requireFrom(dependencies),
    ...globals,
  })
  return module.exports
}

// ---------------------------------------------------------------------------
// Trash: restored and purged rows leave locally; only restores elsewhere refetch
// ---------------------------------------------------------------------------

test('a restored or purged trash row is dropped locally without touching the other rows', () => {
  const trash = load('features/trash/utils/trashContents.ts')
  const contents = {
    retentionDays: 30,
    tasks: [{ taskId: 1 }, { taskId: 2 }],
    schedules: [{ scheduleId: 7 }, { scheduleId: 8 }],
  }
  assert.deepEqual(plain(trash.withoutTask(contents, 1)), {
    retentionDays: 30,
    tasks: [{ taskId: 2 }],
    schedules: [{ scheduleId: 7 }, { scheduleId: 8 }],
  })
  assert.deepEqual(plain(trash.withoutSchedule(contents, 8).schedules), [{ scheduleId: 7 }])
  assert.equal(contents.tasks.length, 2, 'the cached value is not mutated')
})

test('the trash list refetches only when something was restored', () => {
  const { isRestoreBatch } = load('features/trash/utils/trashContents.ts')
  assert.equal(isRestoreBatch({ tasks: [{ reason: 'restore' }], schedules: [] }), true)
  assert.equal(isRestoreBatch({ tasks: [], schedules: [{ reason: 'restore' }] }), true)
  assert.equal(isRestoreBatch({ tasks: [{ reason: 'state-mutated' }], schedules: [{}] }), false)
})

// ---------------------------------------------------------------------------
// Routines: saved and reloaded entries keep their on-screen keys
// ---------------------------------------------------------------------------

const routineRules = () =>
  load('features/routines/utils/routineRules.ts', {
    '@shared/utils/isoDuration': load('shared/utils/isoDuration.ts'),
  })

const draft = (key, kind, startTime, extra = {}) => ({
  key,
  kind,
  label: '',
  startTime,
  durationMinutes: 30,
  days: ['MONDAY'],
  remindAtStart: false,
  ...extra,
})

test('routines that come back from a save keep their keys, so only real changes animate', () => {
  const { reuseDraftKeys } = routineRules()
  const onScreen = [draft('a', 'BREAKFAST', '08:00'), draft('b', 'LUNCH', '12:00'), draft('c', 'CUSTOM', '18:00', { label: '운동' })]
  const fromServer = [
    draft('n1', 'BREAKFAST', '08:00'),
    draft('n2', 'LUNCH', '12:30'), // edited: same kind keeps the key
    draft('n3', 'CUSTOM', '18:00', { label: '운동' }),
    draft('n4', 'DINNER', '19:00'), // new: keeps its fresh key
  ]
  assert.deepEqual(
    reuseDraftKeys(fromServer, onScreen).map((item) => item.key),
    ['a', 'b', 'c', 'n4'],
  )
})

test('an exact match wins over a same-kind match when two entries share a kind', () => {
  const { reuseDraftKeys } = routineRules()
  const onScreen = [draft('weekday', 'SLEEP', '23:00'), draft('weekend', 'SLEEP', '01:00')]
  const fromServer = [draft('x', 'SLEEP', '01:00'), draft('y', 'SLEEP', '23:30')]
  assert.deepEqual(
    reuseDraftKeys(fromServer, onScreen).map((item) => item.key),
    ['weekend', 'weekday'],
  )
})

// ---------------------------------------------------------------------------
// Settings: values survive a time zone reset, per account; late reads never undo a save
// ---------------------------------------------------------------------------

const settingsHarness = (api) => {
  const subject = { current: 'member-a' }
  const queryGlobals = { AbortController, queueMicrotask, Date }
  const { createQueryStore } = load('shared/utils/queryStore.ts', {}, queryGlobals)
  const appStore = createQueryStore()
  const memberStore = load('features/settings/hooks/memberStore.ts', {
    '@shared/utils/queryStore': { createQueryStore },
  })
  const notificationUtils = load('features/settings/utils/notificationPreferences.ts')
  const mount = (path, extra = {}) => {
    const runner = hookRunner()
    const query = load(
      'shared/hooks/useRevalidatingQuery.ts',
      {
        react: runner.react,
        '@shared/api/authTokens': { getAccessToken: () => subject.current, getTokenSubject: (token) => token },
        '@shared/utils/events': { onDataChanged: () => () => {} },
        '@shared/utils/queryStore': { queryStore: appStore },
      },
      queryGlobals,
    )
    const module = load(path, {
      react: runner.react,
      '@shared/hooks/useRevalidatingQuery': query,
      './memberStore': memberStore,
      '../utils/notificationPreferences': notificationUtils,
      ...api,
      ...extra,
    })
    return { module, ...runner }
  }
  return { subject, appStore, mount }
}

/** An API whose calls each wait for the test to answer them. */
const pendingCalls = () => {
  const calls = []
  const call = (...args) => {
    const next = deferred()
    calls.push({ args, ...next })
    return next.promise
  }
  return { calls, call }
}

const PROFILE = 'features/settings/hooks/useProfileSettings.ts'
const NOTIFICATIONS = 'features/settings/hooks/useNotificationPreferences.ts'
const GRANTS = 'features/settings/hooks/useOAuthGrants.ts'

test('settings stay on screen through a time zone reset, but never for another account', async () => {
  const reads = pendingCalls()
  const h = settingsHarness({ '../api/profileSettings': { fetchProfileSettings: reads.call } })
  const first = h.mount(PROFILE)
  assert.equal(first.render(first.module.default).isLoading, true)
  await settle()
  reads.calls[0].resolve({ zoneId: 'Asia/Seoul', dailyObjectiveWork: 'PT4H' })
  await settle()
  assert.equal(first.render(first.module.default).settings.zoneId, 'Asia/Seoul')
  first.unmount()

  // A zone change clears the app-wide query cache and remounts the screen.
  h.appStore.clear()
  const remounted = h.mount(PROFILE)
  const shown = remounted.render(remounted.module.default)
  assert.equal(shown.isLoading, false)
  assert.equal(shown.settings.zoneId, 'Asia/Seoul', 'the last value shows at once')
  remounted.unmount()

  h.subject.current = 'member-b'
  const other = h.mount(PROFILE)
  const empty = other.render(other.module.default)
  assert.equal(empty.settings, null, 'another account never sees the cached value')
  assert.equal(empty.isLoading, true)
})

test('the zone sync read at app start fills the settings screen too', async () => {
  const applied = []
  const h = settingsHarness({
    '../api/profileSettings': {
      fetchProfileSettings: async () => ({ zoneId: 'Europe/Paris', dailyObjectiveWork: 'PT4H' }),
    },
  })
  const sync = h.mount('features/settings/hooks/useMemberZoneSync.ts', {
    '@contexts/TimePreferencesContext': {
      useTimePreferences: () => ({ zoneId: 'Asia/Seoul', applyZone: (zone) => applied.push(zone) }),
    },
  })
  sync.render(sync.module.useMemberZoneSync)
  await settle()
  assert.deepEqual(applied, ['Europe/Paris'])
  const screen = h.mount(PROFILE)
  const shown = screen.render(screen.module.default)
  assert.equal(shown.isLoading, false)
  assert.equal(shown.settings.zoneId, 'Europe/Paris')
})

test('a profile read that started before a save never overwrites the saved value', async () => {
  const reads = pendingCalls()
  const saves = pendingCalls()
  const h = settingsHarness({
    '../api/profileSettings': { fetchProfileSettings: reads.call, updateProfileSettings: saves.call },
  })
  const screen = h.mount(PROFILE)
  const hook = () => screen.render(screen.module.default)
  hook()
  await settle()
  const saving = hook().save({ dailyObjectiveWork: 'PT6H' })
  saves.calls[0].resolve({ zoneId: 'Asia/Seoul', dailyObjectiveWork: 'PT6H' })
  assert.equal((await saving).dailyObjectiveWork, 'PT6H')
  reads.calls[0].resolve({ zoneId: 'Asia/Seoul', dailyObjectiveWork: 'PT4H' })
  await settle()
  assert.equal(hook().settings.dailyObjectiveWork, 'PT6H')
})

test('a notification toggle shows at once, outlives a late read, and rolls back when the save fails', async () => {
  const reads = pendingCalls()
  const saves = pendingCalls()
  const h = settingsHarness({
    '../api/notificationPreferences': {
      fetchNotificationPreferences: reads.call,
      saveNotificationPreferences: saves.call,
    },
  })
  const server = {
    scheduleStartEnabled: true,
    scheduleReminderMinutes: null,
    taskDeadlineEnabled: false,
    taskDeadlineTime: '09:00',
    zoneId: 'Asia/Seoul',
  }
  const first = h.mount(NOTIFICATIONS)
  first.render(() => first.module.default('Asia/Seoul'))
  await settle()
  reads.calls[0].resolve(server)
  await settle()
  first.unmount()

  // Revisiting shows the cached value and reads again; the user toggles before that read answers.
  const screen = h.mount(NOTIFICATIONS)
  const hook = () => screen.render(() => screen.module.default('Asia/Seoul'))
  assert.equal(hook().isLoading, false)
  await settle()
  const saved = hook().update({ scheduleStartEnabled: false })
  assert.equal(hook().preferences.scheduleStartEnabled, false, 'the toggle moves before the save answers')
  reads.calls[1].resolve(server)
  await settle()
  assert.equal(hook().preferences.scheduleStartEnabled, false, 'the read that started earlier is ignored')
  saves.calls[0].resolve({ ...server, scheduleStartEnabled: false })
  await saved
  assert.equal(hook().preferences.scheduleStartEnabled, false)

  const failed = hook().update({ taskDeadlineEnabled: true })
  assert.equal(hook().preferences.taskDeadlineEnabled, true)
  saves.calls[1].reject(apiError('저장할 수 없어요.', 500))
  await assert.rejects(failed)
  assert.equal(hook().preferences.taskDeadlineEnabled, false, 'a failed save goes back to the previous value')
})

test('revoking the last connected app keeps the list loaded instead of showing the loading panel', async () => {
  const reads = pendingCalls()
  const h = settingsHarness({
    '@features/oauth/api/oauth': { fetchOAuthGrants: reads.call, revokeOAuthGrant: async () => {} },
  })
  const screen = h.mount(GRANTS)
  const hook = () => screen.render(screen.module.default)
  hook()
  await settle()
  reads.calls[0].resolve([{ grantId: 1, clientName: 'Claude' }])
  await settle()
  await hook().revoke(1)
  await settle()
  const refreshing = hook()
  assert.deepEqual(plain(refreshing.grants), [])
  assert.equal(refreshing.hasLoaded, true)
  assert.equal(refreshing.isLoading, false)
  assert.equal(reads.calls.length, 2, 'the list is read again from the server')
})

test('connected apps: a failed first load shows the reason, and a retry shows loading instead', async () => {
  const reads = pendingCalls()
  const h = settingsHarness({
    '@features/oauth/api/oauth': { fetchOAuthGrants: reads.call, revokeOAuthGrant: async () => {} },
  })
  const screen = h.mount(GRANTS)
  const hook = () => screen.render(screen.module.default)
  hook()
  await settle()
  reads.calls[0].reject(new TypeError('Failed to fetch'))
  await settle()
  const failed = hook()
  assert.equal(failed.isLoading, false)
  assert.equal(failed.error, '연결된 앱을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
  failed.refetch()
  await settle()
  const retrying = hook()
  assert.equal(retrying.isLoading, true)
  assert.equal(retrying.error, null)
})

// ---------------------------------------------------------------------------
// Motion hygiene for every stylesheet this area owns
// ---------------------------------------------------------------------------

const ownedStyles = [
  'features/settings/pages/SettingsPage.css',
  'shared/components/motion/SavedMark.css',
  'features/settings/components/AccountSection.css',
  'features/settings/components/AiConnectionSection.css',
  'features/settings/components/CopyableCode.css',
  'features/settings/components/ProfileSettingRows.css',
  'features/settings/components/ThemeSection.css',
  'features/routines/pages/RoutinesPage.css',
  'features/recurrence/pages/RecurrencesPage.css',
  'features/trash/pages/TrashPage.css',
  'features/onboarding/components/SpotlightTour.css',
  'features/onboarding/pages/OnboardingGuidePage.css',
  'features/oauth/pages/OAuthConsentPage.css',
]

// Source check kept: CSS never runs in these tests, so the motion contract is read from the stylesheets.
test('owned stylesheets name their transitions, use the motion tokens and never loop', () => {
  for (const path of ownedStyles) {
    const css = read(path)
    assert.doesNotMatch(css, /transition:\s*all\b/, `${path}: transition: all`)
    assert.doesNotMatch(css, /\binfinite\b/, `${path}: looping animation`)
    assert.doesNotMatch(css, /transition:[^;]*\b\d+(?:\.\d+)?m?s\s+ease\b/, `${path}: hard-coded duration and ease`)
    assert.doesNotMatch(css, /transition:[^;]*\b(?:width|height|top|left|margin|box-shadow)\b/, `${path}: animates layout or shadow`)
    for (const name of css.matchAll(/@keyframes\s+([\w-]+)/g))
      assert.ok(!/^(motion-|modalFadeIn$|modalSlideUp$|fadeIn$|fadeSlideIn$)/.test(name[1]), `${path} redefines ${name[1]}`)
  }
})
