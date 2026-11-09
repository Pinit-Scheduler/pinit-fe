import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { CANONICAL, API } from './constants.mjs'
import { candidateTransport } from './transport.mjs'
import { createFixtures, cleanupFixtures, ownedApi, tokenFor } from './fixtures.mjs'
import { check, evidence, failureCode, failureLocation, QaFailure } from './safe.mjs'
import { captureFinalSpace } from './screenshots.mjs'
import { assertNoOverflow, chooseSpace, confirm, createProjectUi, createSpaceUi, createTaskUi, dismissTour, editTitleUi, isApi, linkedScheduleUi, loginUi, manage, mutation, route, spacesReady, today, waitUntil } from './ui.mjs'
import { oauthUi } from './oauth.mjs'

// These are real UI/API scenarios, sharing exactly two ordinary fresh accounts.
// There is no API routing/stubbing, injected application state, clock override,
// policy simulator, storageState import or pre-existing user's browser profile.
test.describe.configure({ mode: 'serial' })
const owners = [], contexts = [], transports = []
let a, b, shared, destination, project, task, schedule, nullTask, privateTask, projectTask, projectSchedule
const observations = new Map()
function observe(page) {
  const value = { snapshots: 0, streams: 0, states: 0, patches: new Map(), resourceVersions: new Map(), unexpectedOrigins: 0 }
  observations.set(page, value)
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (/\/v[02]\//.test(url.pathname) && url.origin !== API) value.unexpectedOrigins++
    if (url.origin !== API) return
    if (url.pathname === '/v2/workspace/events') value.streams++
    if (request.method() === 'PATCH' && /^\/v2\/workspace\/(tasks|schedules)\/\d+$/.test(url.pathname)) {
      const previous = value.patches.get(url.pathname) ?? []
      let version
      try { version = request.postDataJSON()?.expectedVersion } catch { /* no raw request logging */ }
      previous.push(version)
      value.patches.set(url.pathname, previous)
    }
    if (request.method() === 'POST' && /^\/v2\/workspace\/tasks\/\d+\/state$/.test(url.pathname)) value.states++
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === API && response.status() === 200 && /^\/v2\/spaces\/[-\d]+\/snapshot$/.test(url.pathname)) value.snapshots++
    if (url.origin === API && response.status() === 200 && response.request().method() === 'GET' && /^\/v2\/workspace\/(tasks|schedules)\/\d+$/.test(url.pathname)) {
      void response.json().then((body) => { if (Number.isSafeInteger(body.version)) value.resourceVersions.set(url.pathname, body.version) }).catch(() => {})
    }
  })
  // Deliberately do not forward page console, request URLs/bodies, or errors.
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}))
}
function scenario(code, body) {
  test(code, async () => {
    try { await body(); evidence('scenario', { code, ok: true, ui: true }) }
    catch (error) {
      evidence('scenario', { code, ok: false })
      failureLocation(error)
      evidence('result', { code: failureCode(error), status: error instanceof QaFailure ? error.status : undefined, ok: false })
      throw new QaFailure(failureCode(error), error instanceof QaFailure ? error.status : undefined)
    }
  })
}
const getTask = async (owner, id) => (await ownedApi(owner, `/v2/workspace/tasks/${id}`)).data
const getSchedule = async (owner, id) => (await ownedApi(owner, `/v2/workspace/schedules/${id}`)).data
const snapshot = async (owner, id) => (await ownedApi(owner, `/v2/spaces/${id}/snapshot?includeDeleted=true`)).data
const memberRow = (page, nickname) => page.locator('.space-manager-row').filter({ has: page.locator('strong').filter({ hasText: nickname }) })
const projectRow = (page, name) => page.locator('.space-manager-row').filter({ has: page.getByRole('link', { name, exact: true }) })

