import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 작업 쪼개기 화면 확인. 모든 응답은 개발 서버의 내장 mock(VITE_USE_MOCK_API)이 만든다. 실제 서버를 부르지 않는다.
process.env.VITE_USE_MOCK_API = 'true'
const { createServer } = await import('vite')
const { chromium } = createRequire(import.meta.url)('playwright')

const origin = 'http://127.0.0.1:5197'
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = fileURLToPath(new URL('./screenshots/', import.meta.url))
const viewports = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
}

const server = await createServer({
  root,
  clearScreen: false,
  server: { host: '127.0.0.1', port: 5197, strictPort: true },
})
await server.listen()

const errors = []
const counters = {}

/**
 * 한 단계를 걷고 캡처한다. 캡처 이름은 `{viewport}-{두 자리 번호}-{name}.png`이고 번호는 뷰포트마다 1부터 센다.
 * 모바일에서는 가로로 넘치지 않는지도 본다. B단계가 이 도우미로 뒤 흐름을 잇는다.
 */
const step = async (page, viewport, name, run) => {
  await run()
  // 열리고 닫히는 움직임이 끝난 뒤에 찍는다. 도는 표시처럼 끝없는 움직임은 기다리지 않는다.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity),
  )
  counters[viewport] = (counters[viewport] ?? 0) + 1
  const number = String(counters[viewport]).padStart(2, '0')
  if (viewport === 'mobile') {
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    assert.ok(width <= viewports.mobile.width, `${name}: 가로로 넘친다(${width}px)`)
  }
  await page.screenshot({ path: path.join(output, `${viewport}-${number}-${name}.png`) })
  console.log(`ok ${viewport} ${number} ${name}`)
}

/** 화면에 보이는 문구. 여러 군데에 있으면 보이는 것 하나면 된다. */
const visible = (scope, text) => scope.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor()
const button = (scope, name) => scope.getByRole('button', { name, exact: true }).filter({ visible: true }).first()
const detail = (page) => page.locator('.route-surface')
const confirmDialog = (page) => page.locator('.confirm-dialog')
const toast = (page, text) => page.locator('.toast').filter({ hasText: text }).first().waitFor()
const inboxRow = (page, title) => page.locator('.split-row').filter({ hasText: title })

