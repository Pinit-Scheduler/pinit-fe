import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { hookRunner, settle } from './support/hooks.mjs'
import { errorMessage } from './support/errors.mjs'

const load = (path, dependencies = {}, globals = {}) => {
  const { outputText } = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name.endsWith('.css')) return {}
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
    console: { warn() {}, error() {} },
    ...globals,
  })
  return module.exports
}

/** A browser stand-in: window/document events and timers that run only when the test says so. */
const browser = () => {
  const window = new EventTarget()
  window.location = { pathname: '/app/today', search: '' }
  const document = new EventTarget()
  document.visibilityState = 'hidden'
  const timers = new Map()
  let nextId = 1
  return {
    window,
    document,
    timers,
    globals: {
      window,
      document,
      setTimeout: (fn, ms) => {
        const id = nextId++
        timers.set(id, { fn, ms })
        return id
      },
      clearTimeout: (id) => timers.delete(id),
    },
    /** Runs the pending retry timer and returns its delay. */
    fire() {
      const [[id, timer]] = [...timers]
      timers.delete(id)
      timer.fn()
      return timer.ms
    },
  }
}

const loadRestore = (env) =>
  load('src/features/auth/utils/sessionRestore.ts', { '@shared/api/errorMessage': errorMessage }, env.globals)

/** Values made in a vm context have other prototypes; compare their JSON shape. */
const plain = (value) => JSON.parse(JSON.stringify(value))

const transient = (status = 0, data = null) => ({ kind: 'transient', status, data })

test('retries back off 1s, 2s, 4s … and stop growing at 30s', () => {
  const { retryDelay } = loadRestore(browser())
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
})

test('a transient failure retries on the backoff, at once when online or visible, and stops on an answer', async () => {
  const env = browser()
  const { startSessionRestore } = loadRestore(env)
  const answers = [transient(), transient(502), transient(), transient(), { kind: 'refreshed', token: 't' }]
  let calls = 0
  const seen = []
  let refreshed = null
  startSessionRestore(async () => answers[calls++], {
    onRefreshed: (token) => (refreshed = token),
    onUnauthorized: () => assert.fail('a transient failure never ends the session'),
    onTransient: (failures) => seen.push(failures),
  })
  await settle()
  assert.equal(calls, 1)
  assert.equal(env.fire(), 1000)
  await settle()
  assert.equal(calls, 2)
  assert.deepEqual(seen, [1, 2])
  assert.equal([...env.timers.values()][0].ms, 2000)

  env.window.dispatchEvent(new Event('online'))
  await settle()
  assert.equal(calls, 3, 'coming back online retries without waiting')
  assert.equal(env.timers.size, 1, 'one retry is scheduled at a time')

  env.document.visibilityState = 'visible'
  env.document.dispatchEvent(new Event('visibilitychange'))
  await settle()
  assert.equal(calls, 4, 'returning to the page retries without waiting')

  env.window.dispatchEvent(new Event('focus'))
  await settle()
  assert.equal(calls, 5)
  assert.equal(refreshed, 't')
  assert.equal(env.timers.size, 0)
  env.window.dispatchEvent(new Event('online'))
  await settle()
  assert.equal(calls, 5, 'a restored session stops listening')
})

test('an unauthorized answer ends the restore once, and a rejected refresh counts as transient', async () => {
  const env = browser()
  const { startSessionRestore } = loadRestore(env)
  let ended = 0
  const failures = []
  let calls = 0
  startSessionRestore(
    async () => {
      calls += 1
      if (calls === 1) throw new Error('unexpected')
      return { kind: 'unauthorized' }
    },
    { onRefreshed: () => assert.fail(), onUnauthorized: () => ended++, onTransient: (n) => failures.push(n) },
  )
  await settle()
  assert.deepEqual(failures, [1])
  env.fire()
  await settle()
  assert.equal(ended, 1)
  assert.equal(env.timers.size, 0)
})