test.beforeAll(async ({ browser }) => {
  try {
    await createFixtures(owners)
    ;[a, b] = owners
    for (const owner of owners) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' })
      context.setDefaultTimeout(20_000)
      context.setDefaultNavigationTimeout(30_000)
      contexts.push(context)
      transports.push(await candidateTransport(context, fileURLToPath(new URL('../../dist/', import.meta.url))))
      owner.page = await context.newPage()
      observe(owner.page)
    }
  } catch (error) {
    evidence('result', { code: failureCode(error), status: error instanceof QaFailure ? error.status : undefined, ok: false })
    throw new QaFailure(failureCode(error))
  }
})
test.afterAll(async () => {
  let failed = false
  try {
    const failures = await cleanupFixtures(owners)
    check(failures === 0, 'FIXTURE_CLEANUP_FAILED')
    for (const transport of transports) transport.assertValid()
    for (const value of observations.values()) check(value.unexpectedOrigins === 0, 'REAL_API_ORIGIN_REQUIRED')
    evidence('transport', { ok: true, count: transports.length, sourceHead: process.env.QA_SOURCE_HEAD })
  } catch (error) { failed = true; evidence('cleanup', { code: failureCode(error), ok: false }) }
  finally { await Promise.all(contexts.map((context) => context.close().catch(() => {}))) }
  check(!failed, 'FIXTURE_CLEANUP_FAILED')
})

