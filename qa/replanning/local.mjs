import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// This harness never uses the production-oriented workspace browser workflow.
const fixture = new URL(process.env.REPLAN_FIXTURE_ORIGIN ?? 'http://127.0.0.1:18086')
assert.equal(fixture.protocol, 'http:')
assert.equal(fixture.hostname, '127.0.0.1')
assert.equal(fixture.pathname, '/')
assert.equal(fixture.username + fixture.password, '')
const frontend = 'http://127.0.0.1:5186'
const root = fileURLToPath(new URL('../../', import.meta.url))
const dist = path.resolve(root, 'dist')
const runtime = fileURLToPath(new URL('./.runtime/', import.meta.url))
const qaRequire = createRequire(new URL('../browser/package.json', import.meta.url))
const { chromium } = qaRequire('playwright')
const instant = (value) => {
  const parsed = Date.parse(value)
  assert.ok(Number.isFinite(parsed), 'Fixture timestamps must be valid instants')
  return parsed
}
const getFixture = async () => {
  const response = await fetch(new URL('/replan-fixture/info', fixture), { redirect: 'error', signal: AbortSignal.timeout(10_000) })
  assert.equal(response.ok, true)
  const info = await response.json()
  assert.equal(info.fixture, true, 'Refuse writes without a disposable fixture marker')
  assert.ok(Number.isSafeInteger(info.memberId) && Number.isSafeInteger(info.spaceId))
  assert.ok(Number.isSafeInteger(info.auditCount) && Number.isSafeInteger(info.outboxCount))
  assert.ok(Number.isSafeInteger(info.otherSpaceScheduleId), 'Fixture must expose the other-space schedule (BE ADR-0037 fixture)')
  return info
}
let info = await getFixture()
const fixtureWrite = async (suffix) => {
  assert.ok(['reset', 'revoke', 'touch'].includes(suffix))
  const response = await fetch(new URL(`/replan-fixture/${suffix}`, fixture), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000) })
  assert.equal(response.ok, true, `Disposable fixture ${suffix} failed`)
}
await fixtureWrite('reset')
info = await getFixture()
const native = []
let holdPreview = false
let releasePreview
let previewStarted
const previewSignal = () => new Promise((resolve) => { previewStarted = resolve })
const contentType = (name) => ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }[path.extname(name)] ?? 'application/octet-stream')
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, frontend)
    if (/^\/v2\/plans\/replan(?:\/apply)?$/.test(url.pathname)) {
      assert.equal(request.method, 'POST')
      let body = ''
      for await (const chunk of request) body += chunk
      const payload = JSON.parse(body)
      const upstream = await fetch(new URL(url.pathname, fixture), {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Member-Id': String(info.memberId) }, body,
        signal: AbortSignal.timeout(15_000),
      })
      const text = await upstream.text()
      const result = JSON.parse(text)
      native.push({ path: url.pathname, payload, status: upstream.status, result })
      if (url.pathname === '/v2/plans/replan' && holdPreview) {
        previewStarted?.()
        await new Promise((resolve) => { releasePreview = resolve })
      }
      response.writeHead(upstream.status, { 'Content-Type': 'application/json' })
      response.end(text)
      return
    }
    const requested = path.resolve(dist, '.' + decodeURIComponent(url.pathname))
    assert.ok(requested === dist || requested.startsWith(dist + path.sep))
    const file = path.extname(requested) ? requested : path.join(dist, 'index.html')
    response.writeHead(200, { 'Content-Type': contentType(file) })
    response.end(await readFile(file))
  } catch {
    response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ message: 'Local QA fixture transport failed.' }))
  }
})
await new Promise((resolve) => server.listen(5186, '127.0.0.1', resolve))
let browser
let page
const fallbacks = []
// Start from an empty runtime folder so a report and failure files never mix runs.
await rm(runtime, { recursive: true, force: true })
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.REPLAN_CHROMIUM_PATH ? { executablePath: process.env.REPLAN_CHROMIUM_PATH } : {}) })
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, timezoneId: info.zoneId, serviceWorkers: 'block' })
  page = await context.newPage()
  await page.clock.install({ time: new Date(info.now) })
  const errors = [], escaped = []
  page.on('pageerror', (error) => errors.push(error.message))
  await context.addInitScript(({ memberId, spaceId }) => {
    localStorage.setItem('pinit.accessToken', `${btoa('{}')}.${btoa(JSON.stringify({ sub: String(memberId), exp: 2_100_000_000 }))}.local-fixture`)
    localStorage.setItem('pinit.time.displayZoneId', 'Asia/Seoul')
    localStorage.setItem('pinit.pwa.installBannerDismissed', '1')
    if (!sessionStorage.getItem(`pinit.space.selection.${memberId}`)) sessionStorage.setItem(`pinit.space.selection.${memberId}`, String(spaceId))
  }, info)
  const space = (id) => ({ id, name: id === info.spaceId ? 'QA space A' : 'QA space B', purpose: null, personal: false, version: 1, deletedAt: null,
    allowedActions: { edit: true }, members: [{ memberId: info.memberId, nickname: 'Fixture member', role: 'MEMBER' }] })
  const project = info.projectId === null ? null : { id: info.projectId, spaceId: info.spaceId, name: 'QA project', outcome: null, completed: false, version: 1, allowedActions: { edit: true } }
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: info.zoneId, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(info.now))
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== frontend) { escaped.push(url.origin); return route.abort() }
    if (/^\/v2\/plans\/replan(?:\/apply)?$/.test(url.pathname)) return route.continue()
    if (!/^\/v[02]\//.test(url.pathname)) return route.continue()
    const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname === '/v2/spaces') return json({ defaultSpaceId: info.spaceId, currentMember: { memberId: info.memberId, nickname: 'Fixture member' }, spaces: [space(info.spaceId), space(info.otherSpaceId)] })
    if (/^\/v2\/spaces\/-?\d+\/snapshot$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/')[3])
      return json({ space: space(id), members: space(id).members, projects: id === info.spaceId && project ? [project] : [] })
    }
    // ProjectHead reads summary.projects while a project is selected; an empty array crashes it.
    if (/^\/v2\/spaces\/-?\d+\/summary$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/')[3])
      const counts = { total: 0, completed: 0, running: 0, unassigned: 0, open: 0 }
      return json({ spaceId: id, asOf: info.now, projects: id === info.spaceId && project ? [{ projectId: project.id, counts, nearestDueDate: null }] : [],
        withoutProject: { counts, nearestDueDate: null }, members: [{ memberId: info.memberId, openAssignedCount: 0, nearestDueDate: null }], unassigned: { openCount: 0, nearestDueDate: null } })
    }
    if (url.pathname === '/v0/me/account') return json({ username: null, nickname: 'Fixture member', socialLogin: true, email: null, emailRequired: false })
    if (url.pathname === '/v2/notifications/notices/unread-count') return json({ unreadCount: 0 })
    if (url.pathname === '/v2/workspace/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': local display fixture\n\n' })
    if (url.pathname === '/v2/members/settings') return json({ zoneId: info.zoneId, dailyObjectiveWork: 'PT4H' })
    if (url.pathname === '/v2/members/now') return json(null)
    if (url.pathname === '/v2/time-calibration') return json({ enabled: false, windowDays: 90, minSamples: 5, overall: { factor: 1, rawMedian: null, sampleCount: 0 }, byDifficulty: [] })
    if (url.pathname === '/v2/routines') return json({ routines: [] })
    if (url.pathname === '/v2/onboarding') return json({ revision: 1, acknowledgedRevision: 1, pendingTour: [], features: [] })
    if (url.pathname === '/v2/plans') return json({ date, zoneId: info.zoneId, window: { start: { dateTime: `${date}T09:00:00`, zoneId: info.zoneId }, end: { dateTime: `${date}T23:00:00`, zoneId: info.zoneId } }, blocks: [], unplaced: [], routines: [], objective: { dailyObjectiveWork: 'PT4H', existingTaskWork: 'PT0S', plannedWork: 'PT0S', used: 'PT0S' } })
    if (url.pathname === '/v2/projects/snapshot') return json({ projects: project ? [project] : [], taskAssignments: {}, scheduleAssignments: {} })
    if (url.pathname === '/v2/workspace/tasks') return json({ tasks: [], totalPages: 1, totalElements: 0 })
    // Task split (ADR-0035) reads its summary on every app screen; answer it as unavailable so the app does not crash.
    if (url.pathname === '/v2/task-splits/summary') return json({ available: false, consent: { currentVersion: 'local-fixture', consented: false, provider: 'local-fixture' }, quota: { limit: 0, used: 0, remaining: 0, resetsAt: info.now }, archiveCount: 0 })
    fallbacks.push(`${route.request().method()} ${url.pathname}`)
    return json([])
  })
  const openPlan = async () => {
    if (!page.url().startsWith(frontend)) await page.goto(frontend + '/app/plan', { waitUntil: 'domcontentloaded' })
    else if (new URL(page.url()).pathname !== '/app/plan') {
      await page.getByRole('link', { name: '오늘', exact: true }).first().click()
      await page.getByRole('link', { name: '하루 계획', exact: true }).click()
    }
    await page.getByLabel('늦어진 시간').waitFor()
  }
  const chooseSpace = async (name) => {
    await page.locator('.space-switcher:visible').first().click()
    await page.getByRole('button', { name: new RegExp(name) }).filter({ has: page.locator('.space-avatar') }).last().click()
  }
  const chooseProject = async () => {
    if (info.projectId === null) return
    await page.locator('.space-projects-nav').getByRole('button', { name: 'QA project', exact: true }).click()
  }
  await openPlan()
  await chooseProject()
  await openPlan()
  assert.equal(await page.getByLabel('늦어진 시간').inputValue(), '30')
  // Hold a genuine REST response while the UI changes spaces.
  holdPreview = true
  const started = previewSignal()
  await page.getByRole('button', { name: '변경 미리보기', exact: true }).click()
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native fixture preview did not arrive')), 15_000)
    started.then(() => { clearTimeout(timer); resolve() }, reject)
  })
  // BE ADR-0037 §10: every reply covers my whole day; the requested space only narrows what may move.
  const spaceA = native.at(-1).result
  const spaceAMovable = new Set([...spaceA.changes, ...spaceA.unplaced].map((item) => item.scheduleId))
  assert.ok(spaceAMovable.size > 0)
  assert.equal(spaceA.protectedSchedules.find((item) => item.scheduleId === info.otherSpaceScheduleId)?.reason, 'OUTSIDE_SPACE')
  await chooseSpace('QA space B')
  holdPreview = false
  releasePreview()
  await openPlan()
  assert.match(await page.locator('.day-replan__scope').innerText(), /QA space B/)
  assert.equal(await page.locator('.day-replan__changes').count(), 0)
  await page.getByRole('button', { name: '변경 미리보기', exact: true }).click()
  await page.getByRole('heading', { name: '변경 전후' }).waitFor()
  const spaceB = native.at(-1)
  assert.equal(spaceB.payload.spaceId, info.otherSpaceId)
  assert.equal(spaceB.result.spaceId, info.otherSpaceId)
  // Space B moves none of space A's schedules; they stay as OUTSIDE_SPACE obstacles.
  assert.equal([...spaceB.result.changes, ...spaceB.result.unplaced].some((item) => spaceAMovable.has(item.scheduleId)), false)
  const spaceBReasons = new Map(spaceB.result.protectedSchedules.map((item) => [item.scheduleId, item.reason]))
  for (const id of spaceAMovable) assert.equal(spaceBReasons.get(id), 'OUTSIDE_SPACE')
  assert.equal(spaceBReasons.has(info.otherSpaceScheduleId), false)
  await chooseSpace('QA space A')
  await openPlan()
  await chooseProject()
  await openPlan()
  await page.getByRole('button', { name: '변경 미리보기', exact: true }).click()
  await page.getByRole('heading', { name: '변경 전후' }).waitFor()
  const before = native.at(-1).result
  assert.equal(before.spaceId, info.spaceId)
  assert.equal(before.projectId, info.projectId)
  assert.ok(before.changes.length > 0)
  const selected = before.changes[0]
  for (let index = 1; index < before.changes.length; index++) await page.locator('.day-replan__changes input').nth(index).uncheck()
  const beforeMutation = await getFixture()
  await fixtureWrite('touch')
  await page.getByRole('button', { name: '선택한 변경 적용', exact: true }).click()
  // The server's own 409 message (REPLAN_SNAPSHOT_CHANGED) is shown as is.
  await page.getByRole('alert').filter({ hasText: '미리보기 뒤에 일정이나 계획 조건이 바뀌었어요' }).waitFor()
  assert.equal(native.at(-1).status, 409)
  const rejected = await getFixture()
  assert.equal(rejected.auditCount, beforeMutation.auditCount)
  assert.equal(rejected.outboxCount, beforeMutation.outboxCount)
  assert.equal(await page.locator('.day-replan__changes input').nth(0).isChecked(), true)
  for (let index = 1; index < before.changes.length; index++) assert.equal(await page.locator('.day-replan__changes input').nth(index).isChecked(), false)
  await page.getByRole('button', { name: '변경 미리보기', exact: true }).click()
  await page.getByRole('heading', { name: '변경 전후' }).waitFor()
  for (let index = 1; index < before.changes.length; index++) await page.locator('.day-replan__changes input').nth(index).uncheck()
  await page.getByRole('button', { name: '선택한 변경 적용', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '1개 일정의 시간을 변경했어요' }).waitFor()
  const applied = native.at(-1)
  assert.equal(applied.path, '/v2/plans/replan/apply')
  assert.equal(applied.status, 200)
  assert.deepEqual(applied.payload.selectedScheduleIds, [selected.scheduleId])
  assert.equal(applied.payload.projectId, info.projectId)
  const persisted = await getFixture()
  assert.equal(instant(persisted.currentStart), instant(selected.afterStart))
  assert.equal(instant(persisted.secondCurrentStart), instant(info.secondCurrentStart))
  await page.getByRole('button', { name: '변경 미리보기', exact: true }).click()
  await page.getByRole('heading', { name: '변경 전후' }).waitFor()
  const after = native.at(-1).result
  assert.equal(after.changes.find((change) => change.scheduleId === selected.scheduleId)?.beforeStart, selected.afterStart)
  for (const unchanged of before.changes.slice(1)) assert.equal(after.changes.find((change) => change.scheduleId === unchanged.scheduleId)?.beforeStart, unchanged.beforeStart)
  await mkdir(runtime, { recursive: true })
  await page.screenshot({ path: path.join(runtime, 'replan-native-desktop.png'), fullPage: true })
  // Remove actual H2 membership without a display/SSE event: the REST denial
  // itself must erase the independent preview copy and block another apply.
  await fixtureWrite('revoke')
  await page.getByRole('button', { name: '선택한 변경 적용', exact: true }).click()
  await page.getByText('스페이스 접근 권한을 다시 확인해 주세요.', { exact: false }).waitFor()
  // The cleared preview fades out (usePresence) before it leaves the DOM.
  await page.locator('.day-replan__changes').waitFor({ state: 'detached', timeout: 5_000 })
  assert.equal(await page.getByRole('button', { name: '변경 미리보기', exact: true }).isDisabled(), true)
  assert.ok([403, 404, 410].includes(native.at(-1).status))
  const denied = await getFixture()
  assert.equal(instant(denied.currentStart), instant(persisted.currentStart))
  assert.equal(denied.auditCount, persisted.auditCount)
  assert.equal(denied.outboxCount, persisted.outboxCount)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(runtime, 'replan-native-mobile-denied.png'), fullPage: true })
  assert.deepEqual(errors, [])
  assert.deepEqual(escaped, [])
  const report = { passed: true, boundary: 'genuine FE -> native REST -> Task service -> disposable H2; test identity; workspace/auth display fixtures', scenarios: ['late-space-A-response-discarded', 'space-B-protects-space-A-as-OUTSIDE_SPACE', 'space-A-protects-other-space-schedule-as-OUTSIDE_SPACE', 'selected-project-carried-through-preview-and-apply', 'actual-stale-version-409-retains-selection', 'selected-existing-ID-applied', 'native-info-and-next-preview-prove-persisted-start', 'unselected-starts-unchanged', 'actual-membership-denial-clears-preview', 'conflict-and-denial-add-no-audit-or-outbox', 'mobile-no-overflow'], nativeCalls: native.map(({ path, payload, status }) => ({ path, spaceId: payload.spaceId, projectId: payload.projectId, selectedCount: payload.selectedScheduleIds?.length, status })), pageErrors: errors.length, externalRequests: escaped.length }
  await writeFile(path.join(runtime, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  // Leave enough evidence in the ignored runtime folder to see where the UI stopped.
  await mkdir(runtime, { recursive: true })
  await page?.screenshot({ path: path.join(runtime, 'failure.png'), fullPage: true }).catch(() => {})
  await writeFile(path.join(runtime, 'failure.html'), (await page?.content().catch(() => '')) ?? '')
  await writeFile(path.join(runtime, 'failure.json'), JSON.stringify({ message: String(error?.message ?? error), url: page?.url(), unstubbed: [...new Set(fallbacks)] }, null, 2))
  throw error
} finally {
  releasePreview?.()
  await browser?.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