const login = async (page) => {
  await page.goto(`${origin}/login`)
  await page.getByPlaceholder('아이디를 입력하세요').fill('demo')
  await page.getByPlaceholder('비밀번호를 입력하세요').fill('demo1234')
  await button(page, '로그인').click()
  await page.waitForURL(/\/app\//)
  // 처음 들어오면 뜨는 둘러보기를 닫는다.
  const skip = page.getByRole('button', { name: '건너뛰기', exact: true })
  await skip.waitFor({ timeout: 3000 }).then(() => skip.click(), () => {})
  // 단계 사이의 시간에 결과가 흔들리지 않게 자동 준비를 끈다.
  await page.waitForFunction(() => window.__pinitMock?.split)
  await page.evaluate(() => window.__pinitMock.split.setAutoFinish(null))
}

const switchSpace = async (page, name) => {
  await page.locator('.space-switcher').filter({ visible: true }).first().click()
  await page.locator('.space-option').filter({ hasText: name }).first().click()
  // 팀 스페이스를 고르면 프로젝트 목록이 펼쳐진다. 스페이스 전체를 고른다.
  const dialog = page.locator('.space-dialog--switcher')
  await dialog.waitFor({ state: 'detached', timeout: 1500 }).catch(async () => {
    await button(dialog, '스페이스의 모든 작업').click()
    await dialog.waitFor({ state: 'detached' })
  })
}

const openTask = async (page, title) => {
  await button(page, title).click()
  await detail(page).getByRole('heading', { name: title }).waitFor()
}

const closeTask = async (page) => {
  await detail(page).getByRole('button', { name: '닫기', exact: true }).click()
  await detail(page).waitFor({ state: 'detached' })
}

const walk = async (page, viewport) => {
  await step(page, viewport, 'task-list', async () => {
    await page.getByRole('link', { name: '작업', exact: true }).filter({ visible: true }).first().click()
    await switchSpace(page, '개인')
    const entry = page.locator('.split-inbox-link').filter({ visible: true }).first()
    await entry.waitFor()
    assert.match(await entry.innerText(), /쪼개기 보관함\s*7/)
    for (const text of ['4시간 이상 · 쪼개기', '쪼개는 중', '쪼개기 제안 준비됨']) await visible(page.locator('main'), text)
    // 쪼개기 표시가 있는 카드가 화면에 들어오게 한다.
    await page.locator('.split-chip').filter({ visible: true }).first().scrollIntoViewIfNeeded()
  })

  await step(page, viewport, 'detail-offer', async () => {
    await openTask(page, '사내 위키 이전 계획')
    await button(detail(page), '쪼개기').waitFor()
    await visible(detail(page), '예상 시간이 4시간 이상이에요.')
  })

  await step(page, viewport, 'consent', async () => {
    await button(detail(page), '쪼개기').click()
    const dialog = page.locator('.split-consent')
    for (const text of ['쪼개기에 AI를 써요', '보내는 것', '보내지 않는 것']) await visible(dialog, text)
    await button(dialog, '동의하고 쪼개기').waitFor()
  })

  await step(page, viewport, 'submitted', async () => {
    await button(page.locator('.split-consent'), '동의하고 쪼개기').click()
    await toast(page, '쪼개기를 맡겼어요. 준비되면 알려 드릴게요.')
    await visible(detail(page), '쪼개는 중이에요')
    await button(detail(page), '요청 취소').waitFor()
  })

  await step(page, viewport, 'cancel-confirm', async () => {
    await button(detail(page), '요청 취소').click()
    await visible(confirmDialog(page), '쪼개기 요청을 취소할까요?')
    await visible(confirmDialog(page), '취소해도 횟수는 돌아오지 않아요.')
    // 처음 초점은 물러서는 쪽에 있다.
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), '그대로 두기')
  })
  await button(confirmDialog(page), '그대로 두기').click()
  await confirmDialog(page).waitFor({ state: 'detached' })
  await closeTask(page)

  await step(page, viewport, 'detail-linked', async () => {
    await openTask(page, '이사 준비')
    assert.equal(await button(detail(page), '쪼개기').isDisabled(), true)
    await visible(detail(page), '일정에 넣은 작업은 쪼갤 수 없어요.')
  })
  await closeTask(page)

  await step(page, viewport, 'request-confirm', async () => {
    await openTask(page, '여행 계획 세우기')
    await button(detail(page), '쪼개기').click()
    await visible(confirmDialog(page), '쪼개기를 맡길까요?')
    await visible(confirmDialog(page), '오늘 3번 중 1번을 써요.')
  })
  // Esc로도 닫힌다(나중에와 같다).
  await page.keyboard.press('Escape')
  await confirmDialog(page).waitFor({ state: 'detached' })
  await closeTask(page)

  await step(page, viewport, 'detail-other-lock', async () => {
    await switchSpace(page, '제품팀')
    await openTask(page, '결제 화면 리팩터링')
    await visible(detail(page), '김서연님이 쪼개는 중이에요.')
    const actions = await detail(page).locator('.task-detail-modal__actions button').allInnerTexts()
    for (const name of ['수정', '삭제', '요청 취소']) assert.ok(!actions.some((text) => text.includes(name)), `${name} 버튼이 있다`)
  })
  await closeTask(page)

  await step(page, viewport, 'inbox', async () => {
    await page.locator('.split-inbox-link').filter({ visible: true }).first().click()
    await page.waitForURL(/\/app\/tasks\/splits$/)
    for (const text of ['오늘 3번 중', '준비됨', '쪼개는 중', '실패', '횟수는 돌려 드렸어요.']) await visible(page.locator('main'), text)
  })

  await step(page, viewport, 'discard-confirm-refunded', async () => {
    await button(inboxRow(page, '데이터 이전 리허설'), '버리기').click()
    await visible(confirmDialog(page), '횟수는 이미 돌려 드렸어요. 이 제안을 버릴까요?')
  })
  await button(confirmDialog(page), '제안 버리기').click()
  await toast(page, '제안을 버렸어요.')
  await inboxRow(page, '데이터 이전 리허설').waitFor({ state: 'detached' })

  await step(page, viewport, 'discard-failed', async () => {
    await button(inboxRow(page, '연말 회고 자료'), '버리기').click()
    await inboxRow(page, '연말 회고 자료').waitFor({ state: 'detached' })
    assert.equal(await confirmDialog(page).count(), 0)
  })

  await step(page, viewport, 'ready-signal', async () => {
    const row = inboxRow(page, '사내 위키 이전 계획')
    await row.getByText('쪼개는 중').waitFor()
    await page.evaluate(() => {
      const { fixtures, requests, finish } = window.__pinitMock.split
      const request = requests.find((item) => item.taskId === fixtures.free.taskId)
      finish(request.requestId, 'READY')
    })
    await row.getByText('준비됨', { exact: true }).waitFor()
  })
}

let browser
try {
  await mkdir(output, { recursive: true })
  browser = await chromium.launch()
  for (const [viewport, size] of Object.entries(viewports)) {
    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 2,
      timezoneId: 'Asia/Seoul',
      serviceWorkers: 'block',
    })
    context.setDefaultTimeout(10_000)
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(`${viewport} pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${viewport} console: ${message.text()}`)
    })
    await login(page)
    await walk(page, viewport)
    await context.close()
  }
  assert.deepEqual(errors, [], `브라우저 오류:\n${errors.join('\n')}`)
  console.log('task-split local check passed')
} finally {
  await browser?.close()
  await server.close()
}