scenario('LOGIN_ISOLATED_CONTEXTS', async () => {
  await loginUi(a)
  await loginUi(b)
  const cookies = await Promise.all(contexts.map((context) => context.cookies(API + '/v0/refresh')))
  const refresh = cookies.map((list) => list.find((cookie) => cookie.name === 'refresh_token'))
  check(refresh.every((cookie) => cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Lax') && refresh[0].value !== refresh[1].value, 'COOKIE_CONTEXT_ISOLATION_REQUIRED')
  check((await tokenFor(a)) !== (await tokenFor(b)), 'COOKIE_CONTEXT_ISOLATION_REQUIRED')
  await a.page.getByRole('button', { name: '참여자', exact: true }).click()
  await expect(a.page.getByText(/기본 개인 공간에는 초대할 수 없어요/)).toBeVisible()
  await expect(a.page.getByRole('button', { name: '초대 링크 만들기', exact: true })).toHaveCount(0)
  const personal = await snapshot(a, a.defaultSpaceId)
  check(personal.space.personal && personal.space.allowedActions.invite === false, 'PERSONAL_INVITATION_FORBIDDEN')
})

scenario('SPACE_PROJECT_UI_CRUD', async () => {
  shared = await createSpaceUi(a, '함께 만드는 제품')
  destination = await createSpaceUi(a, '두 번째 목적 공간')
  project = await createProjectUi(a, shared.name, '사용성 개선')
  await projectRow(a.page, project.name).getByRole('button', { name: '수정', exact: true }).click()
  const dialog = a.page.getByRole('dialog', { name: '프로젝트 수정', exact: true })
  await dialog.getByLabel('프로젝트 이름', { exact: true }).fill('사용성 개선 프로젝트')
  await mutation(a.page, `/v2/projects/${project.id}`, 'PATCH', () => dialog.getByRole('button', { name: '저장', exact: true }).click())
  project.name = '사용성 개선 프로젝트'
  await expect(projectRow(a.page, project.name)).toBeVisible()
  await mutation(a.page, `/v2/projects/${project.id}`, 'PATCH', () => projectRow(a.page, project.name).getByRole('button', { name: '완료', exact: true }).click())
  await expect(projectRow(a.page, project.name).getByRole('button', { name: '재개', exact: true })).toBeVisible()
  await mutation(a.page, `/v2/projects/${project.id}`, 'PATCH', () => projectRow(a.page, project.name).getByRole('button', { name: '재개', exact: true }).click())
  await manage(a.page, shared.name)
  await a.page.getByRole('button', { name: '공간 정보 수정', exact: true }).click()
  const editor = a.page.getByRole('dialog', { name: '공간 정보 수정', exact: true })
  const purpose = editor.getByLabel(/^이 공간의 목적/)
  await expect(purpose).toHaveCount(1)
  await purpose.fill('쉽게 함께 계획하고 실행한다')
  await mutation(a.page, `/v2/spaces/${shared.id}`, 'PATCH', () => editor.getByRole('button', { name: '저장', exact: true }).click())
  check((await snapshot(a, shared.id)).space.purpose === '쉽게 함께 계획하고 실행한다', 'SPACE_EDIT_NOT_PERSISTED')
})

scenario('INVITATION_JOIN_REUSE_REVOKE', async () => {
  await manage(a.page, shared.name, '참여자')
  await expect(a.page.getByRole('button', { name: '공간 나가기', exact: true })).toHaveCount(0) // on purpose tab only
  const { data: invitation } = await mutation(a.page, `/v2/spaces/${shared.id}/invitations`, 'POST', () => a.page.getByRole('button', { name: '초대 링크 만들기', exact: true }).click())
  check(typeof invitation?.token === 'string', 'INVITATION_TOKEN_REQUIRED')
  a.invitations.push({ spaceId: shared.id, token: invitation.token })
  const link = new URL(invitation.url, CANONICAL)
  check(link.origin === CANONICAL && link.pathname.startsWith('/spaces/join/'), 'INVITATION_ORIGIN_REQUIRED')
  await route(b.page, link.pathname)
  await expect(b.page.getByText(b.nickname + ' 님의 회원 프로필로 참여합니다. 이름을 다시 입력하지 않아도 돼요.', { exact: true })).toBeVisible()
  const { data: joined } = await mutation(b.page, `/v2/space-invitations/${encodeURIComponent(invitation.token)}/accept`, 'POST', () => b.page.getByRole('button', { name: '공간 참여', exact: true }).click())
  check(joined.status === 'JOINED', 'INVITATION_JOIN_REQUIRED')
  await expect(b.page).toHaveURL(/\/app\/tasks$/)
  await route(b.page, link.pathname)
  await expect(b.page.getByRole('button', { name: '참여 중인 공간으로 이동', exact: true })).toBeVisible()
  const duplicate = await mutation(b.page, `/v2/space-invitations/${encodeURIComponent(invitation.token)}/accept`, 'POST', () => b.page.getByRole('button', { name: '참여 중인 공간으로 이동', exact: true }).click())
  check(duplicate.data.status === 'ALREADY_MEMBER', 'INVITATION_DUPLICATE_REQUIRED')
  await expect(b.page).toHaveURL(/\/app\/tasks$/)
  await a.page.getByRole('dialog', { name: '초대 링크', exact: true }).getByRole('button', { name: '닫기', exact: true }).click()
  await manage(a.page, shared.name, '참여자')
  await expect(memberRow(a.page, b.nickname)).toBeVisible()
  check((await snapshot(a, shared.id)).members.filter((member) => member.memberId === b.memberId).length === 1, 'INVITATION_DUPLICATE_MEMBERSHIP')
  await manage(b.page, shared.name, '참여자')
  await expect(b.page.getByRole('button', { name: '초대 링크 만들기', exact: true })).toBeDisabled()
  await expect(memberRow(b.page, a.nickname).getByRole('button', { name: '제외', exact: true })).toBeDisabled()
  // Revoke through the real UI, then display the real server's rejected result.
  const { data: disposable } = await mutation(a.page, `/v2/spaces/${shared.id}/invitations`, 'POST', () => a.page.getByRole('button', { name: '초대 링크 만들기', exact: true }).click())
  a.invitations.push({ spaceId: shared.id, token: disposable.token })
  await mutation(a.page, `/v2/spaces/${shared.id}/invitations/${encodeURIComponent(disposable.token)}`, 'DELETE', () => a.page.getByRole('dialog', { name: '초대 링크', exact: true }).getByRole('button', { name: '링크 취소', exact: true }).click())
  await route(b.page, new URL(disposable.url, CANONICAL).pathname)
  await expect(b.page.getByRole('alert')).toContainText(/유효하지 않거나 만료/)
  await expect(b.page.getByRole('button', { name: '공간 참여', exact: true })).toHaveCount(0)
})

scenario('ASSIGNEE_NULL_TODAY_ALL_SPACES', async () => {
  task = await createTaskUi(a, { title: '오늘 함께 할 작업', spaceId: shared.id, projectId: project.id })
  check(task.assigneeId === a.memberId, 'CREATOR_DEFAULT_ASSIGNEE_REQUIRED')
  nullTask = await createTaskUi(a, { title: '담당자 미정 작업', spaceId: shared.id, projectId: project.id, assigneeId: null })
  check(nullTask.assigneeId === null, 'EXPLICIT_NULL_ASSIGNEE_REQUIRED')
  privateTask = await createTaskUi(a, { title: '내 개인 공간 작업', spaceId: a.defaultSpaceId })
  await createTaskUi(b, { title: '다른 참여자 담당 작업', spaceId: shared.id, projectId: project.id })
  await route(a.page, `/app/tasks/${nullTask.task.id}/edit`)
  await expect(a.page.getByRole('group', { name: '소속·담당자', exact: true }).getByLabel(/^담당자/)).toHaveValue('')
  await mutation(a.page, `/v2/workspace/tasks/${nullTask.task.id}`, 'PATCH', () => a.page.getByRole('button', { name: '작업 수정', exact: true }).click())
  check((await getTask(a, nullTask.task.id)).assigneeId === null, 'NULL_ASSIGNEE_EDIT_PRESERVED')
  await chooseSpace(a.page, shared.name)
  await expect(a.page.getByText('담당자 미정 작업', { exact: true }).first()).toBeVisible()
  await route(a.page, '/app/today')
  await expect(a.page.getByRole('heading', { name: '오늘의 내 작업', exact: true })).toBeVisible()
  await expect(a.page.getByText('오늘 함께 할 작업', { exact: true })).toHaveCount(2)
  await expect(a.page.getByText('내 개인 공간 작업', { exact: true })).toHaveCount(2)
  await expect(a.page.getByText('담당자 미정 작업', { exact: true })).toHaveCount(0)
  await expect(a.page.getByText('다른 참여자 담당 작업', { exact: true })).toHaveCount(0)
})

async function conflict(kind, id) {
  const path = `/v2/workspace/${kind}/${id}`
  const initial = kind === 'tasks' ? await getTask(a, id) : await getSchedule(a, id)
  await route(a.page, `/app/${kind}/${id}/edit`)
  const titleLabel = kind === 'tasks' ? '제목' : '일정 제목'
  const input = a.page.getByLabel(titleLabel, { exact: true })
  await input.fill('아직 저장하지 않은 내 초안')
  const before = observations.get(a.page).snapshots
  const latestTitle = kind === 'tasks' ? '다른 참여자가 먼저 저장한 작업' : '다른 참여자가 먼저 저장한 일정'
  const { data: updated } = await editTitleUi(b, kind, id, latestTitle)
  await waitUntil(async () => observations.get(a.page).snapshots, (count) => count > before, 'SSE_EDIT_EVENT_REQUIRED')
  await waitUntil(async () => observations.get(a.page).resourceVersions.get(path), (version) => version === updated.version, 'SSE_EDIT_EVENT_REQUIRED')
  await expect(input).toHaveValue('아직 저장하지 않은 내 초안')
  const previousPatches = observations.get(a.page).patches.get(path)?.length ?? 0
  await mutation(a.page, path, 'PATCH', () => a.page.getByRole('button', { name: kind === 'tasks' ? '작업 수정' : '일정 수정', exact: true }).click(), [409])
  const patchVersions = observations.get(a.page).patches.get(path)
  check(patchVersions.length === previousPatches + 1 && patchVersions.at(-1) === initial.version, 'ORIGINAL_EDIT_VERSION_REQUIRED')
  const notice = a.page.getByRole('dialog', { name: '다른 참여자가 먼저 수정했어요', exact: true })
  await expect(notice).toHaveCount(1)
  await expect(input).toHaveValue('아직 저장하지 않은 내 초안')
  await notice.getByRole('button', { name: '최신 내용 확인', exact: true }).click()
  await expect(a.page.getByLabel(titleLabel, { exact: true })).toHaveValue(latestTitle)
  await expect(notice).toHaveCount(0)
  check(observations.get(a.page).patches.get(path).length === previousPatches + 1, 'AUTOMATIC_CONFLICT_RESAVE_FORBIDDEN')
  evidence('scenario', { code: kind === 'tasks' ? 'TASK_CONFLICT_DETAILS' : 'SCHEDULE_CONFLICT_DETAILS', ok: true, sse: true, expectedVersion: initial.version, acknowledgements: 1, writes: 1 })
}
scenario('TASK_409_SSE_DRAFT_PRESERVED', async () => { await conflict('tasks', task.task.id) })

scenario('LINKED_SCHEDULE_409_SSE_DRAFT_PRESERVED', async () => {
  schedule = await linkedScheduleUi(a, task.task.id)
  check(schedule.spaceId === shared.id && schedule.projectId === project.id && schedule.assigneeId === a.memberId && schedule.schedule.taskId === task.task.id, 'LINKED_SERVER_AFFILIATION_REQUIRED')
  await conflict('schedules', schedule.schedule.id)
})

scenario('SHARED_SCHEDULE_COMMON_STATE', async () => {
  await route(a.page, '/app/today')
  const card = a.page.getByRole('article', { name: '다른 참여자가 먼저 저장한 일정', exact: true }).filter({ has: a.page.locator('.schedule-card__state-icon') })
  await mutation(a.page, `/v2/workspace/schedules/${schedule.schedule.id}/state`, 'POST', () => card.getByRole('button', { name: /미시작 상태/ }).click())
  await waitUntil(() => getSchedule(b, schedule.schedule.id), (value) => value.schedule.state === 'IN_PROGRESS', 'SHARED_RUNNING_REQUIRED')
  const controls = a.page.getByRole('group', { name: '일정 조작', exact: true })
  await mutation(a.page, `/v2/workspace/schedules/${schedule.schedule.id}/state`, 'POST', () => controls.getByRole('button', { name: '일시정지', exact: true }).click())
  await expect(controls.getByRole('button', { name: '완료', exact: true })).toBeDisabled()
  check((await getSchedule(b, schedule.schedule.id)).allowedActions.complete === false, 'SUSPENDED_COMPLETE_FORBIDDEN')
  await mutation(a.page, `/v2/workspace/schedules/${schedule.schedule.id}/state`, 'POST', () => controls.getByRole('button', { name: '재개', exact: true }).click())
  const stateWrites = observations.get(a.page).states
  await mutation(a.page, `/v2/workspace/schedules/${schedule.schedule.id}/state`, 'POST', () => controls.getByRole('button', { name: '완료', exact: true }).click())
  const completed = await waitUntil(() => getTask(a, task.task.id), (value) => value.task.completed || value.task.isCompleted, 'LINKED_TASK_COMPLETION_REQUIRED')
  check(completed.task.completed || completed.task.isCompleted, 'LINKED_TASK_COMPLETION_REQUIRED')
  check(observations.get(a.page).states === stateWrites, 'DUPLICATE_CLIENT_TASK_STATE_WRITE')
  check((await getSchedule(b, schedule.schedule.id)).schedule.state === 'COMPLETED', 'SHARED_COMPLETION_REQUIRED')
})

scenario('RUNNING_MOVE_DETACH_CACHE_EVICTION', async () => {
  const previous = await createTaskUi(a, { title: '이전 공간에 남을 선행 작업', spaceId: shared.id })
  await route(a.page, `/app/tasks/${previous.task.id}`)
  await mutation(a.page, `/v2/workspace/tasks/${previous.task.id}/state`, 'POST', () => a.page.getByRole('button', { name: '완료 처리', exact: true }).click())
  const moving = await createTaskUi(a, { title: '실행 중 옮길 공동 작업', spaceId: shared.id, projectId: project.id })
  await route(a.page, `/app/tasks/${moving.task.id}/edit`)
  const dep = a.page.locator('.task-form__dependency').filter({ has: a.page.getByRole('heading', { name: '이전 작업', exact: true }) })
  await dep.getByRole('button', { name: '선택', exact: true }).click()
  const dependencyDialog = a.page.getByRole('dialog', { name: '이전에 해야 할 작업 선택', exact: true })
  await dependencyDialog.getByRole('searchbox', { name: '작업 검색', exact: true }).fill(previous.task.title)
  await dependencyDialog.getByRole('checkbox', { name: new RegExp(previous.task.title) }).check()
  await dependencyDialog.getByRole('button', { name: '추가', exact: true }).click()
  await mutation(a.page, `/v2/workspace/tasks/${moving.task.id}`, 'PATCH', () => a.page.getByRole('button', { name: '작업 수정', exact: true }).click())
  const linked = await linkedScheduleUi(a, moving.task.id)
  await route(a.page, '/app/today')
  await mutation(a.page, `/v2/workspace/schedules/${linked.schedule.id}/state`, 'POST', () => a.page.getByRole('article', { name: moving.task.title, exact: true }).filter({ has: a.page.locator('.schedule-card__state-icon') }).getByRole('button', { name: /미시작 상태/ }).click())
  check((await ownedApi(a, '/v2/members/now')).data === linked.schedule.id, 'MOVE_RUNNER_POINTER_REQUIRED')
  await route(b.page, `/app/tasks/${moving.task.id}`)
  await expect(b.page.getByRole('heading', { name: moving.task.title, exact: true })).toBeVisible()
  const schedulePage = await contexts[1].newPage()
  observe(schedulePage)
  await route(schedulePage, `/app/schedules/${linked.schedule.id}`)
  await expect(schedulePage.getByRole('heading', { name: linked.schedule.title, exact: true })).toBeVisible()
  await route(a.page, `/app/tasks/${moving.task.id}/edit`)
  await a.page.getByRole('group', { name: '소속·담당자', exact: true }).getByLabel(/^공간/).selectOption(String(a.defaultSpaceId))
  await a.page.getByRole('button', { name: '작업 수정', exact: true }).click()
  const { data: moved } = await mutation(a.page, `/v2/workspace/tasks/${moving.task.id}`, 'PATCH', () => a.page.getByRole('dialog', { name: '다른 공간으로 옮길까요?', exact: true }).getByRole('button', { name: '확인하고 이동', exact: true }).click())
  check(moved.spaceId === a.defaultSpaceId && moved.moveResult?.removedDependencyCount === 1, 'ATOMIC_MOVE_DETACH_REQUIRED')
  const after = await getSchedule(a, linked.schedule.id)
  check(after.spaceId === a.defaultSpaceId && after.schedule.state === 'IN_PROGRESS', 'RUNNING_LINKED_MOVE_REQUIRED')
  check((await ownedApi(a, '/v2/members/now')).data === linked.schedule.id, 'MOVE_RUNNER_POINTER_REQUIRED')
  await expect(b.page.getByRole('heading', { name: moving.task.title, exact: true })).toHaveCount(0)
  await expect(schedulePage.getByRole('heading', { name: linked.schedule.title, exact: true })).toHaveCount(0)
  await expect(schedulePage.locator('.mini-player__description').filter({ hasText: linked.schedule.title })).toHaveCount(0)
  const forbiddenTask = await ownedApi(b, `/v2/workspace/tasks/${moving.task.id}`, { expected: [403, 404] })
  check([403, 404].includes(forbiddenTask.status) && (await snapshot(b, shared.id)).members.some((member) => member.memberId === b.memberId), 'RESOURCE_EVICT_WITH_MEMBERSHIP_REQUIRED')
  await schedulePage.close()
  // Finish only our own running item so the next scenario has a clear player.
  await route(a.page, '/app/today')
  await expect(a.page.locator('.mini-player')).toBeVisible()
  await mutation(a.page, `/v2/workspace/schedules/${linked.schedule.id}/state`, 'POST', () => a.page.getByRole('group', { name: '일정 조작', exact: true }).getByRole('button', { name: '취소하고 미시작으로', exact: true }).click())
})

scenario('PROJECT_MOVE_CHILDREN_AND_OLD_MEMBER', async () => {
  const moving = await createTaskUi(a, { title: '프로젝트와 함께 이동할 작업', spaceId: shared.id, projectId: project.id })
  const linked = await linkedScheduleUi(a, moving.task.id)
  projectTask = moving
  projectSchedule = linked
  await route(b.page, `/app/tasks/${moving.task.id}`)
  await expect(b.page.getByRole('heading', { name: moving.task.title, exact: true })).toBeVisible()
  const schedulePage = await contexts[1].newPage()
  observe(schedulePage)
  await route(schedulePage, `/app/schedules/${linked.schedule.id}`)
  await expect(schedulePage.getByRole('heading', { name: linked.schedule.title, exact: true })).toBeVisible()
  await manage(a.page, shared.name, '프로젝트')
  await projectRow(a.page, project.name).getByRole('button', { name: '공간 이동', exact: true }).click()
  const dialog = a.page.getByRole('dialog', { name: '프로젝트 공간 이동', exact: true })
  await dialog.getByLabel(/^이동할 공간/).selectOption(String(destination.id))
  await mutation(a.page, `/v2/projects/${project.id}/move`, 'POST', () => dialog.getByRole('button', { name: '확인하고 이동', exact: true }).click())
  check((await getTask(a, moving.task.id)).spaceId === destination.id && (await getSchedule(a, linked.schedule.id)).spaceId === destination.id, 'PROJECT_CHILDREN_MOVE_REQUIRED')
  await expect(b.page.getByRole('heading', { name: moving.task.title, exact: true })).toHaveCount(0)
  await expect(schedulePage.getByRole('heading', { name: linked.schedule.title, exact: true })).toHaveCount(0)
  check((await snapshot(b, shared.id)).members.some((member) => member.memberId === b.memberId), 'RESOURCE_EVICT_WITH_MEMBERSHIP_REQUIRED')
  await schedulePage.close()
})

scenario('ADMIN_TRASH_SPACE_PROJECT_RESTORE', async () => {
  await manage(a.page, shared.name)
  await expect(a.page.getByRole('button', { name: '공간 나가기', exact: true })).toBeDisabled()
  await manage(b.page, shared.name)
  await expect(b.page.getByRole('button', { name: '공간 삭제', exact: true })).toBeDisabled()
  const disposable = await createTaskUi(a, { title: '관리자가 복구할 작업', spaceId: shared.id })
  await route(b.page, `/app/tasks/${disposable.task.id}`)
  await expect(b.page.getByRole('button', { name: '삭제', exact: true })).toBeDisabled()
  await route(a.page, `/app/tasks/${disposable.task.id}`)
  await mutation(a.page, `/v2/workspace/tasks/${disposable.task.id}`, 'DELETE', () => a.page.getByRole('button', { name: '삭제', exact: true }).click())
  await route(a.page, '/app/settings/trash')
  await expect(a.page.getByRole('heading', { name: '휴지통', exact: true })).toBeVisible()
  const trashRow = a.page.locator('.trash__item').filter({ hasText: disposable.task.title })
  await mutation(a.page, `/v2/workspace/tasks/${disposable.task.id}/restore`, 'POST', () => trashRow.getByRole('button', { name: '복구', exact: true }).click())
  check((await getTask(a, disposable.task.id)).task.title === disposable.task.title, 'TASK_RESTORE_REQUIRED')
  const restoreSchedule = await linkedScheduleUi(a, disposable.task.id)
  await route(a.page, `/app/schedules/${restoreSchedule.schedule.id}`)
  await mutation(a.page, `/v2/workspace/schedules/${restoreSchedule.schedule.id}`, 'DELETE', () => a.page.getByRole('button', { name: '삭제', exact: true }).click())
  await route(a.page, '/app/settings/trash')
  const scheduleTrash = a.page.locator('.trash__item').filter({ hasText: restoreSchedule.schedule.title })
  await mutation(a.page, `/v2/workspace/schedules/${restoreSchedule.schedule.id}/restore`, 'POST', () => scheduleTrash.getByRole('button', { name: '복구', exact: true }).click())
  check((await getSchedule(a, restoreSchedule.schedule.id)).schedule.id === restoreSchedule.schedule.id, 'SCHEDULE_RESTORE_REQUIRED')
  await manage(a.page, destination.name, '프로젝트')
  await projectRow(a.page, project.name).getByRole('button', { name: '삭제', exact: true }).click()
  await confirm(a.page, '프로젝트 삭제')
  await a.page.reload({ waitUntil: 'domcontentloaded' })
  await spacesReady(a.page)
  await a.page.getByRole('button', { name: '삭제 항목', exact: true }).click()
  const projectTrash = a.page.locator('.space-manager-row').filter({ hasText: project.name })
  await mutation(a.page, `/v2/projects/${project.id}/restore`, 'POST', () => projectTrash.getByRole('button', { name: '복구', exact: true }).click())
  check((await snapshot(a, destination.id)).projects.some((item) => item.id === project.id && !item.deletedAt), 'PROJECT_RESTORE_REQUIRED')
  await manage(a.page, destination.name)
  await a.page.getByRole('button', { name: '공간 삭제', exact: true }).click()
  await confirm(a.page, '공간 삭제')
  await a.page.reload({ waitUntil: 'domcontentloaded' })
  await spacesReady(a.page)
  await a.page.getByRole('button', { name: '삭제 항목', exact: true }).click()
  const spaceTrash = a.page.locator('.space-manager-row').filter({ hasText: destination.name })
  await mutation(a.page, `/v2/spaces/${destination.id}/restore`, 'POST', () => spaceTrash.getByRole('button', { name: '복구', exact: true }).click())
  check(!(await snapshot(a, destination.id)).space.deletedAt, 'SPACE_RESTORE_REQUIRED')
})

scenario('PURPOSE_CLEAR_PRESERVES_RESOURCES', async () => {
  const before = await snapshot(a, destination.id)
  await manage(a.page, destination.name)
  await a.page.getByRole('button', { name: '목적 내용 삭제', exact: true }).click()
  await confirm(a.page, '목적 내용 삭제')
  const after = await snapshot(a, destination.id)
  check(after.space.purpose == null && after.projects.length === before.projects.length && !after.space.deletedAt, 'PURPOSE_CLEAR_PRESERVES_RESOURCES')
  check((await getTask(a, projectTask.task.id)).task.id === projectTask.task.id && (await getSchedule(a, projectSchedule.schedule.id)).schedule.id === projectSchedule.schedule.id, 'PURPOSE_CLEAR_PRESERVES_RESOURCES')
  await expect(a.page.getByRole('button', { name: '목적 작성·수정', exact: true })).toBeEnabled()
})

scenario('ADMIN_DELEGATE_REMOVE_LAST_ADMIN', async () => {
  await manage(a.page, shared.name)
  await expect(a.page.getByRole('button', { name: '공간 나가기', exact: true })).toBeDisabled()
  await a.page.getByRole('button', { name: '참여자', exact: true }).click()
  await mutation(a.page, `/v2/spaces/${shared.id}/members/${b.memberId}/role`, 'PATCH', () => memberRow(a.page, b.nickname).getByRole('button', { name: '관리자 지정', exact: true }).click())
  await manage(a.page, shared.name)
  await expect(a.page.getByRole('button', { name: '공간 나가기', exact: true })).toBeEnabled()
  await manage(b.page, shared.name, '참여자')
  await memberRow(b.page, a.nickname).getByRole('button', { name: '제외', exact: true }).click()
  await confirm(b.page, '참여자 제외')
  await manage(b.page, shared.name)
  await expect(b.page.getByRole('button', { name: '공간 나가기', exact: true })).toBeDisabled()
  await waitUntil(() => ownedApi(a, `/v2/spaces/${shared.id}/snapshot`, { expected: [200, 403, 404] }), (value) => [403, 404].includes(value.status), 'MEMBERSHIP_REMOVAL_REQUIRED')
})

scenario('OAUTH_EXPLICIT_SPACES_OPT_IN', async () => { await oauthUi(b) })

scenario('MOBILE_KEYBOARD_DARK_FINAL_EVIDENCE', async () => {
  await route(b.page, '/app/spaces')
  await spacesReady(b.page)
  await assertNoOverflow(b.page)
  await captureFinalSpace(b.page, 'spaces-desktop')
  await b.page.setViewportSize({ width: 390, height: 400 })
  await b.page.getByRole('button', { name: '공간 만들기', exact: true }).click()
  const dialog = b.page.getByRole('dialog', { name: '목적 공간 만들기', exact: true })
  const name = dialog.getByLabel('공간 이름', { exact: true })
  await expect(name).toBeFocused()
  // Native empty-name validation must focus the actual labelled field.
  await dialog.getByRole('button', { name: '만들기', exact: true }).click()
  await expect(name).toBeFocused()
  check(await name.evaluate((element) => element.validity.valueMissing), 'ERROR_FIELD_FOCUS_REQUIRED')
  await name.fill('   ')
  await dialog.getByRole('button', { name: '만들기', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(name).toBeFocused()
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  check(Boolean(await name.getAttribute('aria-describedby')), 'ERROR_FIELD_DESCRIPTION_REQUIRED')
  await name.fill('모바일에서 취소할 초안')
  await name.press('Tab')
  await expect(dialog.getByLabel(/^이 공간의 목적/)).toBeFocused()
  await dialog.getByLabel(/^이 공간의 목적/).fill('짧은 화면에서도 입력하고 취소한다'.repeat(30))
  const cancel = dialog.getByRole('button', { name: '취소', exact: true })
  await cancel.scrollIntoViewIfNeeded()
  const box = await cancel.boundingBox()
  check(box && box.y >= 0 && box.y + box.height <= 401, 'MOBILE_MODAL_FOOTER_REQUIRED')
  await assertNoOverflow(b.page)
  await cancel.click()
  await expect(dialog).toHaveCount(0)
  await captureFinalSpace(b.page, 'spaces-mobile')
  await b.page.emulateMedia({ colorScheme: 'dark' })
  await b.page.reload({ waitUntil: 'domcontentloaded' })
  await spacesReady(b.page)
  check(await b.page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), 'DARK_SCHEME_REQUIRED')
  await assertNoOverflow(b.page)
  await captureFinalSpace(b.page, 'spaces-dark')
})
