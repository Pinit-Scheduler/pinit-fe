import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const plain = (value) => JSON.parse(JSON.stringify(value))
function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(
    new URL('../src/' + path, import.meta.url),
    'utf8',
  )
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    console: { error() {} },
    require: (name) => {
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
    ...globals,
  })
  return module.exports
}
const config = { buildApiUrl: (path) => 'https://api.fixture/v2' + path }
const metadata = () => load('features/spaces/metadata.ts')
const task = (id = 1) => ({
  id,
  title: '서버 작업',
  description: '설명',
  completed: false,
  dueDate: { date: '2026-11-08', zoneId: 'Asia/Seoul' },
})
const view = (extra = {}) => ({
  task: task(),
  spaceId: -4,
  projectId: 13,
  assigneeId: null,
  assigneeNickname: null,
  version: 7,
  allowedActions: { edit: true, delete: false },
  ...extra,
})
function taskHarness() {
  const calls = [],
    registry = metadata()
  let response = view()
  const api = load('features/tasks/api/tasks.ts', {
    '@shared/api/config': config,
    '@shared/api/httpClient': {
      httpClient: async (url, options = {}) => {
        calls.push({ url, ...options })
        if (response instanceof Error) throw response
        if (typeof response === 'function') return response()
        return response
      },
    },
    '@shared/utils/datetime': { toApiDateTimeWithZone: (date) => date },
    '@features/spaces/store': {
      getSelectedScope: () => ({ spaceId: -4, projectId: 13 }),
    },
    '@features/spaces/metadata': registry,
  })
  return {
    api,
    calls,
    registry,
    respond: (next) => {
      response = next
    },
  }
}
test('workspace Task normalization preserves server permissions, negative space ID, explicit unassigned and version zero', async () => {
  const h = taskHarness()
  h.respond(view({ version: 0 }))
  const value = await h.api.fetchTaskDetail(1)
  assert.equal(value.spaceId, -4)
  assert.equal(value.assigneeId, null)
  assert.equal(value.version, 0)
  assert.equal(value.allowedActions.delete, false)
  assert.equal(h.registry.getMetadata('task', 1).version, 0)
})
test('Task create omits absent/undefined assignee and sends explicit null without inventing a default', async () => {
  const h = taskHarness()
  await h.api.createTask({ title: '기본', description: '설명' })
  assert.equal(Object.hasOwn(h.calls.at(-1).json, 'assignee'), false)
  await h.api.createTask({
    title: '기본',
    description: '설명',
    assigneeId: undefined,
  })
  assert.equal(Object.hasOwn(h.calls.at(-1).json, 'assignee'), false)
  await h.api.createTask({
    title: '미정',
    description: '설명',
    assigneeId: null,
    spaceId: 0,
    projectId: null,
  })
  assert.deepEqual(plain(h.calls.at(-1).json.assignee), { memberId: null })
  assert.deepEqual(plain(h.calls.at(-1).json.location), {
    spaceId: 0,
    projectId: null,
  })
})
test('Task edit keeps the form version even after realtime metadata becomes newer, and submits affiliation atomically', async () => {
  const h = taskHarness()
  await h.api.fetchTaskDetail(1)
  h.registry.rememberMetadata('task', 1, { ...view(), version: 11 })
  await h.api.updateTask(1, {
    title: '초안',
    expectedVersion: 7,
    spaceId: 22,
    projectId: null,
    assigneeId: null,
  })
  assert.equal(h.calls.length, 2)
  const saved = h.calls.at(-1)
  assert.equal(saved.method, 'PATCH')
  assert.equal(saved.json.expectedVersion, 7)
  assert.equal(saved.json.task.title, '초안')
  assert.deepEqual(plain(saved.json.location), { spaceId: 22, projectId: null })
  assert.deepEqual(plain(saved.json.assignee), { memberId: null })
})
test('Today requests all-space mine ready/due independently and retains server duplicate items', async () => {
  const h = taskHarness()
  h.respond({ content: [view()], last: true })
  const ready = await h.api.fetchTasks({
    readyOnly: true,
    mine: true,
    spaceId: null,
    projectId: null,
  })
  const due = await h.api.fetchTasksByDeadline('2026-11-08', 'Asia/Seoul')
  for (const call of h.calls) {
    const query = new URL(call.url).searchParams
    assert.equal(query.get('mine'), 'true')
    assert.equal(query.has('spaceId'), false)
    assert.equal(query.has('projectId'), false)
  }
  assert.equal(new URL(h.calls[0].url).searchParams.get('readyOnly'), 'true')
  assert.equal(new URL(h.calls[1].url).searchParams.get('date'), '2026-11-08')
  assert.equal(ready.content[0].id, due[0].id)
})
test('weekly schedules forward mine', async () => {
  const calls = []
  const require = createRequire(import.meta.url)
  const dayjs = require('dayjs')
  dayjs.extend(require('dayjs/plugin/isoWeek'))
  const api = load('features/schedules/api/schedules.ts', {
    dayjs: { default: dayjs },
    '@shared/api/config': config,
    '@shared/api/httpClient': {
      httpClient: async (url) => {
        calls.push(url)
        return []
      },
    },
    '@shared/utils/datetime': {
      toApiDateTimeWithZone: (time) => ({ dateTime: time, zoneId: 'UTC' }),
      toDisplayDayjs: (time) => dayjs(time),
      toDateFromApi: ({ dateTime }) => new Date(dateTime + 'Z'),
    },
    '@features/spaces/store': {
      getSelectedScope: () => ({ spaceId: 31, projectId: null }),
    },
    '@features/spaces/metadata': metadata(),
  })
  await api.fetchWeeklySchedules('2026-11-11T12:00:00', { mine: true })
  const mine = new URL(calls[0]).searchParams
  assert.equal(mine.get('mine'), 'true')
  assert.equal(mine.get('spaceId'), '31')
  await api.fetchWeeklySchedules('2026-11-11T12:00:00')
  const plainWeek = new URL(calls[1]).searchParams
  assert.equal(plainWeek.has('mine'), false)
  assert.equal(plainWeek.get('spaceId'), '31')
})
test('Invitation transport uses server-issued same-origin URL and marks token requests sensitive', async () => {
  const calls = []
  let issued = {
    token: 'a/b+secret',
    url: '/spaces/join/opaque',
    spaceId: 22,
    spaceName: '공간',
    expiresAt: '2026-11-08T12:00:00Z',
  }
  const api = load(
    'features/spaces/api.ts',
    {
      '@shared/api/config': config,
      '@shared/api/httpClient': {
        httpClient: async (url, options = {}) => {
          calls.push({ url, ...options })
          return issued
        },
      },
    },
    { window: { location: { origin: 'https://frontend.fixture' } } },
  )
  const invitation = await api.createInvitation(22)
  assert.equal(
    invitation.inviteUrl,
    'https://frontend.fixture/spaces/join/opaque',
  )
  await api.previewInvitation('a/b+secret')
  await api.acceptInvitation('a/b+secret')
  await api.revokeInvitation(22, 'a/b+secret')
  assert.ok(calls.every((call) => call.sensitiveRequest === true))
  assert.ok(calls.slice(1).every((call) => call.url.includes('a%2Fb%2Bsecret')))
  issued = { ...issued, url: 'https://untrusted.fixture/spaces/join/opaque' }
  await assert.rejects(api.createInvitation(22), /초대 링크/)
})
function realtimeHarness({
  respond,
  refresh = async () => 'new-token',
  current = () => 'old-token',
} = {}) {
  return load(
    'features/spaces/realtime.ts',
    {
      '@shared/api/config': config,
      '@shared/api/authTokens': {
        getAccessToken: current,
        getTokenSubject: (token) =>
          token.startsWith('other') ? 'other' : 'member',
        isAccessTokenExpired: () => false,
      },
      '@shared/api/authSession': { refreshAccessTokenFromCookie: refresh },
    },
    { fetch: respond },
  )
}
test('SSE parser handles CRLF split over chunks, heartbeat comments and multiline data', () => {
  const api = realtimeHarness(),
    events = []
  const parse = api.createEventParser((...args) => events.push(args))
  for (const chunk of [
    ': heartbeat\r',
    '\n\r\nevent: changed\r',
    '\ndata: {"spaceId":22,\r\ndata: "version":0}\r',
    '\n\r',
    '\n',
  ])
    parse(chunk)
  assert.deepEqual(plain(events), [['changed', '{"spaceId":22,\n"version":0}']])
})
test('SSE refreshes Bearer authentication once and emits authenticated committed changes', async () => {
  const controller = new AbortController(),
    calls = [],
    events = [],
    connections = []
  const api = realtimeHarness({
    respond: async (_url, init) => {
      calls.push(init)
      if (calls.length === 1) return new Response('', { status: 401 })
      return new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(
              new TextEncoder().encode(
                'event: changed\ndata: {"spaceId":22,"resourceType":"TASK","resourceId":1,"version":2,"action":"UPDATED"}\n\n',
              ),
            )
            stream.close()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })
  await api.subscribeToSpace(
    22,
    controller.signal,
    (event) => {
      if (event) {
        events.push(event)
        controller.abort()
      }
    },
    (value) => connections.push(value),
  )
  assert.equal(calls.length, 2)
  assert.equal(calls[0].headers.Authorization, 'Bearer old-token')
  assert.equal(calls[1].headers.Authorization, 'Bearer new-token')
  assert.equal(events[0].version, 2)
  assert.equal(connections[0], true)
})
test('SSE permission revocation invalidates once and does not reconnect or make anonymous requests', async () => {
  let calls = 0,
    invalidations = 0
  const api = realtimeHarness({
    respond: async (_url, init) => {
      calls++
      assert.match(init.headers.Authorization, /^Bearer /)
      return new Response('', { status: 403 })
    },
  })
  await api.subscribeToSpace(
    22,
    new AbortController().signal,
    () => invalidations++,
    () => {},
  )
  assert.equal(calls, 1)
  assert.equal(invalidations, 1)
})
test('SSE cancels an old actor response without publishing it to a new login', async () => {
  let token = 'old-token',
    cancelled = false
  const api = realtimeHarness({
    current: () => token,
    respond: async () => {
      token = 'other-token'
      return {
        status: 200,
        body: {
          cancel: async () => {
            cancelled = true
          },
        },
      }
    },
  })
  const events = []
  await api.subscribeToSpace(
    22,
    new AbortController().signal,
    (event) => events.push(event),
    () => {},
  )
  assert.equal(cancelled, true)
  assert.deepEqual(events, [])
})

test('HTTP 409 emits no global notice from httpClient and never retries or overwrites; sensitive invite secrets stay out of logs', async () => {
  const calls = [],
    logs = [],
    window = new EventTarget()
  let notices = 0
  window.addEventListener('workspace:edit-conflict', () => notices++)
  const secret = 'opaque-invitation-secret'
  const { httpClient, ApiError } = load(
    'shared/api/httpClient.ts',
    {
      './config': {
        API_BASE_URL: 'https://api.fixture/v2',
        AUTH_BASE_URL: 'https://api.fixture/v0',
        buildUrl: (base, path) => base + path,
      },
      './authTokens': {
        getAccessToken: () => 'token',
        getTokenSubject: () => 'member',
        isAccessTokenExpired: () => false,
      },
      './httpClientHelpers': { debugLog: (...args) => logs.push(args) },
      './authSession': {
        refreshAccessTokenFromCookie: async () => {
          throw new Error('Unexpected refresh')
        },
      },
      './errorMessage': { getApiErrorMessage: (data) => data.message },
    },
    {
      window,
      Event,
      console: { error: (...args) => logs.push(args) },
      fetch: async (url, options) => {
        calls.push({ url, options })
        return Response.json(
          {
            code: 'VERSION_CONFLICT',
            message: '다른 참여자가 먼저 수정했어요',
            submittedToken: secret,
          },
          { status: 409 },
        )
      },
    },
  )
  await assert.rejects(
    httpClient('/space-invitations/' + secret, {
      method: 'POST',
      json: { expectedVersion: 7, token: secret },
      sensitiveRequest: true,
      sensitiveResponse: true,
    }),
    (failure) =>
      failure instanceof ApiError &&
      failure.status === 409 &&
      !failure.url.includes(secret),
  )
  assert.equal(calls.length, 1)
  assert.equal(notices, 0)
  assert.equal(JSON.stringify(logs).includes(secret), false)
})
test('successful data returned for a previous account cannot enter the new account cache', async () => {
  let token = 'member-1'
  const { httpClient, ApiError } = load(
    'shared/api/httpClient.ts',
    {
      './config': {
        API_BASE_URL: 'https://api.fixture/v2',
        AUTH_BASE_URL: 'https://api.fixture/v0',
        buildUrl: (base, path) => base + path,
      },
      './authTokens': {
        getAccessToken: () => token,
        getTokenSubject: (value) => value,
        isAccessTokenExpired: () => false,
      },
      './httpClientHelpers': { debugLog() {} },
      './authSession': {},
      './errorMessage': {},
    },
    {
      window: new EventTarget(),
      Event,
      fetch: async () => {
        token = 'member-2'
        return Response.json({ task: 'private member-1 data' })
      },
    },
  )
  await assert.rejects(
    httpClient('/workspace/tasks/1'),
    (failure) => failure instanceof ApiError && failure.status === 401,
  )
  assert.equal(token, 'member-2')
})

test('Account changes while a response body is pending cannot publish private data or a stale conflict notice', async () => {
  for (const status of [200, 409]) {
    let token = 'member-1', release, bodyStarted, conflicts = 0
    const started = new Promise((resolve) => { bodyStarted = resolve })
    const window = new EventTarget(), logs = []
    window.addEventListener('workspace:edit-conflict', () => conflicts++)
    const { httpClient, ApiError } = load('shared/api/httpClient.ts', {
      './config': { API_BASE_URL: 'https://api.fixture/v2', AUTH_BASE_URL: 'https://api.fixture/v0', buildUrl: (base, path) => base + path },
      './authTokens': { getAccessToken: () => token, getTokenSubject: (value) => value, isAccessTokenExpired: () => false },
      './httpClientHelpers': { debugLog: (...args) => logs.push(args) },
      './authSession': {},
      './errorMessage': {},
    }, {
      window, Event,
      fetch: async () => ({
        status, ok: status === 200, headers: new Headers({ 'Content-Type': 'application/json' }),
        text: () => { bodyStarted(); return new Promise((resolve) => { release = resolve }) },
      }),
    })
    const pending = httpClient('/workspace/tasks/1')
    await started
    token = 'member-2'
    release(JSON.stringify({ code: 'VERSION_CONFLICT', task: 'private-member-one-data' }))
    await assert.rejects(pending, (failure) => failure instanceof ApiError && failure.status === 401)
    assert.equal(token, 'member-2')
    assert.equal(conflicts, 0)
    assert.equal(JSON.stringify(logs).includes('private-member-one-data'), false)
  }
})

test('Auth transports redact credentials without caller flags and preserve normal API responses and diagnostics', async () => {
  const secret = 'fixture-secret-must-not-be-logged'
  for (const path of [
    '/v0/login', '/v0/signup', '/v0/login/oauth2/code/naver?code=' + secret,
    '/v0/refresh', '/oauth/token', '/oauth/register', '/oauth/revoke', '/oauth/authorize/decision',
    '/workspace/tasks?q=/v0/login',
  ]) {
    for (const status of [200, 400]) {
      const logs = []
      const auth = !path.startsWith('/workspace/')
      const body = auth ? { token: secret, password: secret } : { title: 'ordinary-diagnostic' }
      const { httpClient } = load('shared/api/httpClient.ts', {
        './config': { API_BASE_URL: 'https://api.fixture', AUTH_BASE_URL: 'https://api.fixture/v0', buildUrl: (base, path) => base + path },
        './authTokens': { getAccessToken: () => null, getTokenSubject: () => null, isAccessTokenExpired: () => false },
        './httpClientHelpers': { debugLog: (...args) => logs.push(args) },
        './authSession': {}, './errorMessage': { getApiErrorMessage: () => 'server error' },
      }, {
        window: new EventTarget(), Event,
        console: { error: (...args) => logs.push(args) },
        fetch: async () => Response.json(body, { status }),
      })
      const request = httpClient(path, {
        method: 'POST', json: auth ? { username: 'local-fixture', password: secret } : body,
      })
      if (status === 200) assert.deepEqual(plain(await request), body)
      else await assert.rejects(request, (error) => error.status === 400 && JSON.stringify(error.data) === JSON.stringify(body))
      assert.equal(JSON.stringify(logs).includes(secret), false)
      if (!auth) assert.equal(JSON.stringify(logs).includes('ordinary-diagnostic'), true)
    }
  }
})
function invitationHarness({
  previewError,
  acceptError,
  result = { status: 'JOINED', spaceId: 22 },
} = {}) {
  let cursor = 0,
    pendingResolve
  const state = [],
    refs = [],
    effects = [],
    calls = [],
    navigations = [],
    selected = []
  const jsx = (type, props) => ({ type, props })
  class ApiError extends Error {
    constructor(status) {
      super('server error')
      this.status = status
    }
  }
  const Page = load('features/spaces/InvitationPage.tsx', {
    react: {
      useState(initial) {
        const index = cursor++
        if (!(index in state))
          state[index] = typeof initial === 'function' ? initial() : initial
        return [
          state[index],
          (value) => {
            state[index] =
              typeof value === 'function' ? value(state[index]) : value
          },
        ]
      },
      useRef(initial) {
        const index = cursor++
        return (refs[index] ??= { current: initial })
      },
      useEffect(effect) {
        if (!effects.length) effects.push(effect)
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'react-router-dom': {
      Link: 'a',
      useNavigate:
        () =>
        (...args) =>
          navigations.push(args),
      useParams: () => ({ token: 'opaque' }),
    },
    '@shared/api/httpClient': { ApiError },
    './api': {
      previewInvitation: async () => {
        if (previewError) throw new ApiError(previewError)
        return {
          spaceId: 22,
          spaceName: '공유 공간',
          nickname: '회원 닉네임',
          purpose: '함께 만들기',
          expiresAt: '2026-11-08T12:00:00Z',
          status: 'VALID',
        }
      },
      acceptInvitation: async () => {
        calls.push('accept')
        if (acceptError) throw new ApiError(acceptError)
        return new Promise((resolve) => {
          pendingResolve = () => resolve(result)
        })
      },
    },
    './store': {
      selectSpace: (id) => selected.push(id),
      reloadSpaces: async () => {
        throw new Error('follow-up GET failed')
      },
    },
    './spaces.css': {},
  }).default
  const render = () => {
    cursor = 0
    return Page()
  }
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null
    if (predicate(node)) return node
    const children = node.props?.children
    for (const child of Array.isArray(children) ? children : [children]) {
      const found = find(child, predicate)
      if (found) return found
    }
    return null
  }
  return {
    render,
    initialize: async () => {
      render()
      effects[0]()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    },
    find,
    calls,
    navigations,
    selected,
    resolve: () => pendingResolve(),
  }
}
test('Invitation acceptance locks duplicate clicks and does not repeat a committed join when the later list refresh fails', async () => {
  const h = invitationHarness()
  await h.initialize()
  const button = h.find(
    h.render(),
    (node) =>
      node.type === 'button' && node.props.className?.includes('--primary'),
  )
  assert.ok(button)
  button.props.onClick()
  button.props.onClick()
  assert.deepEqual(h.calls, ['accept'])
  h.resolve()
  for (let i = 0; i < 8; i++) await Promise.resolve()
  assert.deepEqual(h.calls, ['accept'])
  assert.deepEqual(h.selected, [22])
  assert.equal(h.navigations[0][0], '/app/tasks')
})
for (const stage of ['preview', 'accept'])
  test(`Invitation ${stage} honors server 410 for expired/revoked/deleted links and removes the join action`, async () => {
    const h = invitationHarness(
      stage === 'preview' ? { previewError: 410 } : { acceptError: 410 },
    )
    await h.initialize()
    if (stage === 'accept') {
      h.find(
        h.render(),
        (node) =>
          node.type === 'button' && node.props.className?.includes('--primary'),
      ).props.onClick()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    }
    const tree = h.render()
    assert.equal(
      h.find(
        tree,
        (node) =>
          node.type === 'button' && node.props.className?.includes('--primary'),
      ),
      null,
    )
    assert.ok(h.find(tree, (node) => node.props?.role === 'alert'))
    assert.deepEqual(h.navigations, [])
  })

test('Recurrence workspace API saves content and affiliation atomically with the captured series version and dry-run leaves the baseline intact', async () => {
  const calls = [],
    registry = metadata()
  const recurrence = {
    id: 4,
    mode: 'FLEXIBLE',
    title: '반복',
    description: '설명',
    rule: { freq: 'DAILY', interval: 1, startDate: '2026-11-09' },
    zoneId: 'Asia/Seoul',
  }
  let response = {
    recurrence,
    spaceId: -4,
    projectId: 13,
    assigneeId: null,
    assigneeNickname: null,
    version: 9,
    allowedActions: { edit: true },
  }
  const api = load('features/recurrence/api/recurrences.ts', {
    '@shared/api/config': config,
    '@shared/api/httpClient': {
      httpClient: async (url, options = {}) => {
        calls.push({ url, ...options })
        return response
      },
    },
    '@features/spaces/store': {
      getSelectedScope: () => ({ spaceId: -4, projectId: 13 }),
    },
    '@features/spaces/metadata': registry,
  })
  await api.createRecurrence({ ...recurrence, assigneeId: null })
  assert.equal(calls[0].url.endsWith('/workspace/recurrences'), true)
  assert.equal(calls[0].json.assignee.memberId, null)
  response = {
    ...response,
    version: 99,
    impact: {
      patched: 2,
      deleted: 0,
      created: 0,
      overwrittenIndividualEdits: 1,
    },
    previous: null,
  }
  const payload = {
    expectedVersion: 9,
    scope: 'FOLLOWING',
    fromDate: '2026-11-10',
    changes: { title: '초안' },
    spaceId: 22,
    projectId: null,
    assigneeId: null,
  }
  await api.updateRecurrence(4, payload, true)
  assert.equal(registry.getMetadata('series', 4).version, 9)
  assert.equal(calls.at(-1).json.expectedVersion, 9)
  assert.equal(calls.at(-1).json.recurrence.scope, 'FOLLOWING')
  assert.equal(calls.at(-1).json.recurrence.fromDate, '2026-11-10')
  assert.deepEqual(plain(calls.at(-1).json.location), {
    spaceId: 22,
    projectId: null,
  })
  response = { ...response, version: 10 }
  await api.updateRecurrence(4, payload, false)
  assert.equal(calls.at(-1).json.expectedVersion, 9)
  assert.equal(registry.getMetadata('series', 4).version, 10)
})
function spacesStoreHarness(respond) {
  let member = 'member-1'
  const storage = new Map(),
    registry = metadata()
  const store = load(
    'features/spaces/store.ts',
    {
      react: {
        useEffect() {},
        useMemo: (compute) => compute(),
        useState: (initial) => [initial, () => {}],
        useSyncExternalStore: (_subscribe, get) => get(),
      },
      '@shared/api/authTokens': {
        getAccessToken: () => member,
        getTokenSubject: (token) => token,
      },
      '@shared/utils/events': {
        dispatchTaskChanged() {},
        dispatchScheduleChanged() {},
        onDataChanged: () => () => {},
        onTaskChanged: () => () => {},
        onScheduleChanged: () => () => {},
      },
      './metadata': registry,
      './api': { fetchWorkspace: () => respond(member) },
    },
    {
      sessionStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    },
  )
  return {
    store,
    registry,
    member: (value) => {
      member = value
    },
  }
}
const snapshot = (memberId, ids) => ({
  memberId,
  nickname: `회원${memberId}`,
  defaultSpaceId: ids[0],
  spaces: ids.map((id) => ({
    id,
    name: String(id),
    members: [],
    allowedActions: {},
    personal: id < 0,
    deleted: false,
  })),
  projects: [],
  taskAssignments: {},
  scheduleAssignments: {},
})
test('Space selection preserves negative identifiers and lets the server snapshot reject zero without coercing it to null', async () => {
  const h = spacesStoreHarness(async () => snapshot(1, [-4]))
  h.store.selectSpace(0)
  assert.equal(h.store.getSelectedScope().spaceId, 0)
  await h.store.reloadSpaces()
  assert.equal(h.store.useSpaces().selectedSpaceId, -4)
  h.store.selectSpace(-4)
  await h.store.reloadSpaces()
  assert.equal(h.store.useSpaces().selectedSpaceId, -4)
})
test('A late previous-member snapshot and metadata cannot replace the current member workspace', async () => {
  let release
  const h = spacesStoreHarness((member) =>
    member === 'member-1'
      ? new Promise((resolve) => {
          release = resolve
        })
      : Promise.resolve(snapshot(2, [-8])),
  )
  const old = h.store.reloadSpaces()
  h.registry.rememberMetadata('task', 1, view())
  h.member('member-2')
  await h.store.reloadSpaces()
  release(snapshot(1, [-4]))
  await old
  assert.equal(h.store.useSpaces().memberId, 2)
  assert.equal(h.store.useSpaces().selectedSpaceId, -8)
  assert.equal(h.registry.getMetadata('task', 1), undefined)
})
test('A snapshot requested before a successful join cannot erase its new space selection; the queued refresh resolves it', async () => {
  let release,
    calls = 0
  const h = spacesStoreHarness(() =>
    ++calls === 1
      ? new Promise((resolve) => {
          release = resolve
        })
      : Promise.resolve(snapshot(1, [-4, 22])),
  )
  h.store.selectSpace(-4)
  const pending = h.store.reloadSpaces()
  h.store.selectSpace(22)
  void h.store.reloadSpaces()
  release(snapshot(1, [-4]))
  await pending
  for (let i = 0; i < 8; i++) await Promise.resolve()
  assert.equal(h.store.useSpaces().selectedSpaceId, 22)
  assert.equal(h.store.useSpaces().selectedSpace.id, 22)
})
test('Out-of-order realtime reads cannot lower the metadata version', () => {
  const registry = metadata()
  registry.rememberMetadata('task', 1, { ...view(), version: 11 })
  registry.rememberMetadata('task', 1, { ...view(), version: 7 })
  assert.equal(registry.getMetadata('task', 1).version, 11)
})

test('A moved-out Task evicts its linked active Schedule without removing access to the old space', () => {
  const window = new EventTarget()
  const registry = load('features/spaces/metadata.ts', {}, { window, CustomEvent })
  const providers = new Map()
  function provider(path, name) {
    const state = []
    let cursor = 0, mounted = false
    const react = {
      createContext: () => ({ Provider: 'provider' }),
      useState: (initial) => {
        const index = cursor++
        if (!(index in state)) state[index] = initial
        return [state[index], (next) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next
        }]
      },
      useEffect: (effect) => { if (!mounted) effect() },
      useMemo: (factory) => factory(),
      useCallback: (callback) => callback,
      useRef: (initial) => react.useState({ current: initial })[0],
    }
    const api = load(path, {
      react,
      'react/jsx-runtime': { jsx: (_type, props) => props },
      '@features/spaces/metadata': registry,
    }, { window })
    const render = () => {
      cursor = 0
      const value = api[name]({ children: null }).value
      mounted = true
      return value
    }
    providers.set(name, render)
    return render()
  }
  const tasks = provider('shared/contexts/TaskCacheContext.tsx', 'TaskCacheProvider')
  const schedules = provider('shared/contexts/ScheduleCacheContext.tsx', 'ScheduleCacheProvider')
  registry.rememberMetadata('task', 1, view({ spaceId: 22 }))
  registry.rememberMetadata('schedule', 8, { ...view({ spaceId: 22 }), linkedTaskId: 1 })
  registry.rememberMetadata('task', 2, view({ spaceId: 22 }))
  tasks.setTask({ id: 1, spaceId: 22, version: 7 })
  tasks.setTask({ id: 2, spaceId: 22, version: 7 })
  schedules.setSchedule({ id: 8, taskId: 1, spaceId: 22, version: 7 })
  schedules.setSchedule({ id: 8, taskId: 1, spaceId: 22, version: 9, state: 'COMPLETED' })
  schedules.setSchedule({ id: 8, taskId: 1, spaceId: 22, version: 8, state: 'IN_PROGRESS' })
  assert.equal(providers.get('ScheduleCacheProvider')().schedulesById[8].version, 9)
  assert.equal(providers.get('ScheduleCacheProvider')().schedulesById[8].state, 'COMPLETED')
  schedules.setActiveSchedule(8)
  assert.equal(providers.get('ScheduleCacheProvider')().activeScheduleId, 8)
  registry.evictWorkspaceResource('task', 1, true)
  assert.equal(providers.get('TaskCacheProvider')().tasksById[1], undefined)
  assert.equal(providers.get('TaskCacheProvider')().tasksById[2].id, 2)
  assert.equal(providers.get('ScheduleCacheProvider')().schedulesById[8], undefined)
  assert.equal(providers.get('ScheduleCacheProvider')().activeScheduleId, null)
  assert.equal(registry.getMetadata('task', 1), undefined)
  assert.equal(registry.getMetadata('schedule', 8), undefined)
  assert.equal(registry.isSpaceUnavailable(22), false)
  tasks.setTask({ id: 1, spaceId: 22, version: 8 })
  schedules.setSchedule({ id: 8, taskId: 1, spaceId: 22, version: 8 })
  assert.equal(providers.get('TaskCacheProvider')().tasksById[1], undefined)
  assert.equal(providers.get('ScheduleCacheProvider')().schedulesById[8], undefined)
})

test('An in-flight read or page cannot resurrect a removed resource; a new authorized read can restore the same version', async () => {
  const h = taskHarness()
  await h.api.fetchTaskDetail(1)
  let release
  h.respond(() => new Promise((resolve) => { release = resolve }))
  const oldRead = h.api.fetchTaskDetail(1)
  h.registry.evictWorkspaceResource('task', 1, true)
  release(view())
  await assert.rejects(oldRead, /접근 권한/)
  assert.equal(h.registry.getMetadata('task', 1), undefined)
  h.respond(view())
  assert.equal((await h.api.fetchTaskDetail(1)).version, 7)
  h.respond(() => new Promise((resolve) => { release = resolve }))
  const oldPage = h.api.fetchTasks({})
  h.registry.evictWorkspaceResource('task', 1, true)
  release({ content: [view()], last: true })
  assert.deepEqual(plain((await oldPage).content), [])
  assert.equal(h.registry.getMetadata('task', 1), undefined)
})

test('Account metadata reset rejects a previous account request even if its body was already authorized', async () => {
  const h = taskHarness()
  let release
  h.respond(() => new Promise((resolve) => { release = resolve }))
  const previousAccount = h.api.fetchTaskDetail(1)
  h.registry.clearWorkspaceMetadata()
  release(view())
  await assert.rejects(previousAccount, /접근 권한/)
  assert.equal(h.registry.getMetadata('task', 1), undefined)
  h.respond(view({ spaceId: -8, assigneeId: 2 }))
  assert.equal((await h.api.fetchTaskDetail(1)).spaceId, -8)
  const previousRevision = h.registry.getResourceRevision()
  h.registry.clearWorkspaceMetadata()
  h.registry.rememberMetadata('task', 1, view({ spaceId: -12, assigneeId: 3 }))
  h.registry.handleResourceReadError('task', 1, { status: 403 }, previousRevision)
  assert.equal(h.registry.getMetadata('task', 1).assigneeId, 3)
})

test('Resource read 403/404/410 evicts once, while transient network/503 failures preserve cache', async () => {
  for (const status of [undefined, 503, 403, 404, 410]) {
    const h = taskHarness()
    await h.api.fetchTaskDetail(1)
    const failure = Object.assign(new Error('read failed'), { status })
    h.respond(failure)
    await assert.rejects(h.api.fetchTaskDetail(1))
    assert.equal(h.registry.getMetadata('task', 1) === undefined, [403, 404, 410].includes(status))
    if ([403, 404, 410].includes(status)) {
      const revision = h.registry.getResourceRevision()
      await assert.rejects(h.api.fetchTaskDetail(1))
      assert.equal(h.registry.getResourceRevision(), revision)
    }
  }
})

test('Workspace realtime handles deleted, purged and moved-out Task/Schedule events without stale detail reads', () => {
  for (const action of ['DELETED', 'PURGED', 'MOVED_OUT']) {
    for (const resourceType of ['TASK', 'SCHEDULE']) {
      const registry = metadata()
      registry.rememberMetadata(resourceType.toLowerCase(), 1, view({ spaceId: 22 }))
      let changed, cleanup, reads = 0
      const Component = load('features/spaces/WorkspaceRealtime.tsx', {
        react: { useEffect: (effect) => { cleanup = effect() }, useState: () => [false, () => {}] },
        'react/jsx-runtime': { jsx: () => null },
        '@contexts/TaskCacheContext': { useTaskCache: () => ({ setTask() {} }) },
        '@contexts/ScheduleCacheContext': { useScheduleCache: () => ({ setSchedule() {} }) },
        '@features/tasks/api/tasks': { fetchTaskDetail: () => { reads++; return Promise.resolve(task()) } },
        '@features/schedules/api/schedules': { fetchScheduleDetail: () => { reads++; return Promise.resolve({ id: 1 }) } },
        './store': { useSpaces: () => ({ spaces: [{ id: 22 }], memberId: 4 }), workspaceChanged() {} },
        './realtime': { subscribeToWorkspace: (_signal, listener) => { changed = listener; return Promise.resolve() } },
        './metadata': registry,
        '@shared/utils/events': { takeLocalEcho: () => false },
      }).default
      Component()
      changed({ spaceId: 22, resourceId: 1, resourceType, action })
      assert.equal(registry.getMetadata(resourceType.toLowerCase(), 1), undefined)
      assert.equal(reads, 0)
      cleanup()
    }
  }
})

test('Schedule edit snapshot survives realtime events with its original version; normal detail still refreshes', async () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  for (const refreshOnChange of [false, true]) {
    const state = [], effects = [], listeners = new Set()
    const window = new EventTarget()
    let cursor = 0, requests = 0, response = { id: 8, title: '처음', version: 7 }
    const cacheSchedule = () => {}
    const react = {
      useState: (initial) => {
        const index = cursor++
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
        return [state[index], (next) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next
        }]
      },
      useEffect: (effect, deps) => {
        const index = cursor++
        const previous = effects[index]
        if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
          previous?.cleanup?.()
          effects[index] = { deps, cleanup: effect() }
        }
      },
    }
    const useDetail = load('features/schedules/hooks/useScheduleDetail.ts', {
      react,
      '@shared/utils/events': {
        onScheduleChanged: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
      '../api/schedules': { fetchScheduleDetail: async () => {
        requests++
        if (response instanceof Error) throw response
        return response
      } },
      '@contexts/ScheduleCacheContext': { useScheduleCache: () => ({ setSchedule: cacheSchedule }) },
    }, { window }).default
    const render = () => { cursor = 0; return useDetail('8', { refreshOnChange }) }
    render()
    await settle()
    assert.equal(render().schedule.version, 7)
    response = { ...response, title: '다른 사용자가 수정', version: 11 }
    for (const listener of listeners) listener({ scheduleId: 8 })
    const duringEvent = render()
    if (!refreshOnChange) {
      assert.equal(duringEvent.isLoading, false, 'editing must not unmount the form')
      assert.equal(duringEvent.schedule.title, '처음')
      assert.equal(duringEvent.schedule.version, 7)
      assert.equal(requests, 1)
      const verify = () => window.dispatchEvent(new CustomEvent('workspace:resources-evicted', {
        detail: { scheduleIds: [8] },
      }))
      verify()
      await settle()
      assert.equal(render().schedule.version, 7, 'authorized move must preserve edit snapshot')
      response = Object.assign(new Error('temporary outage'), { status: 503 })
      verify()
      await settle()
      assert.equal(render().schedule.version, 7, 'outage must preserve draft')
      response = Object.assign(new Error('not accessible'), { status: 404 })
      verify()
      await settle()
      assert.equal(render().schedule, null, 'server-confirmed lost access must stop editing')
      assert.match(render().error, /접근 권한/)
    } else {
      await settle()
      assert.equal(render().schedule.version, 11)
      assert.equal(requests, 2)
    }
    for (const effect of effects) effect?.cleanup?.()
  }
})

