import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// 배포 시 이전 shell/asset 캐시를 정리한다. sw.js가 불러오는 constants.js 주소의 버전도
// CACHE_NAME과 같이 바뀌어야 새 sw.js로 인식된다.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('sw.js loads constants.js with the same cache version as CACHE_NAME', () => {
  const cacheName = read('../public/sw/constants.js').match(/CACHE_NAME:\s*'([^']+)'/)?.[1]
  const imported = read('../public/sw.js').match(/\/sw\/constants\.js\?cache=([^'"]+)/)?.[1]
  assert.ok(cacheName, 'CACHE_NAME not found')
  assert.equal(imported, cacheName)
})
