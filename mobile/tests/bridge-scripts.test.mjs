import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { load } from './load.mjs'

const { bootScript, refreshReplyScript } = load('../src/bridge/scripts.ts')
const ORIGIN = 'https://pinit.go-gradually.me'

const page = (origin, stored = {}) => {
  const items = new Map(Object.entries(stored))
  const window = {
    location: { origin },
    localStorage: {
      getItem: (key) => (items.has(key) ? items.get(key) : null),
      setItem: (key, value) => items.set(key, String(value)),
      removeItem: (key) => items.delete(key),
    },
  }
  return { window, items, run: (script) => vm.runInNewContext(script, { window }) }
}

test('앱의 토큰을 웹 저장소에 넣고 로그아웃 표시를 지운다', () => {
  const { items, run } = page(ORIGIN, { 'pinit.accessToken': 'old', 'pinit.logoutMarker': '1' })
  run(bootScript('new-token', ORIGIN))
  assert.equal(items.get('pinit.accessToken'), 'new-token')
  assert.equal(items.has('pinit.logoutMarker'), false)
})

test('앱이 로그아웃 상태면 웹에 남은 토큰을 지운다', () => {
  const { items, run } = page(ORIGIN, { 'pinit.accessToken': 'someone-else' })
  run(bootScript(null, ORIGIN))
  assert.equal(items.has('pinit.accessToken'), false)
})

test('다른 사이트의 저장소에는 토큰을 넣지 않는다', () => {
  const { items, run } = page('https://evil.example')
  run(bootScript('secret', ORIGIN))
  assert.equal(items.size, 0)
})

test('토큰에 따옴표나 줄바꿈이 있어도 스크립트가 깨지지 않는다', () => {
  const token = `a"b'c\\d\n</script>`
  const { items, run } = page(ORIGIN)
  run(bootScript(token, ORIGIN))
  assert.equal(items.get('pinit.accessToken'), token)
})

test('저장소를 쓸 수 없어도 예외를 내지 않는다', () => {
  const window = { location: { origin: ORIGIN }, localStorage: { setItem: () => { throw new Error('denied') }, removeItem: () => {} } }
  assert.doesNotThrow(() => vm.runInNewContext(bootScript('t', ORIGIN), { window }))
})

test('갱신 결과를 웹이 등록한 함수로 돌려준다', () => {
  const { window, run } = page(ORIGIN)
  const received = []
  window.__pinitNativeReply = (reply) => received.push(reply)
  run(refreshReplyScript({ id: 'r1', kind: 'token', token: 't1' }, ORIGIN))
  run(refreshReplyScript({ id: 'r2', kind: 'unauthorized' }, ORIGIN))
  assert.deepEqual(JSON.parse(JSON.stringify(received)), [{ id: 'r1', kind: 'token', token: 't1' }, { id: 'r2', kind: 'unauthorized' }])
})

test('다른 사이트의 페이지에는 갱신 결과를 넘기지 않는다', () => {
  const { window, run } = page('https://evil.example')
  const received = []
  window.__pinitNativeReply = (reply) => received.push(reply)
  run(refreshReplyScript({ id: 'r1', kind: 'token', token: 't1' }, ORIGIN))
  assert.equal(received.length, 0)
})

test('웹이 함수를 등록하기 전이면 아무 일도 하지 않는다', () => {
  const { run } = page(ORIGIN)
  assert.doesNotThrow(() => run(refreshReplyScript({ id: 'r1', kind: 'transient' }, ORIGIN)))
})