test('Task schedule assignment still writes the captured identity/version when detail refresh is unavailable', async () => {
  const calls = []
  const ScheduleModal = () => null
  const jsx = (type, props) => ({ type, props })
  const Page = load('features/tasks/components/TaskDetailModal.tsx', {
    react: { useEffect() {}, useState: (value) => [value, () => {}], useRef: (current) => ({ current }), useId: () => 'title' },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    '@shared/components/common/WorkspaceIcon': {},
    '@features/spaces/cardPath': { cardPath: () => null },
    '@features/spaces/SpacePath': { default: () => null },
    '@features/spaces/conflicts': { isEditConflict: () => false },
    '@shared/components/common/Modal': {},
    '@shared/routing/RouteSurface': { useRouteSurfaceNavigation: () => ({}) },
    '../api/tasks': { createScheduleFromTask: async (...args) => calls.push(args) },
    '@shared/utils/priorityStyles': {},
    './TaskScheduleModal': { default: ScheduleModal },
    '@contexts/TaskCacheContext': { useTaskCache: () => ({ tasksById: {}, setTask() {}, removeTask() {} }) },
    '@contexts/ToastContext': { useToast: () => ({ addToast() {} }) },
    '@shared/utils/events': { dispatchScheduleChanged() {} },
    '@shared/utils/deadlineStyles': {},
    '@shared/utils/datetime': {},
    '@shared/utils/isoDuration': {},
    './TaskDetailModal.css': {},
    '@features/recurrence/components/RecurrenceRuleFields.css': {},
    '@features/recurrence/components/RecurrenceScopeDialog': { useRecurrenceScope: () => ({ dialog: null }) },
    '@features/recurrence/utils/seriesMutations': {},
    '@features/trash': { useTrashUndo: () => ({}) },
    '@features/spaces/metadata': metadata(),
    '@features/spaces/store': { useSpaces: () => ({ spaces: [], projects: [] }) },
    '@features/spaces/UnavailableNote': { default: () => null },
    '@features/spaces/unavailable': { adminNames: () => [], unavailableLines: () => [] },
  }).default
  const find = (node) => {
    if (!node || typeof node !== 'object') return null
    if (node.type === ScheduleModal) return node
    const children = node.props?.children
    for (const child of Array.isArray(children) ? children : [children]) {
      const result = find(child)
      if (result) return result
    }
    return null
  }
  const modal = find(Page({ taskId: 42, onClose() {} }))
  const payload = { title: '입력한 일정', date: '2026-11-09T10:00:00', scheduleType: 'DEEP_WORK' }
  await modal.props.onSubmit(payload, 0)
  assert.deepEqual(plain(calls), [[42, payload, 0]])
  await assert.rejects(modal.props.onSubmit(payload), /입력한 내용은 유지/)
  assert.equal(calls.length, 1, 'missing version must not silently succeed or read a replacement version')
})