test('a stopped restore ignores the answer that was still on its way', async () => {
  const env = browser()
  const { startSessionRestore } = loadRestore(env)
  let resolve
  const restore = startSessionRestore(() => new Promise((done) => (resolve = done)), {
    onRefreshed: () => assert.fail(),
    onUnauthorized: () => assert.fail(),
    onTransient: () => assert.fail(),
  })
  restore.stop()
  resolve({ kind: 'unauthorized' })
  await settle()
  assert.equal(env.timers.size, 0)
})

test('the server message of a failed response is kept; no response keeps the fixed sentence', () => {
  const { transientMessage } = loadRestore(browser())
  assert.equal(transientMessage(transient(503, { message: '서버 점검 중이에요.' })), '서버 점검 중이에요.')
  assert.equal(transientMessage(transient(502, '<html>Bad Gateway</html>')), '')
  assert.equal(transientMessage(transient(0, new TypeError('Failed to fetch'))), '')
  assert.equal(transientMessage(transient(200, { message: 'ok' })), '')
})

// ---------------------------------------------------------------------------
// AuthGuard
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

const element = (type, props) => ({ type, props })
const AuthBoot = () => null
const Outlet = () => null

const authGuard = ({ token = null, refresh, fetchAccount = async () => ({ emailRequired: false }) }) => {
  const env = browser()
  const runner = hookRunner()
  const state = { token, cleared: 0, navigations: [], refreshCalls: 0 }
  // The data router's navigate keeps its identity across renders.
  const navigate = (to, options) => state.navigations.push(plain([to, options]))
  const authPaths = load('src/features/auth/utils/authPaths.ts')
  const Guard = load('src/features/auth/components/AuthGuard.tsx', {
    react: runner.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' },
    'react-router-dom': {
      Outlet,
      useNavigate: () => navigate,
      useLocation: () => ({ pathname: '/app/today', search: '' }),
    },
    '@shared/api/authSession': {
      refreshSession: async () => {
        state.refreshCalls += 1
        const result = await refresh(state.refreshCalls)
        if (result.kind === 'refreshed') state.token = result.token
        return result
      },
    },
    '@features/settings/api/account': { fetchAccount },
    '@shared/api/authTokens': {
      clearAuthTokens() {
        state.cleared += 1
        state.token = null
      },
      getAccessToken: () => state.token,
      isAccessTokenExpired: (value) => value.startsWith('expired'),
      isLoggedOut: () => false,
    },
    '@shared/api/httpClient': { ApiError },
    '../utils/returnTo': { rememberReturnTo() {} },
    '../utils/authEntry': load('src/features/auth/utils/authEntry.ts'),
    '../utils/emailRequirement': load('src/features/auth/utils/emailRequirement.ts', { './authPaths': authPaths }),
    '../utils/authPaths': authPaths,
    '../utils/currentTokenSubject': { currentTokenSubject: () => (state.token ? 'member-1' : null) },
    '../hooks/useNavigateAfterLogin': { default: () => () => {} },
    './AuthBoot': { default: AuthBoot },
    '../utils/sessionRestore': loadRestore(env),
  }, env.globals).default
  return { env, state, render: () => runner.render(() => Guard()) }
}

test('AuthGuard stays on the boot screen through transient refresh failures and never logs out', async () => {
  const guard = authGuard({ token: 'expired-1', refresh: async () => transient(502, '<html>Bad Gateway</html>') })
  assert.equal(guard.render().type, AuthBoot)
  await settle()
  let boot = guard.render()
  assert.equal(boot.type, AuthBoot)
  assert.equal(boot.props.retrying, false, 'one failure stays quiet')
  guard.env.fire()
  await settle()
  boot = guard.render()
  assert.equal(boot.props.retrying, true, 'repeated failures explain the retry')
  assert.equal(boot.props.message, '')
  assert.equal(guard.state.refreshCalls, 2)

  boot.props.onRetry()
  await settle()
  assert.equal(guard.state.refreshCalls, 3, 'the button tries again now')
  assert.deepEqual(guard.state.navigations, [])
  assert.equal(guard.state.cleared, 0)
  assert.equal(guard.state.token, 'expired-1')
})

