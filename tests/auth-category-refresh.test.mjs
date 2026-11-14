import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { errorMessage } from './support/errors.mjs'

const jwt = (generation = 0, subject = 'member-1', expired = false) =>
  'header.' +
  Buffer.from(
    JSON.stringify({
      sub: subject,
      generation,
      exp: Math.floor(Date.now() / 1000) + (expired ? -120 : 3600),
    }),
  ).toString('base64url') +
  '.test'
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const snapshot = {
  categories: [],
  taskAssignments: {},
  scheduleAssignments: {},
}
const unauthorized = () =>
  Response.json({ message: 'unauthorized' }, { status: 401 })
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}

// Keep the actual HTTP client, cookie refresh coordinator, token events and category
// store together. Only browser storage, network responses and React scheduling are
// replaced; earlier separate module mocks could not detect the auth event cycle.
const createHarness = (initialToken, respond) => {
  const values = new Map(
    initialToken ? [['pinit.accessToken', initialToken]] : [],
  )
  const window = new EventTarget()
  window.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  const calls = [],
    authStates = [],
    modules = new Map(),
    hooks = []
  let mounted = false,
    queued = false,
    hookIndex = 0
  const scheduleRender = () => {
    if (!mounted || queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      hookIndex = 0
      load('features/categories/store.ts').useCategories()
    })
  }
  const react = {
    useSyncExternalStore(subscribe, get) {
      const i = hookIndex++
      if (!hooks[i]) hooks[i] = { cleanup: subscribe(scheduleRender) }
      return get()
    },
    useEffect(effect, deps) {
      const i = hookIndex++,
        prev = hooks[i]
      if (
        prev &&
        prev.deps.length === deps.length &&
        deps.every((v, j) => Object.is(v, prev.deps[j]))
      )
        return
      hooks[i] = { deps }
      queueMicrotask(() => {
        prev?.cleanup?.()
        hooks[i].cleanup = effect()
      })
    },
  }
  const config = {
    API_BASE_URL: 'https://fixture.invalid/v2',
    AUTH_BASE_URL: 'https://fixture.invalid/v0',
    buildApiUrl: (path) => 'https://fixture.invalid/v2' + path,
    buildAuthUrl: (path) => 'https://fixture.invalid/v0' + path,
    buildUrl: (base, path) => base + path,
  }
  function load(path) {
    if (modules.has(path)) return modules.get(path)
    const source = readFileSync(
      new URL('../src/' + path, import.meta.url),
      'utf8',
    )
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText
    const module = { exports: {} }
    modules.set(path, module.exports)
    const require = (name) => {
      if (name === 'react') return react
      if (name === './config' || name === '@shared/api/config') return config
      if (name === './authTokens' || name === '@shared/api/authTokens')
        return load('shared/api/authTokens.ts')
      if (name === './authSession' || name === '@shared/api/authSession')
        return load('shared/api/authSession.ts')
      if (name === '@features/spaces/metadata')
        return load('features/spaces/metadata.ts')
      if (name === '@shared/api/httpClient')
        return load('shared/api/httpClient.ts')
      if (name === './httpClientHelpers') return { debugLog() {} }
      if (name === './errorMessage' || name === '@shared/api/errorMessage') return errorMessage
      if (name === '@shared/utils/sameData') return load('shared/utils/sameData.ts')
      if (name === '@shared/utils/events')
        return {
          onDataChanged: () => () => {},
          onTaskChanged: () => () => {},
          onScheduleChanged: () => () => {},
        }
      throw new Error('Unexpected dependency ' + name)
    }
    vm.runInNewContext(
      output,
      {
        module,
        exports: module.exports,
        require,
        window,
        Event,
        atob,
        queueMicrotask,
        fetch: async (url, init = {}) => {
          calls.push({
            path: new URL(url).pathname,
            token: init.headers?.Authorization?.slice(7) ?? null,
          })
          if (calls.length > 50) throw new Error('request loop safety cap')
          return respond(url, init)
        },
        console: { log() {}, warn() {}, error() {} },
      },
      { filename: path },
    )
    return module.exports
  }
  const tokens = load('shared/api/authTokens.ts')
  const client = load('shared/api/httpClient.ts')
  const session = load('shared/api/authSession.ts')
  const auth = load('features/auth/api/auth.ts')
  const categories = load('features/categories/store.ts')
  window.addEventListener('auth:changed', () =>
    authStates.push(tokens.getAccessToken()),
  )
  return {
    calls,
    authStates,
    tokens,
    client,
    session,
    auth,
    categories,
    window,
    mount() {
      mounted = true
      scheduleRender()
    },
    categoryState() {
      hookIndex = 0
      return categories.useCategories()
    },
  }
}

