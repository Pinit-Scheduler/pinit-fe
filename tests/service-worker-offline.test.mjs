import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ORIGIN = 'https://pinit.go-gradually.me'
const SHELL = '<script type="module" crossorigin src="/assets/index-abc.js"></script><link rel="stylesheet" crossorigin href="/assets/index-def.css">'
const NEW_SHELL = '<script type="module" crossorigin src="/assets/index-new.js"></script><link rel="stylesheet" crossorigin href="/assets/index-new.css">'
const OFFLINE = '<h1>인터넷에 연결되어 있지 않아요</h1>'
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
const navigate = (path) => ({ url: `${ORIGIN}${path}`, method: 'GET', mode: 'navigate' })
const asset = (path) => ({ url: `${ORIGIN}${path}`, method: 'GET', mode: 'no-cors' })
const usableShell = () => ({
  '/index.html': SHELL,
  '/assets/index-abc.js': '',
  '/assets/index-def.css': '',
  '/offline.html': OFFLINE,
})

// 실제 sw.js의 fetch/install 핸들러를 실행한다. Cache Storage만 메모리로 대체하고,
// 표준 Response를 사용해 clone/body/ok 및 캐시 갱신까지 검증한다.
const loadWorker = ({ cached = {}, fetchResponse, failCacheWrite = false } = {}) => {
  const keyOf = (request) => {
    const url = new URL(typeof request === 'string' ? request : request.url, ORIGIN)
    return url.pathname + url.search
  }
  const entries = new Map(Object.entries(cached).map(([path, response]) => [path, response instanceof Response ? response : html(response)]))
  const handlers = new Map()
  const fetches = []
  const writes = []
  const scope = {
    location: { origin: ORIGIN },
    URL,
    Response,
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: async () => {},
    caches: {
      match: async (request) => entries.get(keyOf(request))?.clone(),
      open: async (name) => ({
        put: async (request, response) => {
          if (failCacheWrite) throw new Error('Quota exceeded')
          writes.push({ cache: name, path: keyOf(request), status: response.status })
          entries.set(keyOf(request), response.clone())
        },
        addAll: async (urls) => {
          for (const url of urls) entries.set(keyOf(url), html(url === '/offline.html' ? OFFLINE : 'precache'))
        },
      }),
    },
    fetch: async (request) => {
      fetches.push(request.url)
      if (fetchResponse) return fetchResponse(request)
      throw new TypeError('Failed to fetch')
    },
  }
  scope.self = scope
  vm.createContext(scope)
  scope.importScripts = (...urls) => {
    for (const url of urls) {
      const path = url.split('?')[0]
      vm.runInContext(readFileSync(join(publicDir, path.slice(1)), 'utf8'), scope, { filename: path })
    }
  }
  vm.runInContext(readFileSync(join(publicDir, 'sw.js'), 'utf8'), scope, { filename: 'sw.js' })
  return {
    fetches,
    writes,
    cachedText: async (path) => entries.get(path)?.clone().text(),
    respond: async (request) => {
      let response
      handlers.get('fetch')({ request, respondWith: (pending) => { response = pending } })
      return response
    },
    install: async () => {
      let pending
      handlers.get('install')({ waitUntil: (promise) => { pending = promise } })
      await pending
    },
    cacheName: scope.pinitSw.constants.CACHE_NAME,
  }
}

test('explicit no-store forecasts bypass old same-origin SW cache entries entirely', async () => {
  const path = '/v2/plans/deadline-risk?days=7'
  const worker = loadWorker({ cached: { [path]: 'outdated forecast' } })
  const result = await worker.respond({ ...asset(path), cache: 'no-store' })
  assert.equal(result, undefined, 'browser network handles request, worker supplies no cached fallback')
  assert.equal(worker.fetches.length, 0)
  assert.equal(worker.writes.length, 0)
})

test('online navigation bypasses old route HTML and updates the canonical shell for later offline deep links', async () => {
  let online = true
  const worker = loadWorker({
    cached: { ...usableShell(), '/app/today': SHELL },
    fetchResponse: async (request) => {
      if (!online) throw new TypeError('Failed to fetch')
      return request.mode === 'navigate' ? html(NEW_SHELL) : new Response('new build asset')
    },
  })

  assert.equal(await (await worker.respond(navigate('/app/today'))).text(), NEW_SHELL)
  assert.equal(worker.fetches.length, 1)
  assert.equal(await worker.cachedText('/app/today'), NEW_SHELL)
  assert.equal(await worker.cachedText('/index.html'), NEW_SHELL)
  assert.ok(worker.writes.every((write) => write.cache === worker.cacheName && write.status === 200))

  await worker.respond(asset('/assets/index-new.js'))
  await worker.respond(asset('/assets/index-new.css'))
  online = false
  assert.equal(await (await worker.respond(navigate('/app/tasks/123'))).text(), NEW_SHELL)
})

test('offline navigation to an uncached page uses a cached shell whose assets are available', async () => {
  const worker = loadWorker({ cached: usableShell() })
  assert.equal(await (await worker.respond(navigate('/app/statistics'))).text(), SHELL)
  assert.equal(worker.fetches.length, 1, 'navigation tries the network before falling back')
})

test('a shell whose assets were never cached is skipped for the offline page instead of a blank screen', async () => {
  const worker = loadWorker({ cached: { '/index.html': SHELL, '/assets/index-abc.js': '', '/offline.html': OFFLINE } })
  assert.equal(await (await worker.respond(navigate('/app/today'))).text(), OFFLINE)
})

test('a cached failed asset response does not make a shell usable', async () => {
  const worker = loadWorker({ cached: { ...usableShell(), '/assets/index-def.css': new Response('missing', { status: 404 }) } })
  assert.equal(await (await worker.respond(navigate('/app/today'))).text(), OFFLINE)
})

