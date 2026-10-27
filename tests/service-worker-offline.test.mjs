import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// cache.js를 가짜 Cache Storage·fetch와 함께 불러온다. cached는 주소 → 응답 표시 문자열이다.
const loadCache = (cached) => {
  const marker = (name) => ({ marker: name })
  const scope = {
    location: { origin: 'https://pinit.go-gradually.me' },
    URL,
    caches: {
      match: async (request) => {
        const url = typeof request === 'string' ? request : new URL(request.url).pathname
        return url in cached ? marker(cached[url]) : undefined
      },
      open: async () => ({ put: async () => {} }),
    },
    fetch: async () => {
      throw new TypeError('Failed to fetch')
    },
    Response: { error: () => marker('network-error') },
  }
  scope.self = scope
  vm.createContext(scope)
  for (const file of ['sw/constants.js', 'sw/cache.js']) {
    vm.runInContext(readFileSync(join(publicDir, file), 'utf8'), scope, { filename: file })
  }
  return scope.pinitSw.cache
}

const navigate = (path) => ({ url: `https://pinit.go-gradually.me${path}`, method: 'GET', mode: 'navigate' })

test('offline navigation to an uncached page gets the cached app shell', async () => {
  const cache = loadCache({ '/index.html': 'shell', '/offline.html': 'offline' })
  assert.deepEqual(await cache.cacheFirst(navigate('/app/statistics')), { marker: 'shell' })
})

test('offline navigation falls back to the static offline page when the shell is missing', async () => {
  const cache = loadCache({ '/offline.html': 'offline' })
  assert.deepEqual(await cache.cacheFirst(navigate('/app/today')), { marker: 'offline' })
})

test('an offline asset request that is not cached fails as a network error, not with the shell', async () => {
  const cache = loadCache({ '/index.html': 'shell' })
  const asset = { url: 'https://pinit.go-gradually.me/assets/index-abc.js', method: 'GET', mode: 'no-cors' }
  assert.deepEqual(await cache.cacheFirst(asset), { marker: 'network-error' })
})

test('the offline page is precached', () => {
  const constants = readFileSync(join(publicDir, 'sw/constants.js'), 'utf8')
  assert.match(constants, /'\/offline\.html'/)
})
