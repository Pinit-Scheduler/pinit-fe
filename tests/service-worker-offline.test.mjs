import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// cache.js를 가짜 Cache Storage·fetch와 함께 불러온다. cached는 주소 → 응답 본문이다.
const loadCache = (cached) => {
  const response = (name, body = '') => ({ marker: name, clone: () => ({ text: async () => body }) })
  const scope = {
    location: { origin: 'https://pinit.go-gradually.me' },
    URL,
    caches: {
      match: async (request) => {
        const url = typeof request === 'string' ? request : new URL(request.url).pathname
        return url in cached ? response(url, cached[url]) : undefined
      },
      open: async () => ({ put: async () => {} }),
    },
    fetch: async () => {
      throw new TypeError('Failed to fetch')
    },
    Response: { error: () => ({ marker: 'network-error' }) },
  }
  scope.self = scope
  vm.createContext(scope)
  for (const file of ['sw/constants.js', 'sw/cache.js']) {
    vm.runInContext(readFileSync(join(publicDir, file), 'utf8'), scope, { filename: file })
  }
  const { cacheFirst } = scope.pinitSw.cache
  return { cacheFirst: async (request) => (await cacheFirst(request)).marker }
}

const SHELL = '<script type="module" crossorigin src="/assets/index-abc.js"></script><link rel="stylesheet" crossorigin href="/assets/index-def.css">'

const navigate = (path) => ({ url: `https://pinit.go-gradually.me${path}`, method: 'GET', mode: 'navigate' })

test('offline navigation to an uncached page gets the cached app shell when its assets are cached', async () => {
  const cache = loadCache({ '/index.html': SHELL, '/assets/index-abc.js': '', '/assets/index-def.css': '', '/offline.html': '' })
  assert.equal(await cache.cacheFirst(navigate('/app/statistics')), '/index.html')
})

test('a shell whose assets were never cached is skipped for the offline page instead of a blank screen', async () => {
  const cache = loadCache({ '/index.html': SHELL, '/assets/index-abc.js': '', '/offline.html': '' })
  assert.equal(await cache.cacheFirst(navigate('/app/today')), '/offline.html')
})

test('offline navigation falls back to the static offline page when the shell is missing', async () => {
  const cache = loadCache({ '/offline.html': '' })
  assert.equal(await cache.cacheFirst(navigate('/app/today')), '/offline.html')
})

test('an offline asset request that is not cached fails as a network error, not with the shell', async () => {
  const cache = loadCache({ '/index.html': SHELL })
  const asset = { url: 'https://pinit.go-gradually.me/assets/index-abc.js', method: 'GET', mode: 'no-cors' }
  assert.equal(await cache.cacheFirst(asset), 'network-error')
})

test('the offline page is precached', () => {
  const constants = readFileSync(join(publicDir, 'sw/constants.js'), 'utf8')
  assert.match(constants, /'\/offline\.html'/)
})
