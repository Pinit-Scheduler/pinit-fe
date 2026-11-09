import { expect } from '@playwright/test'
import { CANONICAL, API } from './constants.mjs'
import { check, QaFailure } from './safe.mjs'

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const route = (page, path) => page.goto(CANONICAL + path, { waitUntil: 'domcontentloaded' })
export function isApi(response, path, method = 'GET') {
  const url = new URL(response.url())
  return url.origin === API && url.pathname === path && response.request().method() === method
}
export async function mutation(page, path, method, action, status = [200, 201, 204], { readBody = true } = {}) {
  const pending = page.waitForResponse((response) => isApi(response, path, method), { timeout: 20_000 })
  void pending.catch(() => {}) // Keep the original rejection for the awaited assertion below.
  await action()
  const response = await pending
  if (!status.includes(response.status())) throw new QaFailure('UI_API_STATUS_UNEXPECTED', response.status())
  let data = null
  if (readBody && response.headers()['content-type']?.includes('json')) {
    try { data = await response.json() } catch { throw new QaFailure('UI_API_JSON_FAILED') }
  }
  return { response, data }
}
export async function dismissTour(page) {
  const skip = page.getByRole('button', { name: '건너뛰기', exact: true })
  if (await skip.isVisible().catch(() => false)) await skip.click()
}
export async function loginUi(owner) {
  const { page } = owner
  await route(page, '/login')
  await page.getByLabel('아이디', { exact: true }).fill(owner.username)
  await page.getByLabel('비밀번호', { exact: true }).fill(owner.password)
  const onboardingResponse = page.waitForResponse((response) => isApi(response, '/v2/onboarding'), { timeout: 20_000 })
  void onboardingResponse.catch(() => {})
  await mutation(page, '/v0/login', 'POST', () => page.getByRole('button', { name: '로그인', exact: true }).click())
  await expect(page).toHaveURL(/\/app\//)
  const onboarding = await onboardingResponse
  check(onboarding.status() === 200, 'ONBOARDING_READ_REQUIRED')
  const pending = (await onboarding.json()).pendingTour
  if (Array.isArray(pending) && pending.length > 0) await page.getByRole('button', { name: '건너뛰기', exact: true }).click()
  await route(page, '/app/spaces')
  await spacesReady(page)
}
export async function spacesReady(page) {
  await expect(page.getByRole('heading', { name: '공간·프로젝트 관리', exact: true })).toBeVisible()
  await expect(page.getByText('공간을 불러오는 중…', { exact: true })).toHaveCount(0)
  await expect(page.locator('.space-management__heading h2')).toBeVisible()
  await expect(page.locator('.workspace-inline-error')).toHaveCount(0)
}
export async function chooseSpace(page, name) {
  await page.locator('.space-switcher:visible').first().click()
  const dialog = page.getByRole('dialog', { name: '공간 전환', exact: true })
  await dialog.locator('.space-option').filter({ has: page.getByText(name, { exact: true }) }).click()
  await expect(dialog).toHaveCount(0)
}
export async function manage(page, name, tab = '목적·정보') {
  // Invitation/consent routes are intentionally outside AppShell. Enter the
  // normal management route before using its visible space-switcher control.
  await route(page, '/app/spaces')
  await spacesReady(page)
  if (name) await chooseSpace(page, name)
  await route(page, '/app/spaces')
  await spacesReady(page)
  await page.getByRole('button', { name: tab, exact: true }).click()
}
export async function createSpaceUi(owner, name) {
  await route(owner.page, '/app/spaces')
  await spacesReady(owner.page)
  await owner.page.getByRole('button', { name: '공간 만들기', exact: true }).click()
  const dialog = owner.page.getByRole('dialog', { name: '목적 공간 만들기', exact: true })
  await dialog.getByLabel('공간 이름', { exact: true }).fill(name)
  await dialog.getByLabel(/^이 공간의 목적/).fill('함께 계획하고 끝내는 검증 공간')
  const { data } = await mutation(owner.page, '/v2/spaces', 'POST', () => dialog.getByRole('button', { name: '만들기', exact: true }).click())
  check(Number.isSafeInteger(data?.id) && data.id > 0, 'CREATED_SPACE_ID_REQUIRED')
  owner.spaces.add(data.id)
  await expect(dialog).toHaveCount(0)
  await expect(owner.page.locator('.space-management__heading h2')).toHaveText(name)
  return data
}
export async function createProjectUi(owner, spaceName, name) {
  await manage(owner.page, spaceName, '프로젝트')
  await owner.page.getByRole('button', { name: '프로젝트 만들기', exact: true }).click()
  const dialog = owner.page.getByRole('dialog', { name: '프로젝트 만들기', exact: true })
  await dialog.getByLabel('프로젝트 이름', { exact: true }).fill(name)
  await dialog.getByLabel(/^목적에 기여할 성과 · 권장/).fill('실제 서버와 연결한 공유 업무')
  const { data } = await mutation(owner.page, '/v2/projects', 'POST', () => dialog.getByRole('button', { name: '만들기', exact: true }).click())
  check(Number.isSafeInteger(data?.id), 'CREATED_PROJECT_ID_REQUIRED')
  await expect(dialog).toHaveCount(0)
  return data
}
export async function fillTask(page, { title, spaceId, projectId = null, assigneeId, dueDate = today() }) {
  await page.getByLabel('제목', { exact: true }).fill(title)
  await page.getByLabel('설명', { exact: true }).fill('실제 UI 검증에서 만든 작업')
  await page.getByLabel('마감 날짜', { exact: true }).fill(dueDate)
  await page.getByRole('group', { name: '소속·담당자', exact: true }).getByLabel(/^공간/).selectOption(String(spaceId))
  await page.getByRole('group', { name: '소속·담당자', exact: true }).getByLabel(/^프로젝트/).selectOption(projectId === null ? '' : String(projectId))
  const assignee = page.getByRole('group', { name: '소속·담당자', exact: true }).getByLabel(/^담당자/)
  await expect(assignee).toBeEnabled()
  if (assigneeId !== undefined) await assignee.selectOption(assigneeId === null ? '' : String(assigneeId))
}
export async function createTaskUi(owner, input) {
  check(input.title.length > 0 && input.title.length <= 20, 'TASK_FIXTURE_TITLE_INVALID')
  await route(owner.page, '/app/tasks/new')
  await fillTask(owner.page, input)
  const { data } = await mutation(owner.page, '/v2/workspace/tasks', 'POST', () => owner.page.getByRole('button', { name: '작업 생성', exact: true }).click())
  check(Number.isSafeInteger(data?.task?.id), 'CREATED_TASK_ID_REQUIRED')
  owner.tasks.add(data.task.id)
  await expect(owner.page).not.toHaveURL(/\/tasks\/new$/)
  return data
}
export async function editTitleUi(owner, kind, id, title) {
  check(title.length > 0 && title.length <= 20, 'TASK_FIXTURE_TITLE_INVALID')
  await route(owner.page, `/app/${kind}/${id}/edit`)
  await owner.page.getByLabel(kind === 'tasks' ? '제목' : '일정 제목', { exact: true }).fill(title)
  return mutation(owner.page, `/v2/workspace/${kind}/${id}`, 'PATCH', () => owner.page.getByRole('button', { name: kind === 'tasks' ? '작업 수정' : '일정 수정', exact: true }).click())
}
export async function linkedScheduleUi(owner, taskId) {
  await route(owner.page, `/app/tasks/${taskId}`)
  await owner.page.getByRole('button', { name: '일정으로 배정', exact: true }).click()
  const dialog = owner.page.locator('.task-sched-modal__content')
  const dateInput = dialog.getByLabel('시작 시각', { exact: true })
  await expect(dateInput).toHaveAttribute('type', 'datetime-local')
  await dateInput.fill(today() + 'T12:00')
  const { data } = await mutation(owner.page, `/v2/workspace/tasks/${taskId}/schedule`, 'POST', () => dialog.getByRole('button', { name: '일정 생성', exact: true }).click())
  check(Number.isSafeInteger(data?.schedule?.id), 'CREATED_SCHEDULE_ID_REQUIRED')
  owner.schedules.add(data.schedule.id)
  await expect(dialog).toHaveCount(0)
  return data
}
export async function confirm(page, title) {
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '확인', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}
export async function assertNoOverflow(page) {
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'HORIZONTAL_OVERFLOW')
}
export async function waitUntil(read, predicate, code, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new QaFailure(code)
}
