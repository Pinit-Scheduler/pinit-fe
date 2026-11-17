import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 작업 쪼개기 화면 확인. 모든 응답은 개발 서버의 내장 mock(VITE_USE_MOCK_API)이 만든다. 실제 서버를 부르지 않는다.
process.env.VITE_USE_MOCK_API = 'true'
const { createServer } = await import('vite')
// Playwright는 qa/plan-integration처럼 qa/browser/package.json에 고정한 것을 먼저 쓴다.
// 그것이 설치돼 있지 않으면 이 환경이 이미 갖춘 playwright 모듈을 쓴다.
const loadPlaywright = () => {
  try {
    return createRequire(new URL('../browser/package.json', import.meta.url))('playwright')
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error
    return createRequire(import.meta.url)('playwright')
  }
}
const { chromium } = loadPlaywright()

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
/**
 * 일부러 거부시킨 만들기(`failNextApply`)와 없는 요청 열기(404)의 응답은 앱의 HTTP 도우미가 console.error로 남긴다.
 * 그 창 안에서 그 경로의 오류 기록만 기대한 것으로 따로 세고(뷰포트마다, 경우마다 줄 수를 맞춘다), 그 밖의 console error는 모두 실패로 본다.
 */
let expectingRejection = null
const expectedRejections = []
const counters = {}

/**
 * 한 단계를 걷고 캡처한다. 캡처 이름은 `{viewport}-{두 자리 번호}-{name}.png`이고 번호는 뷰포트마다 1부터 센다.
 * 두 뷰포트 모두 페이지가 가로로 넘치지 않는지 본다(지도 상자 안의 스크롤은 페이지 너비에 들지 않는다).
 * `dark: true`면 같은 화면을 어두운 테마로도 찍는다(`{…}-dark.png`).
 */
const step = async (page, viewport, name, run, { dark = false } = {}) => {
  try {
    await run()
  } catch (error) {
    // 실패한 화면을 남긴다(캡처 폴더가 아니라 QA_FAILED_DIR 또는 운영체제 임시 폴더).
    const failed = path.join(process.env.QA_FAILED_DIR ?? os.tmpdir(), `${viewport}-${name}-failed.png`)
    await page.screenshot({ path: failed }).catch(() => {})
    console.log(`failed ${viewport} ${name} (화면: ${failed})`)
    throw error
  }
  await settle(page)
  counters[viewport] = (counters[viewport] ?? 0) + 1
  const number = String(counters[viewport]).padStart(2, '0')
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  assert.ok(width <= viewports[viewport].width, `${name}: 가로로 넘친다(${width}px)`)
  const file = `${viewport}-${number}-${name}`
  await page.screenshot({ path: path.join(output, `${file}.png`) })
  if (dark) {
    // 테마는 src/shared/theme/theme.ts처럼 html의 data-theme으로 바꾼다. 이 탭에서만 바꾸고 저장하지 않는다.
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await settle(page)
    await page.screenshot({ path: path.join(output, `${file}-dark.png`) })
    await page.evaluate(() => {
      delete document.documentElement.dataset.theme
    })
  }
  console.log(`ok ${viewport} ${number} ${name}`)
}

/** 열리고 닫히는 움직임이 끝날 때까지 기다린다. 도는 표시처럼 끝없는 움직임은 기다리지 않는다. */
const settle = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity),
  )

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
    // 바뀌는 줄이 화면에 들어오게 한다.
    await row.scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      const { fixtures, requests, finish } = window.__pinitMock.split
      const request = requests.find((item) => item.taskId === fixtures.free.taskId)
      finish(request.requestId, 'READY')
    })
    await row.getByText('준비됨', { exact: true }).waitFor()
  })
}

// ---------------------------------------------------------------------------
// B단계: 알림함, 제안 화면(다듬기·검사·만들기·되돌리기), 거부 화면, 읽음 재호출, 알림 설정
// ---------------------------------------------------------------------------

/** 리뷰가 브라우저에서 봐 달라고 한 것(지도, 조각 창, 층, 종, 긴 설명)의 측정값. 끝에 한꺼번에 찍는다. */
const notes = []
const note = (viewport, name, value) => {
  const line = `${viewport} ${name}: ${JSON.stringify(value)}`
  notes.push(line)
  if (process.env.QA_VERBOSE) console.log(`note ${line}`)
}

const bell = (page) => page.locator('.split-topbar').filter({ visible: true }).first()
const unreadOf = async (page) => {
  const label = (await bell(page).getAttribute('aria-label')) ?? ''
  return Number(label.match(/새 알림 (\d+)개/)?.[1] ?? 0)
}
const proposal = (page) => page.locator('.split-page--proposal')
const mapNodes = (page) => page.locator('.split-map__node')
const mapNode = (page, title) =>
  mapNodes(page).filter({ has: page.getByRole('button', { name: title, exact: true }) })
const pieceDialog = (page) => page.locator('.split-dialog--piece')
const toolbar = (page) => page.locator('.split-toolbar')
const summaryBar = (page) => page.locator('.split-apply')
const applyButton = (page) => summaryBar(page).getByRole('button', { name: /^(만들기|만드는 중…)$/ })
const toastAction = (page, text) =>
  page.locator('.toast').filter({ hasText: text }).first().getByRole('button', { name: '되돌리기', exact: true })