test('offline navigation falls back to the static offline page when the shell is missing or failed', async () => {
  for (const cached of [
    { '/offline.html': OFFLINE },
    { '/index.html': html('server failure', 500), '/offline.html': OFFLINE },
  ]) {
    const worker = loadWorker({ cached })
    assert.equal(await (await worker.respond(navigate('/app/today'))).text(), OFFLINE)
  }
})

test('a failed navigation response is not cached and preserves the previous usable shell', async () => {
  for (const status of [404, 503]) {
    const worker = loadWorker({ cached: { ...usableShell(), '/app/today': SHELL }, fetchResponse: async () => html('server failure', status) })
    assert.equal(await (await worker.respond(navigate('/app/today'))).text(), SHELL)
    assert.equal(await worker.cachedText('/index.html'), SHELL)
    assert.equal(await worker.cachedText('/app/today'), SHELL)
    assert.equal(worker.writes.length, 0)
  }
})

test('a failed navigation response uses the offline page when no shell is usable', async () => {
  const worker = loadWorker({ cached: { '/offline.html': OFFLINE }, fetchResponse: async () => html('unavailable', 503) })
  assert.equal(await (await worker.respond(navigate('/app/today'))).text(), OFFLINE)
  assert.equal(worker.writes.length, 0)
})

test('a successful non-HTML navigation response is returned without replacing the shell', async () => {
  const worker = loadWorker({ cached: usableShell(), fetchResponse: async () => new Response('plain response') })
  assert.equal(await (await worker.respond(navigate('/download'))).text(), 'plain response')
  assert.equal(await worker.cachedText('/index.html'), SHELL)
  assert.equal(worker.writes.length, 0)
})

test('manual navigation redirects pass through without replacing or falling back to the shell', async () => {
  // Node cannot construct the browser-only opaque redirect type directly.
  const redirect = Object.defineProperty(Response.error(), 'type', { value: 'opaqueredirect' })
  const worker = loadWorker({ cached: usableShell(), fetchResponse: async () => redirect })
  assert.equal(await worker.respond(navigate('/redirect')), redirect)
  assert.equal(await worker.cachedText('/index.html'), SHELL)
  assert.equal(worker.writes.length, 0)
})

test('online static HTML documents never replace the app shell for offline deep links', async () => {
  for (const path of ['/offline.html', '/static-document.html', '/index.html']) {
    let online = true
    const worker = loadWorker({ cached: usableShell(), fetchResponse: async () => {
      if (!online) throw new TypeError('Failed to fetch')
      return html(OFFLINE)
    } })
    assert.equal(await (await worker.respond(navigate(path))).text(), OFFLINE)
    assert.equal(await worker.cachedText('/index.html'), SHELL)
    online = false
    assert.equal(await (await worker.respond(navigate('/app/tasks/123'))).text(), SHELL)
  }
})

test('a static HTML document without app assets is not a usable offline app shell', async () => {
  const worker = loadWorker({ cached: { '/index.html': '<h1>Static document</h1>', '/offline.html': OFFLINE } })
  assert.equal(await (await worker.respond(navigate('/app/today'))).text(), OFFLINE)
})

test('a cache write failure does not hide a successful online navigation', async () => {
  const worker = loadWorker({ cached: usableShell(), failCacheWrite: true, fetchResponse: async () => html(NEW_SHELL) })
  assert.equal(await (await worker.respond(navigate('/app/today'))).text(), NEW_SHELL)
  assert.equal(await worker.cachedText('/index.html'), SHELL)
})

test('hashed build assets remain cache-first and successful misses are cached', async () => {
  const worker = loadWorker({ cached: { '/assets/index-abc.js': 'cached build asset' }, fetchResponse: async () => new Response('fetched build asset') })
  assert.equal(await (await worker.respond(asset('/assets/index-abc.js'))).text(), 'cached build asset')
  assert.equal(worker.fetches.length, 0)
  assert.equal(await (await worker.respond(asset('/assets/index-new.js'))).text(), 'fetched build asset')
  assert.equal(await worker.cachedText('/assets/index-new.js'), 'fetched build asset')
  assert.equal(await (await worker.respond(asset('/assets/index-new.js'))).text(), 'fetched build asset')
  assert.equal(worker.fetches.length, 1)
})

test('failed asset responses are returned to the caller and never cached', async () => {
  const worker = loadWorker({ fetchResponse: async () => new Response('missing', { status: 404 }) })
  for (let index = 0; index < 2; index += 1) {
    assert.equal((await worker.respond(asset('/assets/missing.js'))).status, 404)
  }
  assert.equal(worker.fetches.length, 2)
  assert.equal(worker.writes.length, 0)
})

test('an uncached offline asset fails as a network error without receiving shell HTML', async () => {
  const worker = loadWorker({ cached: usableShell() })
  assert.equal((await worker.respond(asset('/assets/missing.js'))).type, 'error')
})

test('offline navigation with no successful fallback returns a network error', async () => {
  const worker = loadWorker({ cached: { '/offline.html': html('missing', 404) } })
  assert.equal((await worker.respond(navigate('/app/today'))).type, 'error')
})

test('install precaches a standalone offline page that can serve navigation', async () => {
  const worker = loadWorker()
  await worker.install()
  assert.equal(await worker.cachedText('/offline.html'), OFFLINE)
  // A real preloaded index references uncached assets, so emulate that state.
  const freshWorker = loadWorker({ cached: { '/index.html': SHELL, '/offline.html': await worker.cachedText('/offline.html') } })
  assert.equal(await (await freshWorker.respond(navigate('/app/today'))).text(), OFFLINE)
})