test('Shared trash restore uses the deleted row version and keeps the real dependency restoration result', async () => {
  const calls = [],
    registry = metadata()
  const api = load('features/trash/api/trash.ts', {
    '@shared/api/config': config,
    '@features/spaces/metadata': registry,
    '@shared/api/httpClient': {
      httpClient: async (url, options = {}) => {
        calls.push({ url, ...options })
        if (url.endsWith('/trash'))
          return {
            tasks: [
              {
                taskId: 1,
                spaceId: 22,
                version: 3,
                allowedActions: { restore: true },
              },
            ],
            schedules: [],
          }
        return {
          ...view({ version: 4 }),
          restoreResult: {
            taskId: 1,
            restoredScheduleIds: [5],
            relinkedScheduleIds: [],
            restoredDependencies: 1,
            skippedDependencies: 2,
          },
        }
      },
    },
  })
  const result = await api.restoreTask(1)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url.endsWith('/workspace/tasks/1/restore'), true)
  assert.deepEqual(plain(calls[1].json), { expectedVersion: 3 })
  assert.equal(result.skippedDependencies, 2)
  assert.equal(registry.getMetadata('task', 1).version, 4)
})
test('Trash restore and purge keep version zero and do not invent a missing restore result', async () => {
  const calls = [],
    registry = metadata()
  const api = load('features/trash/api/trash.ts', {
    '@shared/api/config': config,
    '@features/spaces/metadata': registry,
    '@shared/api/httpClient': {
      httpClient: async (url, options = {}) => {
        calls.push({ url, ...options })
        return view({ version: 1 })
      },
    },
  })
  assert.equal(await api.restoreTask(1, 0), null)
  await api.purgeTask(1, 0)
  assert.deepEqual(plain(calls[0].json), { expectedVersion: 0 })
  assert.equal(calls[1].method, 'DELETE')
  assert.equal(new URL(calls[1].url).searchParams.get('expectedVersion'), '0')
  assert.equal(calls.length, 2)
})
test('Undo cannot fall back to an unversioned legacy mutation when its deleted row is missing', async () => {
  const calls = []
  const api = load('features/trash/api/trash.ts', {
    '@shared/api/config': config,
    '@features/spaces/metadata': metadata(),
    '@shared/api/httpClient': {
      httpClient: async (url, options = {}) => {
        calls.push({ url, ...options })
        return { tasks: [], schedules: [] }
      },
    },
  })
  await assert.rejects(api.restoreTask(1), /최신 상태/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, undefined)
})

