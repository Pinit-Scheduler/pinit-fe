import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const plain = (value) => JSON.parse(JSON.stringify(value))
const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

function load(path, dependencies = {}) {
  const output = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
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

test('TrashPage keeps its list through refetches and never disables every row while busy', () => {
  const source = read('features/trash/pages/TrashPage.tsx')
  assert.match(source, /useRevalidatingQuery<TrashContents>\(TRASH_KEY/)
  assert.match(source, /useListPresence\(contents\?\.tasks/)
  assert.match(source, /presenceProps\(phase\)/)
  assert.doesNotMatch(source, /busyKey !== null/, 'one pending action must not dim the whole list')
  assert.doesNotMatch(source, /await load\(\)/)
})

// ---------------------------------------------------------------------------
// Recurrences: surfaces open in place (audit C4) and the list keeps its rows
// ---------------------------------------------------------------------------

test('RecurrencesPage opens the create surfaces with open() and keys its list on scope', () => {
  const source = read('features/recurrence/pages/RecurrencesPage.tsx')
  assert.match(source, /onClick=\{openSurface\('\/app\/schedules\/new'\)\}/)
  assert.match(source, /onClick=\{openSurface\('\/app\/tasks\/new'\)\}/)
  assert.match(source, /const \{ open \} = useRouteSurfaceNavigation\(\)/)
  assert.match(source, /recurrences\/\$\{status\}\/\$\{selectedSpaceId \?\? 'all'\}\/\$\{selectedProjectId \?\? 'all'\}/)
  assert.doesNotMatch(source, /setItems\(null\)/, 'a reload must not blank the list')
  assert.doesNotMatch(source, /await load\(\)/, 'the change event already refetches after a save')
})

test('the recurrence scope dialog keeps the last request on screen while it closes', () => {
  const source = read('features/recurrence/components/RecurrenceScopeDialog.tsx')
  assert.match(source, /usePresence\(pending\)/)
  assert.match(source, /closing=\{presence\.closing\}/)
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

test('reloading routines or exceptions keeps the content instead of showing the loading placeholder', () => {
  for (const path of [
    'features/routines/pages/RoutinesPage.tsx',
    'features/routines/components/RoutineOverridesSection.tsx',
  ]) {
    const source = read(path)
    const start = source.indexOf('const load = useCallback')
    const load = source.slice(start, source.indexOf('}, [', start))
    assert.ok(load.includes('fetchRoutine'), path)
    assert.doesNotMatch(load, /setIsLoading\(true\)/, path)
    assert.match(source, /hasLoaded\.current/, path)
    assert.match(source, /<PresenceList/, path)
  }
})

// ---------------------------------------------------------------------------
// Settings: per-account cache, no dimming while saving, save confirmation
// ---------------------------------------------------------------------------

test('the settings cache only returns values saved for the signed-in account', () => {
  let token = 'token-a'
  const cache = load('features/settings/hooks/memberCache.ts', {
    '@shared/api/authTokens': {
      getAccessToken: () => token,
      getTokenSubject: (value) => (value ? value.replace('token-', 'member-') : null),
    },
  })
  const store = cache.createMemberCache()
  assert.equal(store.read(), undefined)
  store.write({ zoneId: 'Asia/Seoul' })
  assert.deepEqual(plain(store.read()), { zoneId: 'Asia/Seoul' })
  token = 'token-b'
  assert.equal(store.read(), undefined, 'another account never sees the cached value')
  token = null
  assert.equal(store.read(), undefined)
})

test('a read that started before a save never overwrites the saved value', () => {
  for (const [path, counter] of [
    ['features/settings/hooks/useProfileSettings.ts', 'saves'],
    ['features/settings/hooks/useNotificationPreferences.ts', 'updates'],
  ]) {
    const source = read(path)
    assert.match(source, new RegExp(`${counter}\\.current \\+= 1`), path)
    assert.match(source, new RegExp(`${counter}\\.current (?:!==|===) ${counter}AtStart`), path)
  }
})

test('notification toggles use a ref lock instead of disabling while a save is pending', () => {
  const source = read('features/settings/pages/SettingsPage.tsx')
  assert.doesNotMatch(source, /isPreferencesSaving/)
  assert.match(source, /toggleLock\.current/)
  assert.match(source, /<SavedMark visible=\{isFlashing\('scheduleStart'\)\} \/>/)
})

test('saving the daily objective never dims the time zone select', () => {
  const source = read('features/settings/components/ProfileSettingRows.tsx')
  const zoneRow = source.slice(source.indexOf('export const TimeZoneSetting'))
  // The zone row tracks only its own save; the shared isSaving prop is set by every row.
  assert.match(zoneRow, /\(\{ settings, isLoading, save \}: RowProps\)/)
  assert.match(zoneRow, /const \[isSaving, setIsSaving\] = useState\(false\)/)
})

test('revoking the last connected app keeps the list instead of showing the loading panel', () => {
  const hook = read('features/settings/hooks/useOAuthGrants.ts')
  assert.match(hook, /isLoading: isLoading && !hasLoaded/)
  const section = read('features/settings/components/AiConnectionSection.tsx')
  assert.match(section, /useListPresence\(hasLoaded \? grants : undefined/)
  assert.doesNotMatch(section, /isLoading && grants\.length === 0/)
})

test('the deadline time input only fades in when the toggle turns it on', () => {
  const css = read('features/settings/pages/SettingsPage.css')
  assert.doesNotMatch(css, /\.settings__time \{[^}]*animation/)
  assert.match(css, /\.settings__time--reveal \{[^}]*animation: motion-fade-in/)
})

// ---------------------------------------------------------------------------
// Motion hygiene for every stylesheet this area owns
// ---------------------------------------------------------------------------

const ownedStyles = [
  'features/settings/pages/SettingsPage.css',
  'features/settings/components/SavedMark.css',
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

test('the spotlight tour fades out with its last step and keeps the reduced-motion override', () => {
  const css = read('features/onboarding/components/SpotlightTour.css')
  assert.match(css, /\.spotlight-tour\[data-state='closing'\]/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.spotlight-tour__callout\s*\{\s*transition: none;/)
  const context = read('features/onboarding/context/OnboardingTourContext.tsx')
  assert.match(context, /usePresence\(tour\)/)
  assert.match(context, /closing=\{presence\.closing\}/)
})
