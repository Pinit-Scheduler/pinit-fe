import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load, plain } from './load.mjs'

const { parseWebMessage, nativeTargetOf, safeWebPath, isSameOrigin } = load('../src/bridge/protocol.ts')

test('웹이 보낸 메시지 네 가지를 읽는다', () => {
  assert.deepEqual(plain(parseWebMessage('{"type":"close"}')), { type: 'close' })
  assert.deepEqual(plain(parseWebMessage('{"type":"logout"}')), { type: 'logout' })
  assert.deepEqual(plain(parseWebMessage('{"type":"route","path":"/login"}')), { type: 'route', path: '/login' })
  assert.deepEqual(plain(parseWebMessage('{"type":"refresh","id":"r1"}')), { type: 'refresh', id: 'r1' })
})

test('모르는 메시지, 깨진 값, 필드가 빠진 메시지는 버린다', () => {
  for (const raw of [
    undefined,
    null,
    42,
    '',
    'not json',
    'null',
    '[]',
    '{"type":"open"}',
    '{"type":"route"}',
    '{"type":"route","path":"https://evil.example/"}',
    '{"type":"route","path":"app/today"}',
    '{"type":"refresh"}',
    '{"type":"refresh","id":""}',
    '{"type":"refresh","id":7}',
  ])
    assert.equal(parseWebMessage(raw), null, String(raw))
})

test('메시지에 딸려 온 다른 필드는 넘기지 않는다', () => {
  assert.deepEqual(plain(parseWebMessage('{"type":"close","token":"x","path":"/app"}')), { type: 'close' })
})

test('오늘과 로그인은 앱 화면이 맡는다', () => {
  for (const path of ['/app/today', '/app/today/', '/app', '/app/', '/app/today?from=x', '/app/today#top'])
    assert.equal(nativeTargetOf(path), 'today', path)
  for (const path of ['/', '/login', '/login/', '/login?returnTo=%2Fapp'])
    assert.equal(nativeTargetOf(path), 'auth', path)
})

test('그 밖의 웹 경로는 앱이 맡지 않는다', () => {
  for (const path of ['/app/tasks', '/app/schedules', '/app/tasks/12', '/app/todayish', '/login/callback/naver', '/signup', '/app/settings'])
    assert.equal(nativeTargetOf(path), null, path)
})

test('WebView에는 사이트 안의 절대 경로만 연다', () => {
  assert.equal(safeWebPath('/app/tasks/12'), '/app/tasks/12')
  assert.equal(safeWebPath('/app/schedules/new?date=2026-12-24'), '/app/schedules/new?date=2026-12-24')
  for (const path of [undefined, null, 3, '', 'app/tasks', 'https://evil.example/', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)'])
    assert.equal(safeWebPath(path), '/app/settings', String(path))
  assert.equal(safeWebPath('//evil.example', '/login'), '/login')
})

test('같은 출처만 WebView 안에서 연다', () => {
  const origin = 'https://pinit.go-gradually.me'
  for (const url of [origin, origin + '/', origin + '/app/tasks', origin + '?x=1', origin + '#top'])
    assert.equal(isSameOrigin(url, origin), true, url)
  assert.equal(isSameOrigin(origin + '/app', origin + '/'), true)
  for (const url of [
    'https://pinit.go-gradually.me.evil.example/',
    'https://pinit.go-gradually.me:8443/',
    'https://pinit.go-gradually.me@evil.example/',
    'http://pinit.go-gradually.me/',
    'https://mono.pinit.go-gradually.me/',
    'about:blank',
  ])
    assert.equal(isSameOrigin(url, origin), false, url)
})