test('Multiplex workspace SSE uses one endpoint and carries changes from different spaces on that stream', async () => {
  const controller = new AbortController(),
    calls = [],
    events = []
  const api = realtimeHarness({
    respond: async (url, init) => {
      calls.push({ url, init })
      return new Response(
        new ReadableStream({
          start(stream) {
            for (const spaceId of [22, 23, 24, 25, 26, 27, 28, 29])
              stream.enqueue(
                new TextEncoder().encode(
                  `event: changed\ndata: {"spaceId":${spaceId},"resourceType":"TASK","resourceId":1,"version":2,"action":"UPDATED"}\n\n`,
                ),
              )
            stream.close()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })
  await api.subscribeToWorkspace(
    controller.signal,
    (event) => {
      if (event) {
        events.push(event)
        if (events.length === 8) controller.abort()
      }
    },
    () => {},
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.fixture/v2/workspace/events')
  assert.deepEqual(
    events.map((event) => event.spaceId),
    [22, 23, 24, 25, 26, 27, 28, 29],
  )
})
test('Server-confirmed lost membership evicts task/schedule/series metadata and blocks late responses until access returns', () => {
  const registry = metadata()
  registry.rememberMetadata('task', 1, view({ spaceId: 22 }))
  registry.rememberMetadata('schedule', 5, view({ spaceId: 22 }))
  registry.rememberMetadata('series', 4, view({ spaceId: 22 }))
  const removed = registry.syncAccessibleSpaces([-4], [-4, 22])
  assert.deepEqual(plain(removed), {
    spaceIds: [22],
    taskIds: [1],
    scheduleIds: [5],
  })
  assert.equal(registry.getMetadata('task', 1), undefined)
  assert.equal(registry.getMetadata('schedule', 5), undefined)
  assert.equal(registry.getMetadata('series', 4), undefined)
  registry.rememberMetadata('task', 1, view({ spaceId: 22, version: 99 }))
  assert.equal(registry.getMetadata('task', 1), undefined)
  registry.syncAccessibleSpaces([-4, 22], [-4])
  registry.rememberMetadata('task', 1, view({ spaceId: 22, version: 100 }))
  assert.equal(registry.getMetadata('task', 1).version, 100)
})

test('SSE reconnect resumes at Last-Event-ID and refreshes views only after the gap, not on the first connect', async () => {
  const controller = new AbortController(),
    calls = [],
    events = []
  let resyncs = 0
  const api = realtimeHarness({
    respond: async (url, init) => {
      calls.push({ url, init })
      const id = calls.length === 1 ? 40 : 41
      return new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(
              new TextEncoder().encode(
                `id: ${id}\nevent: changed\ndata: {"spaceId":22,"resourceType":"TASK","resourceId":1,"version":${id},"action":"UPDATED"}\n\n`,
              ),
            )
            stream.close()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })
  await api.subscribeToWorkspace(
    controller.signal,
    (event) => {
      if (!event) {
        resyncs++
        return
      }
      events.push(event.version)
      if (events.length === 2) controller.abort()
    },
    () => {},
  )
  assert.equal(calls.length, 2)
  assert.equal(calls[0].init.headers['Last-Event-ID'], undefined)
  assert.equal(calls[1].init.headers['Last-Event-ID'], '40')
  assert.deepEqual(events, [40, 41])
  assert.equal(resyncs, 1)
})