test('one rejected category token refreshes once without an anonymous auth/cache feedback loop', async () => {
  const old = jwt(),
    fresh = jwt(1)
  const h = createHarness(old, async (url, init) => {
    if (url.endsWith('/refresh')) return Response.json({ token: fresh })
    const token = init.headers?.Authorization
    // The delayed anonymous 401 was the feedback trigger in the incident replay.
    if (!token) {
      await flush()
      return unauthorized()
    }
    return token === 'Bearer ' + old ? unauthorized() : Response.json(snapshot)
  })
  h.mount()
  await flush()
  await flush()
  assert.equal(h.calls.filter((c) => c.path.endsWith('/refresh')).length, 1)
  assert.equal(
    h.calls.filter((c) => c.path.endsWith('/projects/snapshot')).length,
    2,
  )
  assert.equal(
    h.calls.filter((c) => c.path.endsWith('/projects/snapshot') && !c.token)
      .length,
    0,
  )
  assert.equal(h.authStates.includes(null), false)
  assert.equal(h.categoryState().hasLoaded, true)
  const settled = h.calls.length
  await flush()
  assert.equal(
    h.calls.length,
    settled,
    'requests stop after successful refresh',
  )
})

test('mounted consumers, focus and explicit category reload never fetch without authentication', async () => {
  const h = createHarness(null, async () => Response.json(snapshot))
  h.mount()
  await flush()
  h.window.dispatchEvent(new Event('focus'))
  await h.categories.reloadCategories()
  await flush()
  assert.equal(h.calls.length, 0)
  h.tokens.setAuthTokens({ accessToken: jwt() })
  await flush()
  assert.equal(h.calls.length, 1, 'real login loads the category snapshot')
})

test('expired-token HTTP bursts and the startup auth API share one refresh', async () => {
  const gate = deferred(),
    fresh = jwt(1),
    expired = jwt(0, 'member-1', true)
  const h = createHarness(expired, async (url) => {
    if (url.endsWith('/refresh')) {
      await gate.promise
      return Response.json({ token: fresh })
    }
    return Response.json({ ok: true })
  })
  const requests = Array.from({ length: 20 }, () =>
    h.client.httpClient('/tasks'),
  )
  const startup = h.auth.refreshAccessToken()
  await flush()
  assert.equal(h.calls.length, 1)
  assert.equal(
    h.tokens.getAccessToken(),
    expired,
    'refresh does not blank the existing session',
  )
  gate.resolve()
  await Promise.all([...requests, startup])
  assert.equal(h.calls.filter((c) => c.path.endsWith('/refresh')).length, 1)
  assert.ok(
    h.calls
      .filter((c) => c.path.endsWith('/tasks'))
      .every((c) => c.token === fresh),
  )
  assert.equal(h.authStates.includes(null), false)
})

test('concurrent server 401 responses share one refresh and each request retries only once', async () => {
  const old = jwt(),
    fresh = jwt(1),
    gate = deferred()
  const h = createHarness(old, async (url, init) => {
    if (url.endsWith('/refresh')) {
      await gate.promise
      return Response.json({ token: fresh })
    }
    return init.headers?.Authorization === 'Bearer ' + old
      ? unauthorized()
      : Response.json({ ok: true })
  })
  const requests = Array.from({ length: 20 }, () =>
    h.client.httpClient('/tasks'),
  )
  await flush()
  assert.equal(h.calls.filter((c) => c.path.endsWith('/refresh')).length, 1)
  gate.resolve()
  await Promise.all(requests)
  assert.equal(h.calls.filter((c) => c.path.endsWith('/refresh')).length, 1)
  assert.equal(h.calls.filter((c) => c.path.endsWith('/tasks')).length, 40)
  assert.equal(h.authStates.includes(null), false)
})