test('AuthGuard renders the page once a retried refresh succeeds', async () => {
  const guard = authGuard({
    refresh: async (n) => (n < 3 ? transient() : { kind: 'refreshed', token: 'fresh-1' }),
  })
  guard.render()
  await settle()
  guard.env.fire()
  await settle()
  guard.env.fire()
  await settle()
  assert.equal(guard.render().type, Outlet)
  assert.deepEqual(guard.state.navigations, [])
})

test('AuthGuard clears tokens and goes to login when the refresh says the session ended', async () => {
  const guard = authGuard({ token: 'expired-1', refresh: async () => ({ kind: 'unauthorized' }) })
  guard.render()
  await settle()
  assert.deepEqual(guard.state.navigations, [['/login', { replace: true }]])
  assert.equal(guard.state.cleared, 1)
})

test('the account check logs out only on a 401, not on a network-type failure', async () => {
  for (const [status, loggedOut] of [[0, false], [401, true]]) {
    const guard = authGuard({
      token: 'valid-1',
      refresh: async () => assert.fail('a valid token needs no refresh'),
      fetchAccount: async () => {
        throw new ApiError('', status)
      },
    })
    assert.equal(guard.render().type, Outlet)
    await settle()
    guard.render()
    assert.equal(guard.state.cleared, loggedOut ? 1 : 0, `status ${status}`)
    assert.deepEqual(guard.state.navigations, loggedOut ? [['/login', { replace: true }]] : [], `status ${status}`)
  }
})

// ---------------------------------------------------------------------------
// LandingPage
// ---------------------------------------------------------------------------

const Navigate = () => null

const landing = ({ token = null, loggedOut = false, refresh = async () => ({ kind: 'unauthorized' }) }) => {
  const runner = hookRunner()
  const state = { navigations: [], refreshCalls: 0 }
  const navigate = (to, options) => state.navigations.push(plain([to, options]))
  const Page = load('src/features/landing/pages/LandingPage.tsx', {
    react: runner.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' },
    'react-router-dom': {
      Link: () => null,
      Navigate,
      useNavigate: () => navigate,
    },
    '@shared/api/authTokens': { getAccessToken: () => token, isLoggedOut: () => loggedOut },
    '@shared/api/authSession': {
      refreshSession: () => {
        state.refreshCalls += 1
        return refresh()
      },
    },
  }).default
  return { state, render: () => runner.render(() => Page()) }
}

test('the landing page shows at once and moves to the app when the refresh cookie restores a session', async () => {
  const page = landing({ refresh: async () => ({ kind: 'refreshed', token: 'fresh-1' }) })
  assert.equal(page.render().props.className, 'landing', 'the introduction paints while the refresh runs')
  await settle()
  assert.equal(page.state.refreshCalls, 1)
  assert.deepEqual(page.state.navigations, [['/app/schedules', { replace: true }]])
})

test('the landing page stays for visitors without a session or when the refresh gets no answer', async () => {
  for (const refresh of [async () => ({ kind: 'unauthorized' }), async () => transient(), async () => { throw new Error('x') }]) {
    const page = landing({ refresh })
    page.render()
    await settle()
    assert.equal(page.render().props.className, 'landing')
    assert.deepEqual(page.state.navigations, [])
  }
})

test('the landing page does not ask after a logout, and a stored token goes straight to the app', async () => {
  const afterLogout = landing({ loggedOut: true })
  afterLogout.render()
  await settle()
  assert.equal(afterLogout.state.refreshCalls, 0)

  const signedIn = landing({ token: 'a.b.c' })
  const first = signedIn.render()
  assert.equal(first.type, Navigate)
  assert.equal(first.props.to, '/app/schedules')
  await settle()
  assert.equal(signedIn.state.refreshCalls, 0)
})