const droppedRow = (page, title) => page.locator('.split-dropped li').filter({ hasText: title })
const topBack = (page) => page.getByRole('button', { name: '뒤로가기', exact: true }).filter({ visible: true }).first()
const navLink = (page, name) => page.getByRole('link', { name, exact: true }).filter({ visible: true }).first()
const mock = (page, run, arg) => page.evaluate(run, arg)
/** `failNextApply(kind)`를 걸고 만들기를 누른다. 그 응답의 console 기록은 기대한 것으로 센다. */
const applyRejected = async (page, kind, settled) => {
  await mock(page, (value) => window.__pinitMock.split.failNextApply(value), kind)
  expectingRejection = { label: kind, url: /\/v2\/task-splits\/\d+\/apply\b/ }
  try {
    await applyButton(page).click()
    await settled()
  } finally {
    expectingRejection = null
  }
}
const activeElement = (page) =>
  page.evaluate(() => {
    const element = document.activeElement
    if (!element || element === document.body) return 'body'
    return `${element.tagName.toLowerCase()}${element.getAttribute('aria-label') ? `[${element.getAttribute('aria-label')}]` : ''} ${(element.textContent ?? '').trim().slice(0, 12)}`
  })

/** 지도의 모든 조각을 바로 보이고 이름을 센다. */
const mapTitles = (page) => page.locator('.split-map__title').allInnerTexts()

const openPiece = async (page, title) => {
  await mapNode(page, title).getByRole('button', { name: title, exact: true }).click()
  await pieceDialog(page).getByRole('heading', { name: '조각 내용' }).waitFor()
}
const closePiece = async (page) => {
  await pieceDialog(page).getByRole('button', { name: '닫기', exact: true }).click()
  await pieceDialog(page).waitFor({ state: 'detached' })
}
const startEditing = async (page) => {
  await button(pieceDialog(page), '고치기').click()
  await pieceDialog(page).getByRole('heading', { name: '조각 고치기' }).waitFor()
}
const titleInput = (page) => pieceDialog(page).locator('.split-form > label').first().locator('input')

/** 한 요청의 처리를 끝낸다(`__pinitMock.split.finish`). fixture 이름이나 원본 제목으로 찾는다. */
const finishRequest = (page, { fixture, title }, status) =>
  mock(
    page,
    ({ fixture, title, status }) => {
      const { fixtures, requests, finish } = window.__pinitMock.split
      const taskId = fixture ? fixtures[fixture].taskId : undefined
      const request = [...requests]
        .reverse()
        .find((item) => (taskId != null ? item.taskId === taskId : item.originalTitle === title))
      finish(request.requestId, status)
      return request.requestId
    },
    { fixture, title, status },
  )

/** 종의 aria-label이 바뀔 때마다 적는다. 늘었다가 다시 줄어드는 짧은 순간도 놓치지 않는다. */
const watchBell = (page) =>
  page.evaluate(() => {
    const target = [...document.querySelectorAll('.split-topbar')].find((element) => element.offsetParent !== null)
    const seen = [{ at: Date.now(), label: target.getAttribute('aria-label') }]
    window.__bellSeen = seen
    new MutationObserver(() => seen.push({ at: Date.now(), label: target.getAttribute('aria-label') })).observe(target, {
      attributes: true,
      attributeFilter: ['aria-label'],
    })
  })
const bellSeen = (page) =>
  page.evaluate(() =>
    window.__bellSeen.map(({ at, label }) => ({ at, count: Number(label?.match(/새 알림 (\d+)개/)?.[1] ?? 0) })),
  )

