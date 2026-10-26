import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// 서비스 워커는 같은 출처 GET을 cache-first로 준다. 배포한 화면이 사용자에게 가려면 CACHE_NAME을 올려야 하고,
// sw.js가 불러오는 constants.js 주소의 버전도 같이 바뀌어야 새 sw.js로 인식된다.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('sw.js loads constants.js with the same cache version as CACHE_NAME', () => {
  const cacheName = read('../public/sw/constants.js').match(/CACHE_NAME:\s*'([^']+)'/)?.[1]
  const imported = read('../public/sw.js').match(/\/sw\/constants\.js\?cache=([^'"]+)/)?.[1]
  assert.ok(cacheName, 'CACHE_NAME not found')
  assert.equal(imported, cacheName)
})
