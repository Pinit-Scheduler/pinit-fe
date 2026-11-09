import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const { chromium } = await import(process.env.DEADLINE_RISK_PLAYWRIGHT_MODULE || 'playwright')

const base = process.env.DEADLINE_RISK_BASE_URL || 'http://127.0.0.1:4187'
const baseUrl = new URL(base)
assert.ok(baseUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(baseUrl.hostname), 'Use a local HTTP dev server only')
const output = resolve(process.env.DEADLINE_RISK_QA_DIR || '.cache/deadline-risk-browser')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles' })
await context.addInitScript(() => {
  localStorage.setItem('pinit.accessToken', `fixture.${btoa(JSON.stringify({ sub: '7' }))}.fixture`)
  sessionStorage.setItem('pinit.space.selection.7', '42')
})
const requests = [], errors = [], checks = []
let mode = 'populated'
let taskVersion = 1
const eventRoutes = []
let eventRequested
const eventReady = new Promise(resolve => { eventRequested = resolve })
const space = id => ({ id, name: id < 0 ? '개인 검증 공간' : '팀 검증 공간', purpose: '로컬 범위 검증', personal: id < 0, version: 1, allowedActions: {} })
const item = (taskId, status, extra = {}) => ({
  taskId, title: `브라우저 검증 작업 ${taskId}${taskId === 101 && taskVersion > 1 ? ' 실시간 갱신' : ''}`, deadline: '2026-11-14T15:00:00Z', status,
  requiredMinutes: 300, availableMinutes: 120, shortageMinutes: 180,
  predecessorTaskIds: [], reasons: ['이미 잡힌 일정과 생활 시간을 제외한 상한이에요.'],
  suggestedFinish: null, recurrenceSeriesId: null, ...extra,
})
const fixture = days => ({
  generatedAt: '2026-11-09T00:00:00Z', zoneId: 'Asia/Seoul', days,
  horizonEnd: days === 7 ? '2026-11-15T15:00:00Z' : '2026-11-22T15:00:00Z',
  calibrationApplied: true,
  assumptions: ['작업 하나는 나누지 않고 연속 실행한다고 가정해요.'],
  limitations: ['아직 생성되지 않은 반복 회차는 포함하지 않아요.'],
  items: mode === 'empty' ? [] : [
    item(101, 'SHORTAGE', { predecessorTaskIds: [201] }),
    item(102, 'AT_RISK', { requiredMinutes: 120, availableMinutes: 180, shortageMinutes: 0 }),
    item(103, 'FEASIBLE', { requiredMinutes: 60, availableMinutes: 180, shortageMinutes: 0, suggestedFinish: '2026-11-09T02:00:00Z' }),
    item(104, 'OVERDUE'),
    item(105, 'UNKNOWN', { recurrenceSeriesId: 5 }),
  ],
})
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url())
  if (url.origin === base && !/^\/v[02]\//.test(url.pathname)) return route.continue()
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient')
  requests.push({ method: req.method(), path: url.pathname, query: url.search })
  assert.equal(req.method(), 'GET', `Unexpected mutation ${req.method()} ${url.pathname}`)
  if (url.pathname === '/v2/workspace/events') {
    return new Promise(resolve => { eventRoutes.push({ route, resolve }); eventRequested() })
  }
  let body = null, status = 200
  if (url.pathname === '/v2/plans/deadline-risk') {
    if (mode === 'error') { status = 503; body = { message: 'local fixture failure' } }
    else body = fixture(Number(url.searchParams.get('days')))
  } else if (url.pathname === '/v2/spaces') body = { defaultSpaceId: -7, currentMember: { memberId: 7, nickname: '로컬 검증' }, spaces: [space(-7), space(42)] }
  else if (/^\/v2\/spaces\/-?\d+\/snapshot$/.test(url.pathname)) body = { space: space(Number(url.pathname.split('/')[3])), projects: [], members: [] }
  else if (url.pathname === '/v2/projects/snapshot') body = { projects: [], taskAssignments: {}, scheduleAssignments: {}, seriesAssignments: {} }
  else if (url.pathname === '/v2/members/settings') body = { zoneId: 'Asia/Seoul', dailyObjectiveWork: 'PT4H' }
  else if (url.pathname === '/v2/onboarding') body = { revision: 1, acknowledgedRevision: 1, pendingTour: [], features: [] }
  else if (/active|running|now-running|members\/now$/.test(url.pathname)) body = null
  else if (/^\/v2\/workspace\/tasks\/\d+$/.test(url.pathname)) body = {
    spaceId: -7, projectId: null, assigneeId: 7, assigneeNickname: '로컬 검증', version: taskVersion, allowedActions: {},
    task: { id: Number(url.pathname.split('/').at(-1)), title: `브라우저 검증 작업 101${taskVersion > 1 ? ' 실시간 갱신' : ''}`, description: '로컬 fixture',
    dueDate: { date: '2026-11-14', zoneId: 'Asia/Seoul', offset: '+09:00' },
    importance: 5, difficulty: 5, completed: false, previousTaskIds: [], nextTaskIds: [], tags: [],
    expectedDuration: 'PT5H', effectiveExpectedDuration: 'PT5H' },
  }
  else if (/categor/.test(url.pathname)) body = { categories: [], taskAssignments: {}, scheduleAssignments: {}, seriesAssignments: {} }
  else if (url.pathname === '/v2/plans') { status = 503; body = { message: 'plan API outside smoke scope' } }
  else if (/schedules/.test(url.pathname)) body = { content: [], items: [], totalPages: 0 }
  else { status = 404; body = { message: 'unconfigured local fixture' } }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true', 'Cache-Control': 'no-store' } })
})
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => {
  if (/Error handled by React Router|Uncaught|TypeError:|ReferenceError:/.test(message.text())) errors.push(message.text())
})
try {
  await page.goto(`${base}/app/deadline-risk`)
  await page.getByText('5개 작업 중', { exact: false }).waitFor()
  await page.getByRole('button', { name: /팀 검증 공간/ }).first().waitFor()
  assert.ok((await page.locator('.space-context').innerText()).includes('개인 스페이스 · 마감 위험 예보'))
  assert.ok(!(await page.locator('.space-context').innerText()).includes('로컬 범위 검증'))
  assert.equal(await page.evaluate(() => sessionStorage.getItem('pinit.space.selection.7')), '42')
  assert.ok(requests.filter(request => request.path === '/v2/plans/deadline-risk').every(request => !/spaceId|projectId/.test(request.query)))
  checks.push('team selection remains while personal-only forecast is read; forecast request has no team/project query')
  assert.match(await page.locator('.deadline-risk__basis').innerText(), /09:00/)
  assert.match(await page.locator('.deadline-risk__item').first().innerText(), /5시간/)
  assert.match(await page.locator('.deadline-risk__item').first().innerText(), /2시간/)
  assert.match(await page.locator('.deadline-risk__item').first().innerText(), /3시간/)
  checks.push('all five statuses, 5h/2h/3h shortage, server zone independent of browser zone')
  await page.getByText('계산에 사용한 가정과 한계', { exact: true }).click()
  await page.getByText('아직 생성되지 않은 반복 회차는 포함하지 않아요.', { exact: true }).waitFor()
  checks.push('assumptions and recurrence limitation expand')
  await page.getByRole('heading', { name: '마감 위험 예보', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/deadline-risk-desktop.png`, fullPage: true })
  await Promise.all([
    page.waitForResponse(response => response.url().includes('deadline-risk?days=14')),
    page.getByLabel('살펴볼 기간').selectOption('14'),
  ])
  await page.getByText('5개 작업 중', { exact: false }).waitFor()
  checks.push('14-day request and response rendered')
  await page.locator('.deadline-risk__item').first().getByRole('link', { name: '작업 상세 확인', exact: true }).click()
  await page.waitForURL('**/app/tasks/101')
  await page.getByRole('dialog').waitFor()
  await page.getByRole('dialog').getByRole('heading', { name: '브라우저 검증 작업 101', exact: true }).waitFor()
  await page.getByRole('dialog').getByText('로컬 fixture', { exact: true }).waitFor()
  assert.ok(requests.some(request => request.path === '/v2/workspace/tasks/101' && request.query === ''))
  assert.equal(await page.evaluate(() => sessionStorage.getItem('pinit.space.selection.7')), '42')
  await page.goBack()
  await page.waitForURL('**/app/deadline-risk')
  await page.getByText('5개 작업 중', { exact: false }).waitFor()
  checks.push('task detail surface opens and browser back returns to forecast')
  let eventTimer
  try {
    await Promise.race([
      eventReady,
      new Promise((_, reject) => { eventTimer = setTimeout(() => reject(new Error('Workspace SSE request did not start within 10 seconds')), 10_000) }),
    ])
  } finally { clearTimeout(eventTimer) }
  taskVersion = 2
  const nextForecast = page.waitForResponse(response => response.url().includes('/plans/deadline-risk'))
  const stream = eventRoutes.shift()
  await stream.route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'id: 1\nevent: changed\ndata: {"spaceId":-7,"resourceType":"TASK","resourceId":101,"version":2,"action":"UPDATED"}\n\n', headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true' } })
  stream.resolve()
  await nextForecast
  await page.locator('.deadline-risk__item').first().getByRole('heading', { name: '브라우저 검증 작업 101 실시간 갱신', exact: true }).waitFor()
  checks.push('workspace SSE change invalidates forecast while team scope remains selected')
  mode = 'error'
  await page.getByRole('button', { name: '다시 조회', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '마감 위험 예보를 불러오지 못했어요' }).waitFor()
  assert.equal(await page.locator('.deadline-risk__item').count(), 0)
  mode = 'empty'
  await page.getByRole('button', { name: '다시 조회', exact: true }).click()
  await page.getByRole('heading', { name: '기간 안에 확인할 마감 작업이 없어요' }).waitFor()
  checks.push('error hides stale data; retry renders empty state')
  mode = 'populated'
  await page.getByRole('button', { name: '다시 조회', exact: true }).click()
  await page.getByText('5개 작업 중', { exact: false }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${output}/deadline-risk-mobile.png`, fullPage: true })
  await page.locator('.deadline-risk__item').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/deadline-risk-mobile-item.png`, fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  assert.equal(overflow, false)
  checks.push('390px mobile has no horizontal overflow')
  const personalPlanRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/v2/plans')
  await page.getByRole('button', { name: '개인 스페이스에서 하루 계획 열기', exact: true }).click()
  await page.waitForURL('**/app/plan')
  const planQuery = new URL((await personalPlanRequest).url()).searchParams
  assert.equal(await page.evaluate(() => sessionStorage.getItem('pinit.space.selection.7')), '-7')
  assert.equal(planQuery.get('spaceId'), '-7')
  assert.equal(planQuery.has('projectId'), false)
  await page.getByRole('link', { name: '마감 전에 시간이 충분한지 예보 보기', exact: true }).click()
  await page.waitForURL('**/app/deadline-risk')
  await page.getByText('5개 작업 중', { exact: false }).waitFor()
  assert.equal(errors.length, 0, JSON.stringify(errors))
  checks.push('explicit personal plan click clears team/project scope before plan request; zero uncaught browser errors; GET-only local requests')
  const result = { checks, requests, errors, scope: 'Local headless Chrome with intercepted synthetic API only; no real backend or DB or production requests.' }
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.log(JSON.stringify({ url: page.url(), text: await page.locator('body').innerText(), requests, errors }, null, 2))
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true })
  throw error
} finally {
  for (const stream of eventRoutes) { await stream.route.abort().catch(() => {}); stream.resolve() }
  await browser.close()
}
