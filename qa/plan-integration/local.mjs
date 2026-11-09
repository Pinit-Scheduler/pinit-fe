import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Combined FE interaction check only. Every API response is synthetic; no upstream exists.
const origin = 'http://127.0.0.1:5194'
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, '.cache/deadline-risk-browser-combined')
const qaRequire = createRequire(new URL('../browser/package.json', import.meta.url))
const { chromium } = qaRequire('playwright')
const now = '2026-11-09T00:00:00Z'
const date = '2026-11-09'
const project = { id: 99, spaceId: 42, name: '결합 검증 프로젝트', outcome: null, completed: false, version: 1, allowedActions: {} }
const space = (id) => ({ id, name: id < 0 ? '개인 검증 공간' : `팀 ${id === 42 ? 'A' : 'B'} 검증 공간`, personal: id < 0,
  purpose: id < 0 ? '개인 목적' : '팀 목적', version: 1, deleted: false, allowedActions: {},
  members: [{ memberId: 7, nickname: '합성 회원', role: id < 0 ? 'ADMIN' : 'MEMBER' }] })
const scheduleId = (id) => id < 0 ? 701 : id * 100 + 1
const title = (id) => id < 0 ? '개인 재계획 일정' : `팀 ${id === 42 ? 'A' : 'B'} 재계획 일정`
for (const name of ['VITE_API_BASE_URL', 'VITE_AUTH_BASE_URL', 'VITE_NOTIFICATION_API_BASE_URL']) process.env[name] = origin
process.env.VITE_USE_MOCK_API = 'false'
// Development mode intentionally has no production SW registration. A missed
// fixture cannot reach a backend even if the project's Vite config has a proxy.
const server = await createServer({ root, clearScreen: false,
  server: { host: '127.0.0.1', port: 5194, strictPort: true },
  plugins: [{ name: 'deny-unintercepted-test-api', configureServer(vite) {
    vite.middlewares.use((request, response, next) => {
      if (!/^\/v[02]\//.test(new URL(request.url, origin).pathname)) return next()
      response.statusCode = 404
      response.end('API requests must be intercepted by the synthetic fixture')
    })
  } }],
})
await server.listen()
const calls = [], errors = [], escaped = [], unexpected = [], checks = [], streams = []
let applied = false
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' })
  context.setDefaultTimeout(12_000)
  context.setDefaultNavigationTimeout(15_000)
  await context.addInitScript(() => {
    localStorage.setItem('pinit.accessToken', `${btoa('{}')}.${btoa(JSON.stringify({ sub: '7', exp: 2_100_000_000 }))}.synthetic-fixture`)
    sessionStorage.setItem('pinit.space.selection.7', '42')
    localStorage.setItem('pinit.pwa.installBannerDismissed', '1')
  })
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) { escaped.push(url.origin); return route.abort() }
    if (!/^\/v[02]\//.test(url.pathname)) return route.continue()
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Cache-Control': 'no-store' } })
    const call = { method: request.method(), path: url.pathname }
    if (url.pathname === '/v2/plans/replan' || url.pathname === '/v2/plans/replan/apply') {
      assert.equal(request.method(), 'POST')
      const payload = request.postDataJSON()
      Object.assign(call, { spaceId: payload.spaceId, projectId: payload.projectId, selectedCount: payload.selectedScheduleIds?.length })
      calls.push(call)
      if (url.pathname.endsWith('/apply')) {
        assert.equal(payload.spaceId, -7)
        assert.equal(payload.projectId, null)
        assert.deepEqual(payload.selectedScheduleIds, [701])
        applied = true
        return json({ appliedScheduleIds: [701] })
      }
      return json({ ...payload, plannedAt: now, snapshotToken: 'synthetic-local-only', windowStart: now, windowEnd: '2026-11-09T14:00:00Z',
        changes: [{ scheduleId: scheduleId(payload.spaceId), taskId: 501, title: title(payload.spaceId), expectedVersion: 1,
          beforeStart: '2026-11-09T00:30:00Z', beforeEnd: '2026-11-09T01:00:00Z', afterStart: '2026-11-09T01:00:00Z', afterEnd: '2026-11-09T01:30:00Z', calibrationApplied: false }],
        protectedSchedules: [], unplaced: [] })
    }
    assert.equal(request.method(), 'GET', 'Only two synthetic replan POST routes are permitted')
    if (url.pathname === '/v2/plans' || url.pathname === '/v2/plans/deadline-risk') call.query = url.search
    calls.push(call)
    if (url.pathname === '/v2/workspace/events') return new Promise((resolve) => streams.push({ route, resolve }))
    if (url.pathname === '/v2/spaces') return json({ defaultSpaceId: -7, currentMember: { memberId: 7, nickname: '합성 회원' }, spaces: [-7, 42, 43].map(space) })
    if (/^\/v2\/spaces\/-?\d+\/snapshot$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/')[3])
      return json({ space: space(id), members: space(id).members, projects: id === 42 ? [project] : [] })
    }
    if (url.pathname === '/v2/projects/snapshot') return json({ projects: [project], taskAssignments: {}, scheduleAssignments: {}, seriesAssignments: {} })
    if (url.pathname === '/v2/members/settings') return json({ zoneId: 'Asia/Seoul', dailyObjectiveWork: 'PT4H' })
    if (url.pathname === '/v2/members/now') return json(null)
    if (url.pathname === '/v2/onboarding') return json({ revision: 1, acknowledgedRevision: 1, pendingTour: [], features: [] })
    if (url.pathname === '/v2/time-calibration') return json({ enabled: false, windowDays: 90, minSamples: 5, overall: { factor: 1, rawMedian: null, sampleCount: 0 }, byDifficulty: [] })
    if (url.pathname === '/v2/routines') return json({ routines: [] })
    if (url.pathname === '/v2/workspace/schedules') return json([])
    if (url.pathname === '/v2/workspace/tasks') return json({ tasks: [], totalPages: 1, totalElements: 0 })
    if (url.pathname === '/v2/categories') return json({ categories: [], taskAssignments: {}, scheduleAssignments: {}, seriesAssignments: {} })
    if (url.pathname === '/v2/plans') return json({ date, zoneId: 'Asia/Seoul', window: { start: { dateTime: `${date}T09:00:00`, zoneId: 'Asia/Seoul' }, end: { dateTime: `${date}T23:00:00`, zoneId: 'Asia/Seoul' } }, blocks: [], unplaced: [], routines: [], objective: { dailyObjectiveWork: 'PT4H', existingTaskWork: 'PT0S', plannedWork: 'PT0S', used: 'PT0S' } })
    if (url.pathname === '/v2/plans/deadline-risk') {
      assert.equal(url.searchParams.has('spaceId') || url.searchParams.has('projectId'), false)
      return json({ generatedAt: now, zoneId: 'Asia/Seoul', days: 7, horizonEnd: '2026-11-15T15:00:00Z', calibrationApplied: false, assumptions: ['개인 공간 합성 응답'], limitations: ['실제 계산/DB 검증이 아님'],
        items: [{ taskId: 501, title: applied ? '적용 후 새 마감 예보' : '개인 마감 예보 작업', deadline: '2026-11-09T15:00:00Z', status: 'SHORTAGE', requiredMinutes: 300, availableMinutes: 120, shortageMinutes: 180, predecessorTaskIds: [], reasons: ['합성 시간 부족'], suggestedFinish: null, recurrenceSeriesId: null }] })
    }
    unexpected.push(url.pathname)
    return json({ message: 'Unconfigured local fixture' }, 404)
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (/Error handled by React Router|Uncaught|TypeError:|ReferenceError:/.test(message.text())) errors.push(message.text()) })
  await page.clock.install({ time: new Date(now) })
  await page.goto(origin + '/app/plan')
  const openPlan = async () => {
    if (new URL(page.url()).pathname !== '/app/plan') {
      await page.getByRole('link', { name: '오늘', exact: true }).first().click()
      await page.getByRole('link', { name: '하루 계획', exact: true }).click()
    }
    await page.getByLabel('늦어진 시간', { exact: true }).waitFor()
  }
  const preview = async (id, projectId) => {
    await page.getByRole('button', { name: '변경 미리보기', exact: true }).click()
    await page.getByRole('heading', { name: '변경 전후', exact: true }).waitFor()
    await page.locator('.day-replan__changes').getByText(title(id), { exact: true }).waitFor()
    const call = calls.filter((item) => item.path === '/v2/plans/replan').at(-1)
    assert.equal(call.spaceId, id)
    assert.equal(call.projectId, projectId)
  }
  await openPlan()
  await page.getByRole('link', { name: '마감 전에 시간이 충분한지 예보 보기', exact: true }).waitFor()
  await page.locator('.space-projects-nav').getByRole('button', { name: project.name, exact: true }).click()
  await openPlan()
  await preview(42, 99)
  checks.push('both entries coexist on PlanPage; selected team/project reaches replan preview')
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: path.join(output, 'combined-plan-desktop.png'), fullPage: true })
  await page.getByRole('link', { name: '마감 전에 시간이 충분한지 예보 보기', exact: true }).click()
  await page.getByRole('heading', { name: '개인 마감 예보 작업', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('pinit.space.selection.7')), '42')
  assert.match(await page.locator('.space-context').innerText(), /개인 공간 · 마감 위험 예보/)
  checks.push('team project to personal forecast keeps selection; forecast request excludes scope parameters')
  await page.getByRole('button', { name: '개인 공간에서 하루 계획 열기', exact: true }).click()
  await openPlan()
  assert.equal(await page.evaluate(() => sessionStorage.getItem('pinit.space.selection.7')), '-7')
  assert.equal(await page.locator('.day-replan__changes').count(), 0)
  await preview(-7, null)
  assert.ok(!(await page.locator('.day-replan__changes').innerText()).includes('팀 A'))
  assert.ok(calls.filter((item) => item.path === '/v2/plans').some((item) => new URLSearchParams(item.query).get('spaceId') === '-7' && !new URLSearchParams(item.query).has('projectId')))
  checks.push('forecast personal-plan action clears project and old team preview before personal replan')
  await page.locator('.space-switcher:visible').first().click()
  await page.getByRole('button', { name: /팀 B 검증 공간/ }).filter({ has: page.locator('.space-avatar') }).last().click()
  await openPlan()
  assert.equal(await page.locator('.day-replan__changes').count(), 0)
  await preview(43, null)
  checks.push('switching to another team clears personal preview and sends the new scope')
  await page.getByRole('link', { name: '마감 전에 시간이 충분한지 예보 보기', exact: true }).click()
  await page.getByRole('heading', { name: '개인 마감 예보 작업', exact: true }).waitFor()
  await page.getByRole('button', { name: '개인 공간에서 하루 계획 열기', exact: true }).click()
  await openPlan()
  await preview(-7, null)
  await page.getByRole('button', { name: '선택한 변경 적용', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '1개 일정의 시간을 변경했어요' }).waitFor()
  assert.equal(calls.filter((item) => item.path === '/v2/plans/replan/apply').length, 1)
  checks.push('explicit personal replan apply sends one selected existing ID with no team/project leakage')
  await page.getByRole('link', { name: '마감 전에 시간이 충분한지 예보 보기', exact: true }).click()
  await page.getByRole('heading', { name: '적용 후 새 마감 예보', exact: true }).waitFor()
  checks.push('forecast is requested again after leaving an applied replan')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, 'combined-forecast-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: '개인 공간에서 하루 계획 열기', exact: true }).click()
  await openPlan()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, 'combined-plan-mobile.png'), fullPage: true })
  checks.push('both combined surfaces fit 390px without horizontal overflow')
  assert.deepEqual(errors, [])
  assert.deepEqual(escaped, [])
  assert.deepEqual(unexpected, [])
  const report = { passed: true, checks, calls, pageErrors: errors.length, externalRequests: escaped.length,
    boundary: 'Combined genuine FE on local Vite with synthetic API responses only; no native BE, authentication or DB validation; no production SW registration, separate VM tests cover no-store.' }
  await writeFile(path.join(output, 'combined-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  for (const stream of streams) { await stream.route.abort().catch(() => {}); stream.resolve() }
  await browser?.close()
  await server.close()
}