const walkProposal = async (page, viewport) => {
  const size = viewports[viewport]
  let baseline = 0

  await step(page, viewport, 'bell', async () => {
    // 안 읽은 것: 온보딩 개편 설계의 준비 알림과 12번에서 준비된 사내 위키 이전 계획의 알림(1.5초 뒤 생기고, 종은 작업 변경
    // 3초 뒤에 다시 읽는다). 실패 알림은 9번에서 보관함을 열 때 읽었다.
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.split-topbar')].some((item) => item.offsetParent !== null && item.getAttribute('aria-label') === '알림, 새 알림 2개'),
    )
    const label = await bell(page).getAttribute('aria-label')
    assert.match(label, /^알림, 새 알림/)
    const badge = page.locator('.split-badge').filter({ visible: true }).first()
    // 종 옆에 보이는 숫자 자체도 2다.
    assert.equal((await badge.innerText()).trim(), '2')
    note(viewport, 'bell', {
      label,
      badge: await badge.innerText(),
      badgeColors: await badge.evaluate((element) => {
        const style = getComputedStyle(element)
        return { color: style.color, background: style.backgroundColor }
      }),
    })
  })

  await step(page, viewport, 'notice-panel', async () => {
    await bell(page).click()
    const panel = page.locator('.split-panel')
    for (const text of ['쪼개기 제안이 준비됐어요', '온보딩 개편 설계', '쪼개기 보관함 열기']) await visible(panel, text)
    await panel.getByRole('heading', { name: '알림', exact: true }).waitFor()
    await settle(page)
    const box = await panel.boundingBox()
    const bellBox = await bell(page).boundingBox()
    if (viewport === 'mobile') {
      // 좁은 화면은 아래에서 올라온 시트다.
      assert.ok(Math.abs(box.y + box.height - size.height) <= 1, `시트가 바닥에 붙지 않았다(${JSON.stringify(box)})`)
      assert.ok(Math.abs(box.width - size.width) <= 1, `시트가 화면 너비가 아니다(${box.width})`)
    } else {
      // 넓은 화면은 종 아래에 붙는다.
      assert.ok(box.y >= bellBox.y + bellBox.height - 1 && box.y <= bellBox.y + bellBox.height + 24, `패널이 종 아래가 아니다(${JSON.stringify({ box, bellBox })})`)
    }
    note(viewport, 'notice-panel', {
      panel: box,
      bell: bellBox,
      background: await panel.evaluate((element) => getComputedStyle(element).backgroundColor),
      scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    })
  })

  await step(
    page,
    viewport,
    'proposal-map',
    async () => {
      baseline = await unreadOf(page)
      await page.locator('.split-panel .notice').filter({ hasText: '온보딩 개편 설계' }).click()
      await page.waitForURL(/\/app\/tasks\/splits\/\d+$/)
      await proposal(page).waitFor()
      for (const text of ['쪼개기 제안', '온보딩 개편 설계', '조각 합계', '뺀 조각 2개']) await visible(proposal(page), text)
      await mapNodes(page).nth(4).waitFor()
      assert.equal(await mapNodes(page).count(), 5)
      assert.match(await summaryBar(page).innerText(), /5개 ·/)
      await applyButton(page).waitFor()
      await page.waitForFunction(
        (before) => {
          const label = [...document.querySelectorAll('.split-topbar')].find((element) => element.offsetParent !== null)?.getAttribute('aria-label') ?? ''
          return Number(label.match(/새 알림 (\d+)개/)?.[1] ?? 0) < before
        },
        baseline,
      ).catch(async (error) => {
        note(viewport, 'proposal-map bells', await page.locator('.split-topbar').evaluateAll((items) => items.map((item) => [item.getAttribute('aria-label'), item.offsetParent !== null])))
        throw error
      })
      note(viewport, 'proposal-map unread', { before: baseline, after: await unreadOf(page) })
      baseline = await unreadOf(page)
      const box = page.locator('.split-map')
      note(viewport, 'split-map', {
        box: await box.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth })),
        edges: await page.locator('.split-map .tm-edges > path').count(),
        times: await page.locator('.split-map__meta time').allInnerTexts(),
      })
    },
    { dark: true },
  )

  await step(page, viewport, 'proposal-list', async () => {
    await button(toolbar(page), '목록').click()
    await page.locator('.split-stages').waitFor()
    assert.deepEqual(await page.locator('.split-stage__label').allInnerTexts(), ['1', '2', '3', '4'])
    assert.equal(await page.locator('.split-stages .split-piece').count(), 5)
    await visible(proposal(page), '목적·진행 방법·완료 기준')
    // 긴 설명을 펼쳐 본다(리뷰 (e)).
    const card = page
      .locator('.split-stages .split-piece')
      .filter({ has: page.locator('.split-piece__head strong').getByText('개편안 스케치 3종', { exact: true }) })
    await card.locator('summary').click()
    const text = card.locator('.split-piece__desc p')
    await text.waitFor()
    await card.scrollIntoViewIfNeeded()
    note(viewport, 'list long description', await text.evaluate((element) => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      overflows: element.scrollWidth > element.clientWidth,
      lines: Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight || '20')),
    })))
  })

  await step(
    page,
    viewport,
    'piece-read',
    async () => {
      await button(toolbar(page), '지도').click()
      await mapNodes(page).nth(4).waitFor()
      await openPiece(page, '개편안 스케치 3종')
      const dialog = pieceDialog(page)
      await visible(dialog, '이전 조각:')
      await visible(dialog, '세 안의 화면 흐름과 장단점이 한 문서에 있다.')
      await button(dialog, '빼기').waitFor()
      await button(dialog, '고치기').waitFor()
      assert.ok((await page.locator('.split-map .tm-edge--active').count()) > 0, '누른 조각의 선이 강조되지 않았다')
      await settle(page)
      const facts = await page.evaluate(() => {
        const backdrop = document.querySelector('.split-dialog__backdrop')
        const tab = document.querySelector('.bottom-tab')
        const tabBox = tab && tab.offsetParent !== null ? tab.getBoundingClientRect() : null
        const hit = tabBox ? document.elementFromPoint(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2) : null
        return {
          backdropZ: getComputedStyle(backdrop).zIndex,
          tabZ: tab ? getComputedStyle(tab).zIndex : null,
          tabCovered: tabBox ? Boolean(hit?.closest('.split-dialog__backdrop')) : null,
          description: getComputedStyle(document.querySelector('.split-dialog .split-piece__text')).whiteSpace,
        }
      })
      if (viewport === 'mobile') {
        assert.equal(facts.tabCovered, true, '창이 하단 탭을 덮지 않는다')
        const box = await dialog.boundingBox()
        assert.ok(Math.abs(box.y + box.height - size.height) <= 1, `시트가 바닥에 붙지 않았다(${JSON.stringify(box)})`)
      }
      note(viewport, 'piece-read', { ...facts, box: await dialog.boundingBox(), focus: await activeElement(page) })
      // 창이 열린 동안 Tab은 창 안에서만 돈다(뒤의 "제안 버리기" 같은 확인 창을 여는 버튼에 닿지 않는다).
      for (let index = 0; index < 8; index += 1) {
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('.split-dialog--piece'))), true, 'Tab이 창 밖으로 나갔다')
      }
    },
    { dark: true },
  )

  if (viewport === 'desktop') {
    // 600~899px: 가운데 카드가 아래에서 미끄러져 올라온다(리뷰 (b)). 다시 열어 움직임을 잰다.
    await closePiece(page)
    await page.setViewportSize({ width: 768, height: 1024 })
    await settle(page)
    const frames = []
    const watching = page.evaluate(
      () =>
        new Promise((resolve) => {
          const seen = []
          const started = performance.now()
          const tick = () => {
            const element = document.querySelector('.split-dialog--piece')
            if (element) {
              const box = element.getBoundingClientRect()
              seen.push({ t: Math.round(performance.now() - started), y: Math.round(box.y), x: Math.round(box.x), w: Math.round(box.width) })
            }
            if (performance.now() - started < 600) requestAnimationFrame(tick)
            else resolve(seen)
          }
          requestAnimationFrame(tick)
        }),
    )
    await openPiece(page, '개편안 스케치 3종')
    frames.push(...(await watching))
    await settle(page)
    await page.screenshot({ path: path.join(output, `${viewport}-17-piece-read-768.png`) })
    note(viewport, 'piece-read 768', {
      first: frames.find((frame) => frame.w > 0),
      last: frames.at(-1),
      box: await pieceDialog(page).boundingBox(),
    })
    await page.setViewportSize(size)
    await settle(page)
  }

  await step(page, viewport, 'piece-refused', async () => {
    await startEditing(page)
    // 읽기→고치기 뒤 초점은 첫 칸(제목)으로 간다.
    const editFocus = await activeElement(page)
    note(viewport, 'focus after read→edit', editFocus)
    assert.equal(await titleInput(page).evaluate((input) => input === document.activeElement), true, `초점이 제목 칸이 아니다(${editFocus})`)
    await titleInput(page).fill('')
    // 기다리는 동안의 표시를 보려고 응답을 늦춘다.
    await mock(page, () => window.__pinitMock.setLatency(800))
    await button(pieceDialog(page), '확인').click()
    await button(pieceDialog(page), '확인하는 중…').waitFor()
    const error = pieceDialog(page).locator('.split-form__error').filter({ hasText: '제목은 1~20자로 입력해 주세요.' })
    await error.waitFor()
    await mock(page, () => window.__pinitMock.setLatency(0))
    assert.equal(
      await error.evaluate((element) => element.parentElement?.querySelector('input') !== null && element.parentElement === element.closest('.split-form > label')),
      true,
      '제목 칸 아래가 아니다',
    )
    await pieceDialog(page).getByRole('heading', { name: '조각 고치기' }).waitFor()
  })

  await step(
    page,
    viewport,
    'piece-edited',
    async () => {
      await titleInput(page).fill('개편안 스케치 3종')
      await pieceDialog(page).locator('input[type=number]').fill('300')
      await button(pieceDialog(page), '확인').click()
      await pieceDialog(page).getByRole('heading', { name: '조각 내용' }).waitFor()
      // 고치기→읽기 뒤 초점은 창 제목으로 간다.
      const readFocus = await activeElement(page)
      note(viewport, 'focus after edit→read', readFocus)
      assert.equal(readFocus, 'h2 조각 내용', '초점이 창 제목이 아니다')
      await toast(page, '조각을 고쳤어요.')
      await toastAction(page, '조각을 고쳤어요.').waitFor()
      await visible(pieceDialog(page), '4시간 이상이에요.')
      await summaryBar(page).getByText('4시간 이상 1개').waitFor()
    },
    { dark: true },
  )

  await step(page, viewport, 'term-help', async () => {
    await startEditing(page)
    const mark = pieceDialog(page).getByRole('button', { name: '이전 조각 설명', exact: true })
    const help = mark.locator('xpath=..')
    const tip = help.getByRole('tooltip')
    const press = () => (viewport === 'mobile' ? mark.tap() : mark.click())
    await press()
    await tip.getByText('이전 조각이란?').waitFor({ state: 'visible' })
    // Esc는 설명만 닫는다. 창은 그대로다.
    await page.keyboard.press('Escape')
    const afterEsc = await help.evaluate((element) => ({
      open: element.hasAttribute('data-open'),
      hover: element.matches(':hover'),
      focusVisible: element.querySelector('.term-help__mark').matches(':focus-visible'),
      focused: document.activeElement === element.querySelector('.term-help__mark'),
      shown: getComputedStyle(element.querySelector('.term-help__tip')).visibility,
    }))
    note(viewport, 'term-help after Esc', afterEsc)
    // 초점이 "?"에 남아도(:focus-visible·:hover) 설명은 닫히고 창은 그대로다.
    await tip.waitFor({ state: 'hidden', timeout: 2000 })
    assert.equal(await pieceDialog(page).count(), 1, 'Esc가 창까지 닫았다')
    // 키보드 초점으로 연 설명(누르지 않음)도 Esc는 설명만 닫는다. 고치던 내용을 잃지 않는다.
    await titleInput(page).focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await mark.focus()
    await tip.waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await tip.waitFor({ state: 'hidden', timeout: 2000 })
    assert.equal(await pieceDialog(page).count(), 1, '초점으로 연 설명에서 Esc가 창까지 닫았다')
    await pieceDialog(page).getByRole('heading', { name: '조각 고치기' }).waitFor()
    // 바깥을 누르면 닫힌다.
    await press()
    await tip.waitFor({ state: 'visible' })
    const outside = pieceDialog(page).getByRole('heading', { name: '조각 고치기' })
    await (viewport === 'mobile' ? outside.tap() : outside.click())
    await tip.waitFor({ state: 'hidden' })
    await press()
    await tip.getByText('이전 조각이란?').waitFor({ state: 'visible' })
    await settle(page)
    const tipBox = await tip.boundingBox()
    note(viewport, 'term-help tip', tipBox)
    // 말풍선 전체가 화면 안에 있다(390px에서 왼쪽이 잘리던 것).
    assert.ok(tipBox.x >= 0 && tipBox.x + tipBox.width <= size.width, `설명이 화면 밖으로 나간다(${JSON.stringify(tipBox)})`)
  })

  await step(page, viewport, 'piece-removed', async () => {
    await page.keyboard.press('Escape')
    await closePiece(page)
    await mapNode(page, '팀 리뷰 받기').getByRole('button', { name: '팀 리뷰 받기 빼기', exact: true }).click()
    await toast(page, '"팀 리뷰 받기" 조각을 뺐어요.')
    await visible(proposal(page), '뺀 조각 3개')
    await visible(droppedRow(page, '팀 리뷰 받기'), '내가 뺌 ·')
    await page.waitForFunction(() => document.querySelectorAll('.split-map__node').length === 4)
    // 앞뒤 조각이 바로 이어진다: a→c, b→c, c→e.
    assert.equal(await page.locator('.split-map .tm-edges > path').count(), 3)
    await page.locator('.split-map').scrollIntoViewIfNeeded()
  })

  await step(page, viewport, 'via-excluded', async () => {
    // 최종안 문서화는 마지막 조각이라 후보 가운데 순환이 생기는 것이 없다. 순환 표시는 개편안 스케치 3종의 후보에서 먼저 본다.
    await openPiece(page, '개편안 스케치 3종')
    await startEditing(page)
    const blocked = pieceDialog(page).locator('.split-form__check').filter({ hasText: '순환이 생겨요' })
    await blocked.first().waitFor()
    assert.equal(await blocked.first().locator('input[type=checkbox]').isDisabled(), true)
    await blocked.first().getByRole('button', { name: '순환 설명', exact: true }).waitFor()
    note(viewport, 'cycle choices (개편안 스케치 3종)', await pieceDialog(page).locator('.split-form__check').allInnerTexts())
    await blocked.first().scrollIntoViewIfNeeded()
    await settle(page)
    await page.screenshot({ path: path.join(output, `${viewport}-22-via-excluded-cycle.png`) })
    await closePiece(page)

    await openPiece(page, '최종안 문서화')
    await startEditing(page)
    const choice = pieceDialog(page).locator('.split-form__check').filter({ hasText: '개편안 스케치 3종' })
    const box = choice.locator('input[type=checkbox]')
    assert.equal(await box.isChecked(), true)
    assert.equal(await box.isDisabled(), true)
    await visible(choice, '뺀 조각을 거쳐 이어져 있어요')
    note(viewport, 'via-excluded choices (최종안 문서화)', await pieceDialog(page).locator('.split-form__check').allInnerTexts())
    await choice.scrollIntoViewIfNeeded()
  })

  await step(page, viewport, 'undo-toolbar', async () => {
    await closePiece(page)
    await button(toolbar(page), '되돌리기').click()
    await visible(proposal(page), '뺀 조각 2개')
    await page.waitForFunction(() => document.querySelectorAll('.split-map__node').length === 5)
    await summaryBar(page).getByText('4시간 이상 1개').waitFor()
    await button(toolbar(page), '처음 제안으로').click()
    await summaryBar(page).getByText('4시간 이상 1개').waitFor({ state: 'detached' })
    await visible(proposal(page), '뺀 조각 2개')
    assert.equal(await page.getByText('4시간 이상', { exact: false }).filter({ visible: true }).count(), 0)
    assert.equal(await button(toolbar(page), '처음 제안으로').isDisabled(), true)
  })

  await step(page, viewport, 'reinclude-warning', async () => {
    await button(droppedRow(page, '온보딩 문구 초안'), '다시 넣기').click()
    await toast(page, '"온보딩 문구 초안" 조각을 다시 넣었어요.')
    await mapNode(page, '온보딩 문구 초안').waitFor()
    await openPiece(page, '온보딩 문구 초안')
    await visible(pieceDialog(page), '"온보딩 문구 다듬기" 작업과 겹칠 수 있어요.')
  })

  await step(page, viewport, 'empty-by-member', async () => {
    await closePiece(page)
    for (let left = await mapNodes(page).count(); left > 0; left -= 1) {
      await mapNodes(page).first().locator('.split-map__remove').click()
      await page.waitForFunction((count) => document.querySelectorAll('.split-map__node').length === count, left - 1)
      await page.waitForFunction(() => !document.querySelector('.split-page--proposal[aria-busy]'))
    }
    await visible(proposal(page), '만들 조각이 없어요. 아래에서 조각을 다시 넣어 주세요.')
    assert.equal(await applyButton(page).isDisabled(), true)
  })
  await button(toolbar(page), '처음 제안으로').click()
  await page.waitForFunction(() => document.querySelectorAll('.split-map__node').length === 5)

  await step(page, viewport, 'apply-unexpected', async () => {
    await applyRejected(page, 'UNEXPECTED', () =>
      toast(page, '만들지 못했어요. 아무것도 바뀌지 않았어요. 잠시 뒤 다시 시도해 주세요.'),
    )
    assert.match(page.url(), /\/app\/tasks\/splits\/\d+$/)
    assert.equal(await mapNodes(page).count(), 5)
    await applyButton(page).getByText('만들기').waitFor()
  })

  await step(page, viewport, 'apply-admin-only', async () => {
    const notice = page.locator('.split-reject')
    await applyRejected(page, 'ADMIN_ONLY', () => notice.getByText('만들지 못했어요. 이제 관리자만 할 수 있어요').waitFor())
    // 부드럽게 올라오는 것이 끝난 뒤 보이는 자리에 있는지 본다.
    await page.waitForFunction(() => {
      const box = document.querySelector('.split-reject')?.getBoundingClientRect()
      return box && box.top >= 0 && box.bottom <= window.innerHeight
    })
    assert.equal(await applyButton(page).isDisabled(), true)
    assert.equal(await button(proposal(page), '제안 버리기').isDisabled(), false)
  })

  await step(page, viewport, 'discard-undo', async () => {
    await button(proposal(page), '제안 버리기').click()
    await visible(confirmDialog(page), '이미 쓴 횟수는 돌아오지 않아요.')
    await button(confirmDialog(page), '제안 버리기').click()
    await page.waitForURL(/\/app\/tasks\/splits$/)
    await toast(page, '제안을 버렸어요.')
    await toastAction(page, '제안을 버렸어요.').click()
    await page.waitForURL(/\/app\/tasks\/splits\/\d+$/)
    await mapNodes(page).nth(4).waitFor()
    assert.deepEqual(
      [...(await mapTitles(page))].sort(),
      ['개편안 스케치 3종', '이탈 구간 데이터 뽑기', '최종안 문서화', '팀 리뷰 받기', '현재 온보딩 흐름 정리'].sort(),
    )
    assert.equal(await applyButton(page).isDisabled(), false)
  })

  await step(
    page,
    viewport,
    'applied-map',
    async () => {
      // 만드는 동안 조각을 바꾸는 모든 조작이 잠긴다. 응답을 늦춰 그 사이를 본다.
      await mock(page, () => window.__pinitMock.setLatency(1500))
      await applyButton(page).click()
      await applyButton(page).getByText('만드는 중…').waitFor()
      const locked = await page.evaluate(() => {
        const disabled = (selector) => [...document.querySelectorAll(selector)].map((element) => element.disabled)
        return {
          remove: disabled('.split-map__remove'),
          toolbar: disabled('.split-toolbar .split-view__undo'),
          include: disabled('.split-dropped button'),
          discard: disabled('.split-page__discard'),
          apply: disabled('.split-apply button'),
        }
      })
      await mock(page, () => window.__pinitMock.setLatency(0))
      note(viewport, 'applying locks', locked)
      for (const [name, states] of Object.entries(locked))
        assert.ok(states.length > 0 && states.every(Boolean), `만드는 동안 ${name}이 켜져 있다(${JSON.stringify(states)})`)
      // 조각 카드를 누르면 읽기 창은 열리지만 그 안의 버튼(빼기·고치기·닫기)은 모두 꺼져 있다.
      await mapNodes(page).first().locator('.split-map__title').click()
      const dialogButtons = await pieceDialog(page)
        .locator('button')
        .evaluateAll((items) => items.map((item) => `${item.getAttribute('aria-label') ?? item.textContent.trim()}:${item.disabled}`))
      note(viewport, 'applying dialog buttons', dialogButtons)
      assert.ok(dialogButtons.length > 0 && dialogButtons.every((line) => line.endsWith(':true')), `만드는 동안 조각 창의 버튼이 켜져 있다(${dialogButtons})`)
      await page.waitForURL(/\/app\/task-map$/)
      await toast(page, '조각 5개를 만들었어요.')
      await toastAction(page, '조각 5개를 만들었어요.').waitFor()
      // 작업 맵에는 만들었다는 토스트 하나뿐이다.
      assert.deepEqual(await page.locator('.toast .toast__message').allInnerTexts(), ['조각 5개를 만들었어요.'])
      // 제안 화면은 기록에서 바뀌었다: 뒤로 가기가 제안 화면으로 돌아가지 않는다. 앞으로 가기로 작업 맵에 돌아온다.
      await page.goBack()
      await page.waitForFunction(() => location.pathname !== '/app/task-map')
      const backTo = new URL(page.url()).pathname
      note(viewport, 'applied-map back', backTo)
      assert.ok(!/^\/app\/tasks\/splits\/\d+$/.test(backTo), `뒤로 가기가 제안 화면(${backTo})으로 갔다`)
      // 제안 화면은 28번에서 보관함 토스트의 되돌리기로 열었다(보관함 위에 쌓임). 그 자리를 작업 맵이 바꿨으니 뒤는 보관함이다.
      assert.equal(backTo, '/app/tasks/splits', `뒤로 가기가 보관함이 아니라 ${backTo}로 갔다`)
      await page.goForward()
      await page.waitForURL(/\/app\/task-map$/)
      await toastAction(page, '조각 5개를 만들었어요.').waitFor()
      const titles = ['현재 온보딩 흐름 정리', '이탈 구간 데이터 뽑기', '개편안 스케치 3종', '팀 리뷰 받기', '최종안 문서화']
      // 작업 맵은 화면 밖 카드를 그리지 않는다. 다섯 조각이 지도에 있는지는 "작업으로 이동" 목록으로 보고,
      // 가운데 조각으로 옮겨 앞뒤 선을 본다.
      const jump = page.locator('.tm-task-jump select')
      for (const title of titles)
        await jump.locator('option').filter({ hasText: new RegExp(`^${title}$`) }).first().waitFor({ state: 'attached' })
      await jump.selectOption({ label: '개편안 스케치 3종' })
      await page.locator('.tm-node--selected').filter({ hasText: '개편안 스케치 3종' }).waitFor()
      await page.locator('.tm-canvas-panel').scrollIntoViewIfNeeded()
      await settle(page)
      const shown = await page.locator('.tm-node').evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect()
          return `${node.querySelector('.tm-node-title')?.textContent?.trim()}@${Math.round(box.x)},${Math.round(box.y)} ${node.querySelector('.tm-readiness')?.textContent?.trim()}`
        }),
      )
      note(viewport, 'applied-map nodes', shown.filter((line) => titles.some((title) => line.startsWith(title))))
      // 앞서 만들기가 거부됐을 때의 오류 토스트는 다음 만들기와 화면을 떠날 때 닫혔다. 만들었다는 토스트만 남는다.
      const errorToasts = await page.locator('.toast--error .toast__message').allInnerTexts()
      note(viewport, 'applied-map error toasts', errorToasts)
      assert.deepEqual(errorToasts, [], '작업 맵에 만들기 거부 토스트가 남았다')
      assert.equal(await page.locator('.toast').count(), 1, '작업 맵에 토스트가 하나가 아니다')
      note(viewport, 'applied-map active edges', await page.locator('.tm-edges path.tm-edge--active').count())
      assert.equal(await page.locator('.tm-edges path.tm-edge--active').count(), 3, '가운데 조각의 앞뒤 선(앞 둘, 뒤 하나)이 아니다')
    },
    { dark: true },
  )

  await step(page, viewport, 'apply-undone', async () => {
    await toastAction(page, '조각 5개를 만들었어요.').click()
    await page.waitForURL(/\/app\/tasks\/splits\/\d+$/)
    await mapNodes(page).nth(4).waitFor()
    assert.equal(await mapNodes(page).count(), 5)
    await navLink(page, '작업').click()
    await switchSpace(page, '개인')
    const card = page.locator('.workspace-task').filter({ hasText: '온보딩 개편 설계' })
    await card.getByText('쪼개기 제안 준비됨').waitFor()
    await card.scrollIntoViewIfNeeded()
  })

  await step(page, viewport, 'apply-expired', async () => {
    await openTask(page, '온보딩 개편 설계')
    await button(detail(page), '제안 보기').click()
    await page.waitForURL(/\/app\/tasks\/splits\/\d+$/)
    await mapNodes(page).nth(4).waitFor()
    await applyRejected(page, 'EXPIRED', () => visible(page.locator('main'), '보관 기간이 끝난 제안이에요'))
    await page.locator('main').getByRole('link', { name: '원본 열어 다시 쪼개기', exact: true }).waitFor()
    await page.locator('main').getByRole('link', { name: '보관함으로', exact: true }).waitFor()
  })

  await step(page, viewport, 'all-excluded', async () => {
    await page.locator('main').getByRole('link', { name: '보관함으로', exact: true }).click()
    await page.waitForURL(/\/app\/tasks\/splits$/)
    await button(inboxRow(page, '릴리즈 회고 준비'), '제안 보기').click()
    await page.waitForURL(/\/app\/tasks\/splits\/\d+$/)
    await visible(proposal(page), '이미 끝낸 것 같아요. 아래 근거를 보고, 필요한 조각만 다시 넣어 주세요.')
    await visible(proposal(page), '뺀 조각 3개')
  })

  await step(page, viewport, 'admin-only-open', async () => {
    await topBack(page).click()
    await page.waitForURL(/\/app\/tasks\/splits$/)
    await button(inboxRow(page, '12월 발제문 쓰기'), '제안 보기').click()
    await page.waitForURL(/\/app\/tasks\/splits\/\d+$/)
    const notice = page.locator('.split-reject')
    await notice.getByText('이제 관리자만 만들 수 있어요').waitFor()
    const body = await notice.innerText()
    assert.match(body, /관리자 \S+님에게/)
    note(viewport, 'admin-only-open', body.split('\n').at(-1))
    assert.equal(await applyButton(page).isDisabled(), true)
  })

  await step(page, viewport, 'late-notice', async () => {
    await navLink(page, '작업').click()
    await switchSpace(page, '개인')
    await openTask(page, '여행 계획 세우기')
    await button(detail(page), '쪼개기').click()
    await button(confirmDialog(page), '쪼개기 맡기기').click()
    await toast(page, '쪼개기를 맡겼어요. 준비되면 알려 드릴게요.')
    await visible(detail(page), '쪼개는 중이에요')
    const before = await unreadOf(page)
    await watchBell(page)
    const started = Date.now()
    await finishRequest(page, { title: '여행 계획 세우기' }, 'READY')
    await button(detail(page), '제안 보기').click()
    await page.waitForURL(/\/app\/tasks\/splits\/\d+$/)
    await mapNodes(page).first().waitFor()
    await visible(proposal(page), '여행 계획 세우기')
    // 알림은 1.5초 뒤에 생긴다. 종이 그것을 읽으면 제안 화면이 한 번 더 읽음으로 한다.
    await page.waitForTimeout(Math.max(0, 5000 - (Date.now() - started)))
    const seen = await bellSeen(page)
    const counts = seen.map((entry) => ({ ms: entry.at - started, count: entry.count }))
    note(viewport, 'late-notice bell', { before, counts })
    assert.equal(await unreadOf(page), before, `5초 뒤 종 숫자가 ${before}이 아니다`)
    assert.ok(counts.some((entry) => entry.count > before), '종 숫자가 늘지 않았다(늦게 생긴 알림을 읽지 못했다)')
  })

  await step(page, viewport, 'inbox-read', async () => {
    const before = await unreadOf(page)
    await watchBell(page)
    const started = Date.now()
    await finishRequest(page, { fixture: 'queued' }, 'FAILED')
    await bell(page).click()
    await button(page.locator('.split-panel'), '쪼개기 보관함 열기').click()
    await page.waitForURL(/\/app\/tasks\/splits$/)
    const row = inboxRow(page, '결제 모듈 이관')
    await row.getByText('실패', { exact: true }).waitFor()
    await page.waitForTimeout(Math.max(0, 5500 - (Date.now() - started)))
    const counts = (await bellSeen(page)).map((entry) => ({ ms: entry.at - started, count: entry.count }))
    note(viewport, 'inbox-read bell', { before, counts })
    assert.equal(await unreadOf(page), before, '실패 알림이 종 숫자에 남았다')
    await row.scrollIntoViewIfNeeded()
  })

  await step(page, viewport, 'settings', async () => {
    await page.getByRole('button', { name: '설정', exact: true }).filter({ visible: true }).first().click()
    await page.waitForURL(/\/app\/settings/)
    const row = page.locator('.settings__row').filter({ hasText: '작업 쪼개기 알림' })
    await row.getByText('쪼개기 제안이 준비되거나 실패하면 푸시로 알려 드려요. 꺼도 알림함에는 남아요.').waitFor()
    const toggle = row.getByRole('button', { name: '작업 쪼개기 알림', exact: true })
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
    await toggle.click()
    await page.waitForFunction(
      () => document.querySelector('button[aria-label="작업 쪼개기 알림"]')?.getAttribute('aria-pressed') === 'false',
    )
    await row.locator('.saved-mark[data-visible]').waitFor()
    assert.equal(await page.locator('.toast--error, .toast[data-type="error"]').count(), 0)
    await row.scrollIntoViewIfNeeded()
  })

  await step(page, viewport, 'read-all', async () => {
    // 35번에서 남은 안 읽은 알림(사내 위키 이전 계획의 준비 알림)을 모두 읽음으로 한다.
    assert.ok((await unreadOf(page)) > 0, '모두 읽음 전에 안 읽은 알림이 없다')
    await bell(page).click()
    const panel = page.locator('.split-panel')
    await panel.locator('.notice').first().waitFor()
    await button(panel, '모두 읽음').click()
    await page.waitForFunction(() => !document.querySelector('.split-badge'))
    assert.equal(await panel.locator('.notice[data-unread]').count(), 0)
    assert.equal(await button(panel, '모두 읽음').count(), 0)
    assert.equal(await bell(page).getAttribute('aria-label'), '알림')
  })
  await page.keyboard.press('Escape')
  await page.locator('.split-panel').waitFor({ state: 'detached' })

  // 만료 말고 제안을 열 수 없는 길. 주소를 앱 안에서 바꿔(새로 읽지 않는다) 연다.
  await step(page, viewport, 'not-openable', async () => {
    const ids = await mock(page, () => {
      const { fixtures } = window.__pinitMock.split
      return { applied: fixtures.applied.requestId, cancelled: fixtures.cancelled.requestId, running: fixtures.running.requestId }
    })
    const go = (target) =>
      page.evaluate((to) => {
        window.history.pushState({}, '', to)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, target)
    await go(`/app/tasks/splits/${ids.running}`)
    await page.waitForURL(/\/app\/tasks\/splits$/)
    await go(`/app/tasks/splits/${ids.cancelled}`)
    await visible(page.locator('main'), '이미 처리된 요청이에요.')
    // 없는 요청은 404다. 그 응답의 HTTP 기록도 기대한 것으로 센다.
    expectingRejection = { label: 'NOT_FOUND', url: /\/v2\/task-splits\/999999\b/ }
    try {
      await go('/app/tasks/splits/999999')
      await visible(page.locator('main'), '더 이상 볼 수 없는 제안이에요.')
    } finally {
      expectingRejection = null
    }
    await settle(page)
    await page.screenshot({ path: path.join(output, `${viewport}-38-not-openable-missing.png`) })
    await go(`/app/tasks/splits/${ids.applied}`)
    await visible(page.locator('main'), '이미 처리된 요청이에요.')
    await page.locator('main').getByRole('link', { name: '보관함으로', exact: true }).waitFor()
  })
}