test('a delayed old-token 401 reuses the renewed token and does not start another refresh', async () => {
  const old = jwt(),
    fresh = jwt(1),
    late = deferred()
  let lateCalls = 0
  const h = createHarness(old, async (url, init) => {
    if (url.endsWith('/refresh')) return Response.json({ token: fresh })
    if (url.endsWith('/late') && ++lateCalls === 1) return late.promise
    return init.headers?.Authorization === 'Bearer ' + old
      ? unauthorized()
      : Response.json({ ok: true })
  })
  const waiting = h.client.httpClient('/late')
  await flush()
  await h.client.httpClient('/fast')
  late.resolve(unauthorized())
  await waiting
  assert.equal(h.calls.filter((c) => c.path.endsWith('/refresh')).length, 1)
  assert.equal(h.tokens.getAccessToken(), fresh)
  assert.equal(h.authStates.includes(null), false)
})

test('a persistent category 401 ends after one refresh and one retry, without guest requests', async () => {
  const h = createHarness(jwt(), async (url) =>
    url.endsWith('/refresh')
      ? Response.json({ token: jwt(1) })
      : unauthorized(),
  )
  h.mount()
  await flush()
  await flush()
  assert.equal(h.calls.filter((c) => c.path.endsWith('/refresh')).length, 1)
  assert.equal(
    h.calls.filter((c) => c.path.endsWith('/projects/snapshot')).length,
    2,
  )
  assert.ok(
    h.calls
      .filter((c) => c.path.endsWith('/projects/snapshot'))
      .every((c) => c.token),
  )
  assert.equal(h.tokens.getAccessToken(), null)
  const settled = h.calls.length
  h.window.dispatchEvent(new Event('focus'))
  await flush()
  assert.equal(h.calls.length, settled)
})

test('failed preflight refresh does not send the protected request anonymously', async () => {
  const expired = jwt(0, 'member-1', true)
  const h = createHarness(expired, async () => unauthorized())
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => h.client.httpClient('/tasks')),
  )
  assert.ok(
    results.every((r) => r.status === 'rejected' && r.reason.status === 401),
  )
  assert.equal(h.calls.length, 1)
  assert.equal(h.tokens.getAccessToken(), null)
})

test('logout during refresh cannot restore the previous session', async () => {
  const gate = deferred()
  const h = createHarness(jwt(0, 'member-1', true), async () => {
    await gate.promise
    return Response.json({ token: jwt(1) })
  })
  const pending = h.auth.refreshAccessToken()
  const rejected = assert.rejects(pending)
  await flush()
  h.tokens.markLoggedOut()
  h.tokens.clearAuthTokens()
  gate.resolve()
  await rejected
  assert.equal(h.tokens.getAccessToken(), null)
  assert.equal(h.tokens.isLoggedOut(), true)
})

test('late refresh and rejected requests cannot overwrite or retry with a different member login', async () => {
  const gate = deferred(),
    otherMember = jwt(1, 'member-2')
  const h = createHarness(jwt(), async (url) => {
    if (url.endsWith('/refresh')) {
      await gate.promise
      return Response.json({ token: jwt(1) })
    }
    return unauthorized()
  })
  const rejected = assert.rejects(
    h.client.httpClient('/tasks'),
    (error) => error.status === 401,
  )
  await flush()
  h.tokens.setAuthTokens({ accessToken: otherMember })
  gate.resolve()
  await rejected
  assert.equal(h.tokens.getAccessToken(), otherMember)
  assert.equal(h.calls.filter((c) => c.path.endsWith('/tasks')).length, 1)
})

