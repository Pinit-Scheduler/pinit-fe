import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

// ADR-0021 알림 설정 helper와 서비스 워커 푸시 문구.
const loadModule = (relativePath) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports })
  return module.exports
}

const prefs = loadModule('../src/features/settings/utils/notificationPreferences.ts')

const loadSwScript = (file, globals = {}) => {
  const scope = { ...globals }
  scope.self = scope
  vm.createContext(scope)
  vm.runInContext(readFileSync(new URL(`../public/sw/${file}`, import.meta.url), 'utf8'), scope)
  return scope.pinitSw
}
const loadContent = () => loadSwScript('content.js').content

test('reminder options map to server minutes and off', () => {
  assert.equal(prefs.parseReminderOption('off'), null)
  assert.equal(prefs.parseReminderOption('10'), 10)
  assert.equal(prefs.parseReminderOption('7'), null)
  assert.equal(prefs.reminderOptionLabel(null), '끔')
  assert.equal(prefs.reminderOptionLabel(15), '15분 전')
  assert.equal(prefs.reminderOptionLabel(60), '1시간 전')
})

test('deadline time is sent as HH:mm', () => {
  assert.equal(prefs.normalizeDeadlineTime('08:30'), '08:30')
  assert.equal(prefs.normalizeDeadlineTime('08:30:15'), '08:30')
  assert.equal(prefs.normalizeDeadlineTime('24:00'), null)
  assert.equal(prefs.normalizeDeadlineTime(''), null)
})

test('saving sends the member zone and keeps the stored one when unknown', () => {
  const base = { ...prefs.DEFAULT_NOTIFICATION_PREFERENCES }
  assert.equal(prefs.withZone(base, 'America/New_York').zoneId, 'America/New_York')
  assert.equal(prefs.withZone(base, '').zoneId, 'Asia/Seoul')
})

test('push text follows the kind the server sends', () => {
  const { getNotificationContent } = loadContent()
  assert.deepEqual(
    { ...getNotificationContent({}, { kind: 'SCHEDULE_START', scheduleTitle: '회의' }, '오전 10:00') },
    { title: '"회의" 일정이 시작돼요', body: '오전 10:00 시작 예정이에요.' },
  )
  assert.deepEqual(
    { ...getNotificationContent({}, { kind: 'SCHEDULE_REMINDER', scheduleTitle: '회의', reminderMinutes: '10' }, '오전 10:00') },
    { title: '"회의" 10분 후 시작', body: '오전 10:00 시작 예정이에요.' },
  )
  assert.equal(
    getNotificationContent({}, { kind: 'SCHEDULE_REMINDER', scheduleTitle: '회의', reminderMinutes: '60' }, '').title,
    '"회의" 1시간 후 시작',
  )
  assert.deepEqual(
    { ...getNotificationContent({}, { kind: 'TASK_DEADLINE', title: '오늘 마감인 작업 2개', body: '보고서, 발표' }, '') },
    { title: '오늘 마감인 작업 2개', body: '보고서, 발표' },
  )
  // ADR-0021 이전 서버 메시지(kind 없음)는 시작 알림으로 본다.
  assert.equal(getNotificationContent({}, { scheduleTitle: '회의' }, '오전 10:00').title, '"회의" 일정이 시작돼요')
})

test('an FCM notification title or body overrides only that part', () => {
  const { getNotificationContent } = loadContent()
  const data = { kind: 'SCHEDULE_START', scheduleTitle: '회의' }
  assert.deepEqual(
    { ...getNotificationContent({ title: '서버 제목' }, data, '오전 10:00') },
    { title: '서버 제목', body: '오전 10:00 시작 예정이에요.' },
  )
  assert.deepEqual(
    { ...getNotificationContent({ body: '서버 본문' }, data, '오전 10:00') },
    { title: '"회의" 일정이 시작돼요', body: '서버 본문' },
  )
})

test('tapping a notification opens only paths of this app', () => {
  const { clients } = loadSwScript('clients.js', { location: { origin: 'https://pinit.go-gradually.me' }, URL })
  assert.equal(clients.resolveTargetUrl({ data: { url: '/app/tasks' } }), 'https://pinit.go-gradually.me/app/tasks')
  assert.equal(
    clients.resolveTargetUrl({ data: { url: '//example.org/login' } }),
    'https://pinit.go-gradually.me/app/schedules',
  )
  assert.equal(clients.resolveTargetUrl({ data: {} }), 'https://pinit.go-gradually.me/app/schedules')
})