let browser
try {
  await mkdir(output, { recursive: true })
  browser = await chromium.launch()
  const only = process.env.QA_VIEWPORT
  for (const [viewport, size] of Object.entries(viewports)) {
    if (only && only !== viewport) continue
    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 2,
      // 좁은 화면은 손가락으로 누른다("?" 설명을 tap으로 연다).
      hasTouch: viewport === 'mobile',
      colorScheme: 'light',
      timezoneId: 'Asia/Seoul',
      serviceWorkers: 'block',
    })
    context.setDefaultTimeout(10_000)
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(`${viewport} pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (expectingRejection && /API Error/.test(text) && expectingRejection.url.test(text))
        expectedRejections.push(`${viewport} ${expectingRejection.label}: ${text}`)
      else errors.push(`${viewport} console: ${text}`)
    })
    await login(page)
    await walk(page, viewport)
    await walkProposal(page, viewport)
    await context.close()
  }
  for (const line of notes) console.log(`note ${line}`)
  for (const line of expectedRejections) console.log(`expected ${line}`)
  // 거부된 응답 하나는 두 줄을 남긴다: httpClient가 오류 응답을 받으면 `❌ API Error`를 찍고 ApiError를 던지며,
  // 같은 함수의 바깥 catch가 그것을 받아 `🔥 API Error caught`를 찍고 다시 던진다(src/shared/api/httpClient.ts).
  // 없는 요청 열기는 제안을 두 번 읽는다: 개발 서버는 StrictMode라 처음 붙을 때 effect를 한 번 더 돌린다(src/main.tsx).
  const expectedLines = { UNEXPECTED: 2, ADMIN_ONLY: 2, EXPIRED: 2, NOT_FOUND: 4 }
  for (const viewport of Object.keys(viewports).filter((name) => !process.env.QA_VIEWPORT || name === process.env.QA_VIEWPORT))
    for (const [label, count] of Object.entries(expectedLines))
      assert.equal(
        expectedRejections.filter((line) => line.startsWith(`${viewport} ${label}: `)).length,
        count,
        `${viewport} ${label}: 기대한 HTTP 오류 기록이 ${count}줄이 아니다`,
      )
  assert.deepEqual(errors, [], `브라우저 오류:\n${errors.join('\n')}`)
  console.log('task-split local check passed')
} finally {
  await browser?.close()
  await server.close()
}