// Only an answered 401/403 ends the session. Everything else is transient and keeps the token.
for (const [name, respond, expected] of [
  ['401', () => new Response(null, { status: 401 }), { kind: 'unauthorized' }],
  ['403', () => new Response(null, { status: 403 }), { kind: 'unauthorized' }],
  ['network error', () => { throw new TypeError('Failed to fetch') }, { kind: 'transient', status: 0 }],
  ['500', () => Response.json({ message: '잠시 후 다시 시도해 주세요.' }, { status: 500 }), { kind: 'transient', status: 500 }],
  ['502 page', () => new Response('<html>Bad Gateway</html>', { status: 502 }), { kind: 'transient', status: 502 }],
  ['429', () => new Response(null, { status: 429 }), { kind: 'transient', status: 429 }],
  ['ok without a token', () => Response.json({}), { kind: 'transient', status: 200 }],
  ['ok with a broken body', () => new Response('not json', { status: 200 }), { kind: 'transient', status: 200 }],
]) {
  test(`a ${name} refresh answer is ${expected.kind}`, async () => {
    const expired = jwt(0, 'member-1', true)
    const h = createHarness(expired, async (url) => {
      assert.ok(url.endsWith('/refresh'))
      return respond()
    })
    const result = await h.session.refreshSession()
    assert.equal(result.kind, expected.kind)
    if (expected.status !== undefined) assert.equal(result.status, expected.status)
    assert.equal(h.tokens.getAccessToken(), expired, 'the refresh itself never removes the token')
    if (expected.kind === 'transient')
      await assert.rejects(h.session.refreshAccessTokenFromCookie(), { name: 'RefreshUnavailableError' })
    else assert.equal(await h.session.refreshAccessTokenFromCookie(), null)
  })
}

test('a successful refresh stores and returns the new token', async () => {
  const fresh = jwt(1)
  const h = createHarness(jwt(0, 'member-1', true), async () => Response.json({ token: fresh }))
  assert.deepEqual({ ...(await h.session.refreshSession()) }, { kind: 'refreshed', token: fresh })
  assert.equal(h.tokens.getAccessToken(), fresh)
})

test('an unauthorized answer is remembered briefly, a transient one is asked again at once', async () => {
  let answer = () => new Response(null, { status: 401 })
  const h = createHarness(jwt(0, 'member-1', true), async () => answer())
  assert.equal((await h.session.refreshSession()).kind, 'unauthorized')
  assert.equal((await h.session.refreshSession()).kind, 'unauthorized')
  assert.equal(h.calls.length, 1, 'the cached 401 is reused within a second')

  const t = createHarness(jwt(0, 'member-1', true), async () => answer())
  answer = () => new Response(null, { status: 503 })
  assert.equal((await t.session.refreshSession()).kind, 'transient')
  answer = () => Response.json({ token: jwt(1) })
  assert.equal((await t.session.refreshSession()).kind, 'refreshed', 'a transient failure is never cached as a logout')
  assert.equal(t.calls.length, 2)
})

test('concurrent callers share one transient refresh and the HTTP requests fail as network errors', async () => {
  const gate = deferred(),
    expired = jwt(0, 'member-1', true)
  const h = createHarness(expired, async (url) => {
    if (url.endsWith('/refresh')) {
      await gate.promise
      return new Response('<html>Bad Gateway</html>', { status: 502 })
    }
    return Response.json({ ok: true })
  })
  const requests = Array.from({ length: 5 }, () => h.client.httpClient('/tasks'))
  const startup = h.session.refreshSession()
  await flush()
  gate.resolve()
  const results = await Promise.allSettled(requests)
  assert.ok(results.every((r) => r.status === 'rejected' && r.reason.status === 0))
  assert.equal((await startup).kind, 'transient')
  assert.equal(h.calls.filter((c) => c.path.endsWith('/refresh')).length, 1)
  assert.equal(h.calls.filter((c) => c.path.endsWith('/tasks')).length, 0)
  assert.equal(h.tokens.getAccessToken(), expired)
  assert.equal(h.authStates.includes(null), false)
})

test('a token removed elsewhere while a transient refresh waits counts as an ended session', async () => {
  const gate = deferred()
  const h = createHarness(jwt(0, 'member-1', true), async () => {
    await gate.promise
    return new Response(null, { status: 503 })
  })
  const pending = h.session.refreshSession()
  await flush()
  h.tokens.clearAuthTokens()
  gate.resolve()
  assert.equal((await pending).kind, 'unauthorized')
})
