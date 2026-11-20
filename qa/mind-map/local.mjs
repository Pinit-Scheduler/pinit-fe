import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 마인드맵 화면 확인. 모든 응답은 개발 서버의 내장 mock(VITE_USE_MOCK_API, src/mocks/mindMap.ts)이 만든다.
// QA_ORIGIN을 주면(예: `npm start`의 http://127.0.0.1:4173) 서버를 띄우지 않고 그 주소를 쓴다.
process.env.VITE_USE_MOCK_API = 'true'
const { chromium } = createRequire(import.meta.url)('playwright')

const port = 5198
const origin = process.env.QA_ORIGIN ?? `http://127.0.0.1:${port}`
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = process.env.QA_SCREENSHOT_DIR ?? fileURLToPath(new URL('./screenshots/', import.meta.url))
const viewports = {
  desktop: { width: 1280, height: 860 },
  mobile: { width: 390, height: 800 },
}

let server = null
if (!process.env.QA_ORIGIN) {
  const { createServer } = await import('vite')
  server = await createServer({
    root,
    clearScreen: false,
    server: { host: '127.0.0.1', port, strictPort: true },
  })
  await server.listen()
}

const errors = []
/**
 * 일부러 실패시킨 맵 읽기(`failNextLoad`)의 500은 앱의 HTTP 도우미가 console.error로 남긴다.
 * 그 창 안에서 `pattern`에 맞는 오류 기록만 기대한 것으로 따로 세고, 그 밖의 console error는 모두 실패로 본다.
 */
let expectingRejection = null
const MIND_MAP_LOAD_ERROR = /API Error.*status: 500.*\/v2\/mind-map\b/
/**
 * mock의 진행 중인 일정(1번)은 demo의 것이라, pinit 계정에서는 미니 플레이어가 그 일정을 읽다 404를 받는다.
 * 마인드맵과 관계없는 mock의 기존 동작이다.
 */
const PINIT_ACTIVE_SCHEDULE_ERROR =
  /API Error.*status: 404.*\/v2\/workspace\/schedules\/1\b|^Failed to load active schedule: ApiError: 일정을 찾을 수 없습니다\./
const expectedRejections = []
const counters = {}

/** 열리고 닫히는 움직임이 끝날 때까지 기다린다. 끝없는 움직임은 기다리지 않는다. */
const settle = (page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity),
  )

/**
 * 한 단계를 걷고 캡처한다. 이름은 `{viewport}-{두 자리 번호}-{name}.png`이고 번호는 뷰포트마다 1부터 센다.
 * 페이지가 가로로 넘치지 않는지 본다. `dark: true`면 어두운 테마로도 찍는다(`…-dark.png`).
 */
const step = async (page, viewport, name, run, { dark = false } = {}) => {
  try {
    await run()
  } catch (error) {
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

const button = (scope, name) => scope.getByRole('button', { name, exact: true }).filter({ visible: true }).first()
const canvas = (page) => page.locator('.mind-map-canvas')
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const nodeByText = (page, text) =>
  page
    .locator('.mind-map-node')
    .filter({ has: page.locator('.mind-map-node__label', { hasText: new RegExp(`^${escapeRegExp(text)}$`) }) })
const counts = (page) => page.locator('.mind-map-page__counts')
const saveLabel = (page) => page.locator('.mind-map-save__label')
const editingLabel = (page) => page.locator('.mind-map-node.is-editing .mind-map-node__label')

/** 이메일이 없는 mock 계정(pinit)은 로그인 뒤 이메일 등록을 거친다. mock은 인증 코드를 console.info로 알린다. */
const registerEmail = async (page) => {
  const code = new Promise((resolve) => {
    const listen = (message) => {
      const match = /인증 코드: (\d{6})/.exec(message.text())
      if (!match) return
      page.off('console', listen)
      resolve(match[1])
    }
    page.on('console', listen)
  })
  await page.getByPlaceholder('you@example.com').fill('qa@example.com')
  await button(page, '코드 받기').click()
  await page.getByPlaceholder('6자리 숫자').fill(await code)
  await button(page, '이메일 등록').click()
  await page.waitForURL(/\/app\//)
}

/** `beforeSubmit`은 로그인 화면에서(앱이 오늘 화면을 열기 전에) 부른다. */
const login = async (page, { username = 'demo', password = 'demo1234', beforeSubmit = async () => {} } = {}) => {
  await page.goto(`${origin}/login`)
  await beforeSubmit()
  await page.getByPlaceholder('아이디를 입력하세요').fill(username)
  await page.getByPlaceholder('비밀번호를 입력하세요').fill(password)
  await button(page, '로그인').click()
  await page.waitForURL(/\/(app\/|email-registration$)/)
  if (page.url().endsWith('/email-registration')) await registerEmail(page)
  // 처음 들어오면 뜨는 둘러보기를 닫는다.
  const skip = page.getByRole('button', { name: '건너뛰기', exact: true })
  await skip.waitFor({ timeout: 5000 }).then(() => skip.click(), () => {})
  await skip.waitFor({ state: 'detached' })
}

/**
 * 앱 안에서 주소를 바꾼다. 새로 읽으면 mock의 로그인과 상태가 처음으로 돌아가므로 `page.goto`를 쓰지 않는다.
 * Task 13 전에는 메뉴에 마인드맵이 없어 `history.pushState`와 `popstate`로 옮긴다.
 */
const openInApp = async (page, pathname) => {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, pathname)
  await page.waitForURL(new RegExp(`${pathname}$`))
}

/** 화면에 보이는 저장 상태 글을 차례로 모은다(`저장 중…`은 잠깐만 보인다). */
const recordSaveLabels = (page) =>
  page.evaluate(() => {
    const seen = []
    const read = () => {
      const text = document.querySelector('.mind-map-save__label')?.textContent ?? null
      if (text && seen.at(-1) !== text) seen.push(text)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.querySelector('.mind-map-page__bar'), { subtree: true, childList: true, characterData: true })
    window.__mindMapSaveLabels = seen
  })
const savedLabels = (page) => page.evaluate(() => [...window.__mindMapSaveLabels])
const waitSaved = (page) => page.waitForFunction(() => document.querySelector('.mind-map-save__label')?.textContent === '저장됨')

const actionBar = (page) => page.getByRole('toolbar', { name: '가지 편집', exact: true })
const selectedLabel = (page) => page.locator('.mind-map-node.is-selected .mind-map-node__label').innerText()
const center = async (locator) => {
  const box = await locator.boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
/** 가지 상자 안에서 세로로 `fraction`(0 위 ~ 1 아래)인 점. */
const pointIn = async (locator, fraction) => {
  const box = await locator.boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height * fraction }
}
const worldOffset = (page) =>
  page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.mind-map-world')).transform)
    return { x: m.e, y: m.f, k: m.a }
  })

/**
 * 누르고 끈 뒤 놓는다. PC는 마우스, 폰은 터치(CDP의 터치 이벤트, Chromium이 pointerType touch로 바꾼다).
 * Playwright의 `page.touchscreen`은 `tap`만 있어 끌기는 CDP로 보낸다. `whileHeld`는 놓기 전에 부른다.
 */
const dragBetween = async (page, viewport, from, to, whileHeld = async () => {}) => {
  const steps = 10
  if (viewport === 'mobile') {
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, p) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, id: 1 }] })
    await touch('touchStart', from)
    for (let i = 1; i <= steps; i++)
      await touch('touchMove', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps })
    // 놓기 전에 잠깐 멈춘다. 빠르게 끈 채 놓으면 Chromium이 튕기기(fling)로 보고 바로 다음 탭의 click을 삼킨다.
    await page.waitForTimeout(120)
    await touch('touchMove', to)
    await whileHeld()
    await touch('touchEnd', to)
    await cdp.detach()
    return
  }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await whileHeld()
  await page.mouse.up()
}

/** 폰은 손가락으로, PC는 마우스로 누른다. */
const press = async (page, viewport, locator) => {
  if (viewport === 'mobile') await locator.tap()
  else await locator.click()
}

/**
 * 지금 화면을 밝은·어두운 테마로 찍는다(`{viewport}-{name}.png`, `…-dark.png`). 단계 도중의 상태를 남길 때 쓴다.
 * 테마를 바꾼 뒤 색 전환이 끝나기를 기다린다(끌기 중에는 기다리지 않는다).
 */
const capture = async (page, viewport, name, { wait = true } = {}) => {
  await page.screenshot({ path: path.join(output, `${viewport}-${name}.png`) })
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  if (wait) await settle(page)
  await page.screenshot({ path: path.join(output, `${viewport}-${name}-dark.png`) })
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme
  })
}

/** 끄는 동안의 화면을 밝은·어두운 테마로 찍는다. */
const captureHeld = (page, viewport, name) => capture(page, viewport, `${name}-held`, { wait: false })

/** 선택한 가지의 부모 글. `←`로 부모를 고르고 그 글을 읽는다(선택은 부모에 남는다). */
const parentOfSelected = async (page) => {
  await page.keyboard.press('ArrowLeft')
  return selectedLabel(page)
}

// ---- 흐름 단계(Task 14)의 도우미 ----

const CONFLICT_TOAST = '다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 고쳐 주세요.'
/** 기억한 가지는 선택이 바뀌고 800ms 뒤에 저장한다. 떠나기 전에 이만큼 기다려 돌아왔을 때 같은 가지가 골라져 있게 한다. */
const CURSOR_WAIT = 1000
const LEFT_SAVE_FAILED = '마인드맵의 마지막 변경을 저장하지 못했어요. 마인드맵을 다시 열면 이어서 저장해요.'
const LEFT_CHANGE_LOST = '마인드맵의 마지막 변경을 저장하지 못했어요. 그사이 다른 곳에서 바뀌어 최신 내용을 불러왔어요.'
/** 저장(`PUT /v2/mind-map`)이 실패할 때 앱의 HTTP 도우미가 남기는 console error. */
const saveError = (statuses) => new RegExp(`API Error.*status: (${statuses}).*/v2/mind-map\\b`)

const branchCount = async (page) => Number((await counts(page).locator('strong').first().innerText()).trim())
const undoButton = (page) => button(actionBar(page), '되돌리기')
const mapReady = async (page) => {
  await canvas(page).waitFor()
  await page.waitForFunction(() => document.querySelector('.mind-map-canvas .mind-map-world')?.style.visibility !== 'hidden')
  await settle(page)
}

/**
 * 메뉴로 마인드맵에 돌아온다. PC는 왼쪽 메뉴의 `마인드맵`, 폰은 아래 탭의 `오늘` → 홈 카드의 `크게 보기 →`
 * (폰의 아래 탭에는 마인드맵이 없다). 새로 읽지 않는다.
 */
const returnToMap = async (page, viewport) => {
  if (viewport === 'desktop') await goMenu(page, viewport, '마인드맵', '/app/mind-map')
  else {
    if (!page.url().endsWith('/app/today')) await goMenu(page, viewport, '오늘', '/app/today')
    await todayReady(page, { picture: false })
    await press(page, viewport, homeCard(page).getByRole('link', { name: '크게 보기 →', exact: true }))
    await page.waitForURL(/\/app\/mind-map$/)
  }
  await mapReady(page)
}

/** 메뉴로 오늘 화면에 갔다가 마인드맵으로 돌아온다. */
const roundTrip = async (page, viewport) => {
  await goMenu(page, viewport, '오늘', '/app/today')
  await returnToMap(page, viewport)
}

/** 이제부터 새로 뜨는 토스트 글을 모은다. */
const watchToasts = (page) =>
  page.evaluate(() => {
    window.__mindMapToastObserver?.disconnect()
    const seen = new WeakSet(document.querySelectorAll('.toast__message'))
    const shown = []
    const read = () => {
      for (const el of document.querySelectorAll('.toast__message')) {
        if (seen.has(el)) continue
        seen.add(el)
        shown.push(el.textContent)
      }
    }
    const observer = new MutationObserver(read)
    observer.observe(document.body, { subtree: true, childList: true })
    window.__mindMapToastObserver = observer
    window.__mindMapToasts = shown
  })
const toastsShown = (page) => page.evaluate(() => [...window.__mindMapToasts])
/** 떠 있는 토스트를 모두 닫는다(오류 토스트는 스스로 닫히지 않는다). 같은 문구가 다시 뜨면 새 토스트로 센다. */
const closeToasts = async (page) => {
  const toasts = page.locator('.toast:not([data-state="closing"])')
  while ((await toasts.count()) > 0) await toasts.first().locator('.toast__dismiss').click()
  await page.locator('.toast').first().waitFor({ state: 'detached' }).catch(() => {})
  await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0)
}

/**
 * 맵 저장(`PUT /v2/mind-map`, 기억한 가지 저장은 빼고)이 동시에 몇 개 열려 있었는지 센다. mock은 화면 안의 `fetch`에서 답해
 * 네트워크 요청이 생기지 않으므로(`page.on('request')`에 잡히지 않는다) 화면의 `fetch`를 감싸 센다.
 */
const countSaves = (page) =>
  page.evaluate(() => {
    window.__mindMapSaves = { open: 0, max: 0, total: 0 }
    if (window.__mindMapFetchWrapped) return
    window.__mindMapFetchWrapped = true
    const original = window.fetch
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      const isSave = method === 'PUT' && new URL(url, window.location.href).pathname === '/v2/mind-map'
      const saves = window.__mindMapSaves
      if (isSave) {
        saves.open += 1
        saves.total += 1
        saves.max = Math.max(saves.max, saves.open)
      }
      try {
        return await original(input, init)
      } finally {
        if (isSave) saves.open -= 1
      }
    }
  })

/**
 * 켜 두는 동안 맵 저장(`PUT /v2/mind-map`)을 모두 500으로 답한다. `failNextSave`는 한 번뿐이라, 떠나는 순간의
 * 저장(글 확정과 페이지가 사라질 때의 저장)이 다 실패하는 경우를 화면의 `fetch`를 감싸 만든다.
 */
const failSaves = (page, on) =>
  page.evaluate((fail) => {
    window.__mindMapFailSaves = fail
    if (window.__mindMapFailWrapped) return
    window.__mindMapFailWrapped = true
    const original = window.fetch
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      const isSave = method === 'PUT' && new URL(url, window.location.href).pathname === '/v2/mind-map'
      if (!isSave || !window.__mindMapFailSaves) return original(input, init)
      const body = { status: 500, error: 'Internal Server Error', message: '마인드맵을 저장하지 못했어요.', path: '/v2/mind-map' }
      return new Response(JSON.stringify(body), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  }, on)

/** `run` 동안 `pattern`에 맞는 console error를 기대한 것으로 세고, 그 기록을 돌려준다. */
const expectErrors = async (label, pattern, run) => {
  const start = expectedRejections.length
  expectingRejection = { label, pattern }
  try {
    await run()
    // console 기록은 조금 늦게 온다.
    await new Promise((resolve) => setTimeout(resolve, 150))
  } finally {
    expectingRejection = null
  }
  return expectedRejections.slice(start)
}

/** `전체 보기` 뒤 그 가지를 눌러 고른다(폰은 손가락). 가지가 다른 상자에 가려 있으면 실패한다. */
const pick = async (page, viewport, text) => {
  await press(page, viewport, button(page, '전체 보기'))
  await settle(page)
  const label = nodeByText(page, text).locator('.mind-map-node__label')
  const at = await center(label)
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.mind-map-node__label')?.textContent ?? null, at)
  assert.equal(hit, text, `${text}이(가) 가려 있다`)
  await press(page, viewport, label)
  assert.equal(await selectedLabel(page), text)
  await canvas(page).focus()
}

/** 고른 가지의 글을 고친다(F2는 기존 글을 모두 골라 친 글이 대신한다). `confirm`이 아니면 쓰는 중에 둔다. */
const rewriteSelected = async (page, text, { confirm = true } = {}) => {
  await page.keyboard.press('F2')
  await editingLabel(page).waitFor()
  await page.keyboard.type(text)
  if (!confirm) return
  await page.keyboard.press('Enter')
  await editingLabel(page).waitFor({ state: 'detached' })
}

/**
 * 위 막대: 저장 상태는 제목과 같은 줄 오른쪽 끝에 있고(폰에서 혼자 다음 줄로 밀려나지 않는다), 숫자는 한 줄이다.
 * 저장 상태와 숫자는 막대 안에 다 보인다.
 */
const assertHeaderRows = async (page) => {
  const header = await page.locator('.mind-map-page__bar').evaluate((bar) => {
    const box = (el) => el.getBoundingClientRect()
    /** 글이 놓인 줄 수(줄의 위치가 3px 넘게 다르면 다른 줄). */
    const lines = (el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const tops = [...range.getClientRects()].map((r) => r.top).sort((a, b) => a - b)
      return tops.filter((top, i) => i === 0 || top - tops[i - 1] > 3).length
    }
    const title = box(bar.querySelector('h1'))
    const save = box(bar.querySelector('.mind-map-save'))
    const counts = bar.querySelector('.mind-map-page__counts')
    const frame = box(bar)
    const pad = parseFloat(getComputedStyle(bar).paddingRight)
    return {
      sameRow: Math.abs(save.top + save.height / 2 - (title.top + title.height / 2)) <= 2,
      saveRight: save.right,
      inner: frame.right - pad,
      countLines: lines(counts),
      overflow: bar.scrollWidth > bar.clientWidth,
      children: [...bar.querySelector('.mind-map-save').children].map((el) => {
        const r = box(el)
        return { text: el.textContent, inside: r.left >= frame.left && r.right <= frame.right - pad + 0.5 }
      }),
    }
  })
  assert.ok(header.sameRow, `저장 상태가 제목 줄에 있지 않다 ${JSON.stringify(header)}`)
  assert.ok(Math.abs(header.saveRight - header.inner) <= 0.5, `저장 상태가 오른쪽 끝이 아니다 ${JSON.stringify(header)}`)
  assert.equal(header.countLines, 1, `숫자가 한 줄이 아니다 ${JSON.stringify(header)}`)
  assert.ok(!header.overflow && header.children.every((child) => child.inside), `막대가 넘친다 ${JSON.stringify(header)}`)
}

const walk = async (page, viewport) => {
  await step(
    page,
    viewport,
    'page-open',
    async () => {
      await openInApp(page, '/app/mind-map')
      await canvas(page).waitFor()
      await page.waitForFunction(() => document.querySelector('.mind-map-world')?.style.visibility !== 'hidden')
      assert.equal((await counts(page).innerText()).trim(), '가지 27개 · 맨 끝 가지 17개 · 할 일 2/4')
      const selected = page.locator('.mind-map-node.is-selected')
      assert.equal(await selected.count(), 1)
      assert.equal(await selected.locator('.mind-map-node__label').innerText(), '짐 정리')
      assert.equal(await canvas(page).getAttribute('aria-activedescendant'), await selected.getAttribute('id'))
      // 고른 가지가 캔버스 가운데(가로 가운데, 세로는 위 64·아래 96을 뺀 칸의 가운데)에 있다.
      const frame = await canvas(page).boundingBox()
      const box = await selected.boundingBox()
      const dx = box.x + box.width / 2 - (frame.x + frame.width / 2)
      const dy = box.y + box.height / 2 - (frame.y + 64 + (frame.height - 160) / 2)
      assert.ok(Math.abs(dx) <= 1 && Math.abs(dy) <= 1, `짐 정리가 가운데가 아니다(${dx}, ${dy})`)
      // 배율: PC 100%, 폰 85%.
      const scale = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.mind-map-world')).transform).a)
      assert.equal(scale, viewport === 'mobile' ? 0.85 : 1)
      const look = await page.evaluate(() => {
        const style = (el) => getComputedStyle(el)
        const topic = document.querySelector('.mind-map-node[data-depth="0"]')
        const first = document.querySelector('.mind-map-node[data-depth="1"]')
        const label = (text) =>
          [...document.querySelectorAll('.mind-map-node__label')].find((el) => el.textContent === text)
        const toss = label('버릴 것 고르기')
        const place = label('장소').closest('.mind-map-node')
        return {
          topicBackground: style(topic).backgroundColor,
          blue: style(document.querySelector('.workspace-theme')).getPropertyValue('--workspace-blue').trim(),
          firstBorder: style(first).borderTopWidth,
          firstBorderStyle: style(first).borderTopStyle,
          tossDecoration: style(toss).textDecorationLine,
          tossOpacity: style(toss).opacity,
          tossHasCheck: !!toss.closest('.mind-map-node').querySelector('.mind-map-node__check svg'),
          placeToggle: place.querySelector('.mind-map-node__toggle')?.textContent,
          placeToggleLabel: place.querySelector('.mind-map-node__toggle')?.getAttribute('aria-label'),
          scopeText: (document.querySelector('.top-bar')?.textContent ?? '') + (document.querySelector('main')?.textContent ?? ''),
        }
      })
      assert.equal(look.topicBackground, 'rgb(52, 92, 229)')
      // 1.5px 선. Chromium은 기기 픽셀 배율 1에서 테두리를 1px로 내림해 계산 값을 준다.
      assert.ok(['1px', '1.5px'].includes(look.firstBorder), look.firstBorder)
      assert.equal(look.firstBorderStyle, 'solid')
      assert.equal(look.tossDecoration, 'line-through')
      assert.equal(look.tossOpacity, '0.55')
      assert.equal(look.tossHasCheck, true)
      assert.equal(look.placeToggle, '2')
      assert.equal(look.placeToggleLabel, '가지 펴기')
      assert.ok(!look.scopeText.includes('모든 스페이스'), '범위 표시가 보인다')
      const home = page.getByRole('link', { name: '← 홈', exact: true })
      assert.equal(await home.isVisible(), viewport === 'mobile')
      assert.equal((await saveLabel(page).innerText()).trim(), '저장됨')
      await assertHeaderRows(page)
    },
    { dark: true },
  )

  await step(page, viewport, 'keyboard', async () => {
    const branches = async () => Number((await counts(page).locator('strong').first().innerText()).trim())
    await canvas(page).focus()
    // Tab: 짐 정리 아래 새 가지를 만들고 바로 쓴다.
    await page.keyboard.press('Tab')
    await editingLabel(page).waitFor()
    await page.keyboard.type('이사 짐 목록')
    await recordSaveLabels(page)
    await page.keyboard.press('Enter')
    await editingLabel(page).waitFor({ state: 'detached' })
    await waitSaved(page)
    assert.deepEqual(await savedLabels(page), ['저장됨', '저장 중…', '저장됨'])
    assert.equal(await branches(), 28)
    const added = nodeByText(page, '이사 짐 목록')
    assert.equal(await added.count(), 1)
    assert.match(await added.getAttribute('class'), /is-selected/)
    const addedId = await added.getAttribute('id')
    // 초점은 캔버스로 돌아온다.
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('mind-map-canvas')), true)

    // Enter로 같은 단계 새 가지를 만들고 Esc로 취소하면 사라진다.
    await page.keyboard.press('Enter')
    await editingLabel(page).waitFor()
    assert.equal(await page.locator('.mind-map-node').count(), 28)
    await page.keyboard.press('Escape')
    await editingLabel(page).waitFor({ state: 'detached' })
    assert.equal(await page.locator('.mind-map-node').count(), 27)
    assert.equal(await branches(), 28)
    assert.match(await added.getAttribute('class'), /is-selected/)

    // Delete로 지우고 Ctrl+Z로 같은 가지가 돌아온다.
    await page.keyboard.press('Delete')
    await nodeByText(page, '이사 짐 목록').waitFor({ state: 'detached' })
    assert.equal(await branches(), 27)
    await page.keyboard.press('Control+z')
    await nodeByText(page, '이사 짐 목록').waitFor()
    assert.equal(await nodeByText(page, '이사 짐 목록').getAttribute('id'), addedId)
    assert.equal(await branches(), 28)
    assert.match(await nodeByText(page, '이사 짐 목록').getAttribute('class'), /is-selected/)

    // Ctrl+Enter로 체크박스가 생긴다(체크되지 않은 채). 바로 저장한다.
    await recordSaveLabels(page)
    await page.keyboard.press('Control+Enter')
    await nodeByText(page, '이사 짐 목록').locator('.mind-map-node__check').waitFor()
    assert.equal(await nodeByText(page, '이사 짐 목록').getAttribute('aria-checked'), 'false')
    assert.match(await counts(page).innerText(), /할 일 2\/5$/)
    await waitSaved(page)
    assert.ok((await savedLabels(page)).includes('저장 중…'), '체크박스 저장 상태가 보이지 않았다')
  }, { dark: true })

  await step(
    page,
    viewport,
    'action-bar',
    async () => {
      const bar = actionBar(page)
      const names = await bar.getByRole('button').evaluateAll((list) =>
        list.map((b) => b.querySelector('.mind-map-actions__label').textContent),
      )
      assert.deepEqual(names, ['하위 가지', '같은 단계', '글 고치기', '체크박스', '접기', '삭제', '되돌리기'])
      // 미니 플레이어(진행 중인 Deep Work 블록)가 있어도 단추 줄이 그 위에 보이고 눌린다.
      const player = page.locator('.mini-player-wrapper')
      assert.equal(await player.isVisible(), true, '데모의 미니 플레이어가 보이지 않는다')
      const barBox = await bar.boundingBox()
      const playerBox = await player.boundingBox()
      assert.ok(barBox.y + barBox.height <= playerBox.y, `단추 줄이 미니 플레이어에 가린다(${barBox.y + barBox.height} > ${playerBox.y})`)
      const covered = await bar.getByRole('button').evaluateAll((list) =>
        list
          .filter((b) => {
            const r = b.getBoundingClientRect()
            return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') !== b
          })
          .map((b) => b.textContent),
      )
      assert.deepEqual(covered, [], '가려진 단추')
      // 단축키는 PC에서만 보인다.
      const kbd = bar.locator('kbd').nth(3)
      assert.equal(await kbd.isVisible(), viewport === 'desktop')
      if (viewport === 'desktop') assert.equal(await kbd.innerText(), 'Ctrl ⇧ Enter')

      // 단추를 눌러도 초점은 캔버스에 남는다. 체크박스 붙이기·떼기와 되돌리기.
      await canvas(page).focus()
      const checkbox = button(bar, '체크박스')
      const pressed = await checkbox.getAttribute('aria-pressed')
      await press(page, viewport, checkbox)
      assert.notEqual(await checkbox.getAttribute('aria-pressed'), pressed)
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('mind-map-canvas')), true)
      await press(page, viewport, button(bar, '되돌리기'))
      assert.equal(await checkbox.getAttribute('aria-pressed'), pressed)
      // 하위 가지 단추는 글 쓰기를 시작하고, 쓰는 글에 초점이 간다. Esc로 취소한다.
      await press(page, viewport, button(bar, '하위 가지'))
      await editingLabel(page).waitFor()
      assert.equal(await page.evaluate(() => document.activeElement?.isContentEditable), true)
      await page.keyboard.press('Escape')
      await editingLabel(page).waitFor({ state: 'detached' })
      await waitSaved(page)
    },
    { dark: true },
  )

  if (viewport === 'desktop') {
    // PC 폭이 좁으면(900~1,215px) 단축키를 숨겨 일곱 단추가 캔버스 안에 다 보인다. 1280px에서는 단축키가 보인다.
    await step(page, viewport, 'action-bar-narrow', async () => {
      for (const size of [
        { width: 900, height: 860 },
        { width: 1024, height: 768 },
        { width: 1280, height: 860 },
      ]) {
        await page.setViewportSize(size)
        await page.waitForTimeout(150)
        const fit = await actionBar(page).evaluate((bar) => {
          const frame = document.querySelector('.mind-map-canvas').getBoundingClientRect()
          return {
            kbd: getComputedStyle(bar.querySelector('kbd')).display !== 'none',
            buttons: [...bar.querySelectorAll('button')].map((b) => {
              const r = b.getBoundingClientRect()
              const label = b.querySelector('.mind-map-actions__label')
              return {
                text: label.textContent,
                inside: r.left >= frame.left && r.right <= frame.right,
                clipped: b.scrollWidth > b.clientWidth || label.scrollWidth > label.clientWidth,
                right: Math.round(r.right),
                frameRight: Math.round(frame.right),
              }
            }),
          }
        })
        for (const b of fit.buttons) {
          assert.ok(b.inside, `${size.width}px ${b.text}: 캔버스 밖(${b.right} > ${b.frameRight})`)
          assert.ok(!b.clipped, `${size.width}px ${b.text}: 잘린다`)
        }
        assert.equal(fit.kbd, size.width >= 1280, `${size.width}px 단축키 보임: ${fit.kbd}`)
        await page.screenshot({ path: path.join(output, `${viewport}-action-bar-${size.width}.png`) })
      }
    })
  }

  if (viewport === 'mobile') {
    await step(page, viewport, 'actions-fit', async () => {
      const fit = await actionBar(page).evaluate((bar) => {
        const buttons = [...bar.querySelectorAll('button')]
        return {
          bar: { scrollWidth: bar.scrollWidth, clientWidth: bar.clientWidth },
          buttons: buttons.map((b) => {
            const label = b.querySelector('.mind-map-actions__label')
            const r = b.getBoundingClientRect()
            const l = label.getBoundingClientRect()
            const pad = parseFloat(getComputedStyle(b).paddingLeft)
            return {
              text: label.textContent,
              scrollWidth: b.scrollWidth,
              clientWidth: b.clientWidth,
              height: b.offsetHeight,
              lines: label.getClientRects().length,
              labelWidth: Math.round(l.width * 10) / 10,
              // 가운데 맞춤이라 넘치면 왼쪽으로도 넘친다. scrollWidth는 왼쪽 넘침을 세지 않아 따로 잰다.
              inside: l.left >= r.left + pad - 0.5 && l.right <= r.right - pad + 0.5,
            }
          }),
        }
      })
      console.log(`actions-fit 390px: ${JSON.stringify(fit)}`)
      assert.ok(fit.bar.scrollWidth <= fit.bar.clientWidth, '단추 줄이 넘친다')
      for (const b of fit.buttons) {
        assert.ok(b.scrollWidth <= b.clientWidth, `${b.text}: 단추가 넘친다`)
        assert.equal(b.lines, 1, `${b.text}: 글이 두 줄이다`)
        assert.ok(b.inside, `${b.text}: 글(${b.labelWidth}px)이 단추 안쪽(${b.clientWidth}px)을 넘는다`)
      }
      assert.equal(new Set(fit.buttons.map((b) => b.height)).size, 1, '단추 높이가 다르다')
    })
  }

  await step(page, viewport, 'drag-child', async () => {
    const toss = nodeByText(page, '버릴 것 고르기')
    const moveDay = nodeByText(page, '이사 당일')
    await dragBetween(page, viewport, await center(toss.locator('.mind-map-node__label')), await center(moveDay), async () => {
      await page.locator('.mind-map-node.is-drop').filter({ hasText: '이사 당일' }).waitFor()
      assert.equal(await page.locator('.mind-map-insert-line').count(), 0)
      assert.equal(await page.locator('.mind-map-ghost').innerText(), '버릴 것 고르기')
    })
    assert.equal(await page.locator('.mind-map-node.is-drop').count(), 0)
    assert.equal(await page.locator('.mind-map-ghost').count(), 0)
    assert.equal(await selectedLabel(page), '버릴 것 고르기')
    assert.equal(await toss.getAttribute('aria-level'), String(Number(await moveDay.getAttribute('aria-level')) + 1))
    assert.equal(await parentOfSelected(page), '이사 당일')
    await waitSaved(page)
  })

  await step(page, viewport, 'drag-between', async () => {
    const rooms = nodeByText(page, '방마다 포장하기')
    const boxes = nodeByText(page, '박스와 테이프 사기')
    assert.equal(await boxes.getAttribute('aria-posinset'), '1')
    await dragBetween(page, viewport, await center(rooms.locator('.mind-map-node__label')), await pointIn(boxes, 0.2), async () => {
      const line = page.locator('.mind-map-insert-line')
      await line.waitFor()
      const lineBox = await line.boundingBox()
      const target = await boxes.boundingBox()
      assert.equal(Math.round(lineBox.height), 3)
      assert.ok(Math.abs(lineBox.y - (target.y - 5)) <= 1, `선이 가지 위에 있지 않다(${lineBox.y}, ${target.y})`)
      assert.equal(await page.locator('.mind-map-node.is-drop').count(), 0)
      await captureHeld(page, viewport, 'drag-between')
    })
    assert.equal(await rooms.getAttribute('aria-posinset'), '1')
    assert.equal(await boxes.getAttribute('aria-posinset'), '2')
    assert.equal(await parentOfSelected(page), '짐 정리')
    await waitSaved(page)
  })

  await step(page, viewport, 'drag-self', async () => {
    const packing = nodeByText(page, '짐 정리')
    const child = nodeByText(page, '박스와 테이프 사기')
    const before = await packing.evaluate((el) => [el.getAttribute('aria-level'), el.getAttribute('aria-posinset')])
    const order = () => page.locator('.mind-map-node[aria-level="4"]').evaluateAll((list) => list.map((el) => el.textContent))
    const childrenBefore = await order()
    await recordSaveLabels(page)
    await dragBetween(page, viewport, await center(packing.locator('.mind-map-node__label')), await center(child), async () => {
      assert.equal(await page.locator('.mind-map-ghost').innerText(), '짐 정리')
      await page.waitForTimeout(100)
      assert.equal(await page.locator('.mind-map-node.is-drop').count(), 0, '자기 아래에 놓는 표시가 있다')
      assert.equal(await page.locator('.mind-map-insert-line').count(), 0, '자기 아래에 끼우는 선이 있다')
    })
    assert.deepEqual(await packing.evaluate((el) => [el.getAttribute('aria-level'), el.getAttribute('aria-posinset')]), before)
    assert.deepEqual(await order(), childrenBefore)
    if (viewport === 'desktop') {
      // 이미 주제의 자식인 가지는 주제 위에 놓을 수 없다(폰은 주제가 화면 왼쪽 끝에 걸쳐 PC에서만 본다).
      const workshop = nodeByText(page, '팀 워크숍')
      const topic = page.locator('.mind-map-node[data-depth="0"]')
      const posinset = await workshop.getAttribute('aria-posinset')
      await dragBetween(page, viewport, await center(workshop), await center(topic), async () => {
        assert.equal(await page.locator('.mind-map-ghost').innerText(), '팀 워크숍')
        await page.waitForTimeout(100)
        assert.equal(await page.locator('.mind-map-node.is-drop').count(), 0, '주제에 놓는 표시가 있다')
      })
      assert.equal(await workshop.getAttribute('aria-posinset'), posinset)
    }
    await page.waitForTimeout(1200)
    assert.deepEqual(await savedLabels(page), ['저장됨'], '바뀌지 않았는데 저장했다')
  })

  await step(
    page,
    viewport,
    'pan-zoom',
    async () => {
      // 빈 곳을 끌면 화면이 같은 만큼 움직인다.
      const frame = await canvas(page).boundingBox()
      const from = { x: frame.x + 24, y: frame.y + 90 }
      const empty = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return !!el?.closest('.mind-map-canvas') && !el.closest('.mind-map-node')
      }, from)
      assert.ok(empty, '빈 곳이 아니다')
      const start = await worldOffset(page)
      await dragBetween(page, viewport, from, { x: from.x + 60, y: from.y + 40 })
      const moved = await worldOffset(page)
      assert.ok(Math.abs(moved.x - start.x - 60) <= 1 && Math.abs(moved.y - start.y - 40) <= 1, JSON.stringify({ start, moved }))
      // + 두 번이면 1.2 × 1.2배(PC 100% → 144%, 폰 85% → 122%).
      const expected = `${Math.round(moved.k * 144)}%`
      await press(page, viewport, button(page, '확대'))
      await press(page, viewport, button(page, '확대'))
      await page.waitForFunction((text) => document.querySelector('.mind-map-zoom output')?.textContent === text, expected)
      if (viewport === 'desktop') {
        assert.equal(expected, '144%')
        // 휠은 이동, Ctrl+휠은 확대(exp(0.2)배 → 176%), 축소 단추는 1.2로 나눈다(147%).
        const before = await worldOffset(page)
        await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2)
        await page.mouse.wheel(0, 100)
        await page.waitForFunction((y) => {
          const m = new DOMMatrix(getComputedStyle(document.querySelector('.mind-map-world')).transform)
          return Math.abs(m.f - (y - 100)) <= 1
        }, before.y)
        await page.keyboard.down('Control')
        await page.mouse.wheel(0, -20)
        await page.keyboard.up('Control')
        await page.waitForFunction(() => document.querySelector('.mind-map-zoom output')?.textContent === '176%')
        await button(page, '축소').click()
        await page.waitForFunction(() => document.querySelector('.mind-map-zoom output')?.textContent === '147%')
      }
      // 전체 보기 뒤 주제와 맨 아래 가지가 캔버스 안에 있다.
      await press(page, viewport, button(page, '전체 보기'))
      await page.waitForTimeout(100)
      const inside = await page.evaluate(() => {
        const frame = document.querySelector('.mind-map-canvas').getBoundingClientRect()
        const nodes = [...document.querySelectorAll('.mind-map-canvas .mind-map-node')].map((el) => ({
          text: el.textContent,
          depth: el.dataset.depth,
          r: el.getBoundingClientRect(),
        }))
        const topic = nodes.find((n) => n.depth === '0')
        const lowest = nodes.reduce((a, b) => (b.r.bottom > a.r.bottom ? b : a))
        const within = (r) => r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom
        return { topic: within(topic.r), lowest: lowest.text, lowestInside: within(lowest.r), all: nodes.every((n) => within(n.r)) }
      })
      assert.ok(inside.topic && inside.lowestInside && inside.all, JSON.stringify(inside))
      if (viewport === 'mobile') {
        // 두 손가락을 100px에서 200px로 벌리면 배율이 두 배다(CDP 터치 두 점. 실제 기기는 확인하지 못했다).
        const fitK = (await worldOffset(page)).k
        const cdp = await page.context().newCDPSession(page)
        const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
        const y = frame.y + 120
        await send('touchStart', [{ x: 145, y, id: 1 }])
        await send('touchStart', [{ x: 145, y, id: 1 }, { x: 245, y, id: 2 }])
        for (let i = 1; i <= 10; i++) await send('touchMove', [{ x: 145 - 5 * i, y, id: 1 }, { x: 245 + 5 * i, y, id: 2 }])
        await page.waitForTimeout(120)
        await send('touchEnd', [])
        await cdp.detach()
        const pinched = `${Math.round(Math.min(2, fitK * 2) * 100)}%`
        await page.waitForFunction((text) => document.querySelector('.mind-map-zoom output')?.textContent === text, pinched)
        await press(page, viewport, button(page, '전체 보기'))
      }
    },
    { dark: true },
  )

  await step(
    page,
    viewport,
    'double-click-edit',
    async () => {
      const boxes = nodeByText(page, '박스와 테이프 사기')
      if (viewport === 'mobile') {
        const at = await center(boxes.locator('.mind-map-node__label'))
        await page.touchscreen.tap(at.x, at.y)
        await page.touchscreen.tap(at.x, at.y)
      } else {
        await boxes.locator('.mind-map-node__label').dblclick()
      }
      await editingLabel(page).waitFor()
      assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '박스와 테이프 사기')
      // 쓰는 글 상자 안을 누르면 고르기·확정을 하지 않고 계속 쓴다.
      const label = editingLabel(page)
      if (viewport === 'mobile') await label.tap()
      else await label.click()
      assert.equal(await editingLabel(page).count(), 1)
      assert.equal(await selectedLabel(page), '박스와 테이프 사기')
      await page.keyboard.press('Escape')
      await editingLabel(page).waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('mind-map-canvas')), true)
      if (viewport === 'desktop') {
        // 끌 수 없는 주제를 끈 누르기는 두 번 누르기로 세지 않는다.
        const topic = await center(page.locator('.mind-map-node[data-depth="0"]'))
        for (let i = 0; i < 2; i++) {
          await page.mouse.move(topic.x, topic.y)
          await page.mouse.down()
          await page.mouse.move(topic.x + 20, topic.y + 10, { steps: 3 })
          await page.mouse.up()
        }
        await page.waitForTimeout(100)
        assert.equal(await editingLabel(page).count(), 0, '움직인 누르기 두 번에 글 고치기가 열렸다')
      }
    },
    { dark: true },
  )

  // ---- 흐름(Task 14). 앞 단계가 남긴 맵에서 이어 간다. 새로 읽지 않는다. ----

  await step(page, viewport, 'split-fast', async () => {
    // 짐 정리를 고르고 쉬지 않고 키를 친다.
    await pick(page, viewport, '짐 정리')
    const before = await branchCount(page)
    await recordSaveLabels(page)
    for (const key of ['Tab', '냉장고 비우기', 'Enter', 'Enter', '전기 해지', 'Tab', '한전 전화', 'Enter']) {
      if (key === 'Tab' || key === 'Enter') await page.keyboard.press(key)
      else await page.keyboard.type(key)
    }
    await editingLabel(page).waitFor({ state: 'detached' })
    await waitSaved(page)
    assert.equal((await savedLabels(page)).at(-1), '저장됨')
    assert.equal(await branchCount(page), before + 3)
    assert.equal(await selectedLabel(page), '한전 전화')
    // 메뉴로 오늘에 갔다가 돌아와도 셋이 그대로다(한전 전화 ← 전기 해지 ← 짐 정리, 냉장고 비우기는 전기 해지의 형).
    await page.waitForTimeout(CURSOR_WAIT)
    await roundTrip(page, viewport)
    assert.equal(await branchCount(page), before + 3)
    for (const text of ['냉장고 비우기', '전기 해지', '한전 전화']) assert.equal(await nodeByText(page, text).count(), 1, text)
    const place = (text) => nodeByText(page, text).evaluate((el) => [el.getAttribute('aria-level'), el.getAttribute('aria-posinset')])
    const [fridgeLevel, fridgeAt] = await place('냉장고 비우기')
    const [powerLevel, powerAt] = await place('전기 해지')
    assert.equal(fridgeLevel, powerLevel)
    assert.equal(Number(powerAt), Number(fridgeAt) + 1)
    assert.equal(await selectedLabel(page), '한전 전화')
    assert.equal(await parentOfSelected(page), '전기 해지')
    assert.equal(await parentOfSelected(page), '짐 정리')
    assert.equal(String(Number(await nodeByText(page, '짐 정리').getAttribute('aria-level')) + 1), fridgeLevel)
  })

  await step(page, viewport, 'rapid-split', async () => {
    // 짐 정리에서 Tab·글·Enter를 다섯 번. 응답이 1.5초씩 늦어 저장이 겹치려 한다.
    assert.equal(await selectedLabel(page), '짐 정리')
    const before = await branchCount(page)
    await watchToasts(page)
    await countSaves(page)
    await page.evaluate(() => window.__pinitMock.setLatency(1500))
    try {
      for (let i = 1; i <= 5; i++) {
        await page.keyboard.press('Tab')
        await page.keyboard.type(`빠른 가지 ${i}`)
        await page.keyboard.press('Enter')
      }
      await editingLabel(page).waitFor({ state: 'detached' })
      await page.waitForFunction(
        () => window.__mindMapSaves.open === 0 && document.querySelector('.mind-map-save__label')?.textContent === '저장됨',
        null,
        { timeout: 30_000 },
      )
    } finally {
      await page.evaluate(() => window.__pinitMock.setLatency(0))
    }
    const saves = await page.evaluate(() => ({ ...window.__mindMapSaves }))
    console.log(`rapid-split 맵 저장 요청: ${JSON.stringify(saves)}`)
    assert.equal(saves.max, 1, `저장이 동시에 ${saves.max}개 열렸다`)
    assert.ok(saves.total >= 2, `저장이 ${saves.total}번뿐이다`)
    assert.equal(await branchCount(page), before + 5)
    for (let i = 1; i <= 5; i++) assert.equal(await nodeByText(page, `빠른 가지 ${i}`).count(), 1)
    assert.equal(await selectedLabel(page), '빠른 가지 5')
    assert.deepEqual(await toastsShown(page), [])
  })

  await step(page, viewport, 'ime-guard', async () => {
    // 한글 조합 중의 Enter(isComposing)와 Tab(keyCode 229)은 확정하지도 가지를 만들지도 않는다.
    const before = await branchCount(page)
    const nodes = await page.locator('.mind-map-node').count()
    await page.keyboard.press('F2')
    await editingLabel(page).waitFor()
    const sent = await editingLabel(page).evaluate((label) => {
      const enter = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })
      const tab = new KeyboardEvent('keydown', { key: 'Tab', keyCode: 229, bubbles: true, cancelable: true })
      label.dispatchEvent(enter)
      label.dispatchEvent(tab)
      return { enter: enter.isComposing, tab: tab.keyCode }
    })
    assert.deepEqual(sent, { enter: true, tab: 229 })
    await page.waitForTimeout(100)
    assert.equal(await editingLabel(page).count(), 1, '쓰기가 끝났다')
    assert.equal(await editingLabel(page).innerText(), '빠른 가지 5')
    assert.equal(await page.evaluate(() => document.activeElement?.isContentEditable), true)
    assert.equal(await branchCount(page), before)
    assert.equal(await page.locator('.mind-map-node').count(), nodes)
    await capture(page, viewport, 'ime-guard-writing')
    await page.keyboard.press('Escape')
    await editingLabel(page).waitFor({ state: 'detached' })
  })

  await step(page, viewport, 'type-to-edit', async () => {
    // 고른 가지에서 글자를 치면 그 글자가 기존 글을 대신하고 계속 쓴다.
    assert.equal(await selectedLabel(page), '빠른 가지 5')
    await page.keyboard.press('x')
    await editingLabel(page).waitFor()
    assert.equal(await editingLabel(page).innerText(), 'x')
    await page.keyboard.press('y')
    assert.equal(await editingLabel(page).innerText(), 'xy')
    await capture(page, viewport, 'type-to-edit-writing')
    await page.keyboard.press('Escape')
    await editingLabel(page).waitFor({ state: 'detached' })
    assert.equal(await selectedLabel(page), '빠른 가지 5')
  })

  await step(
    page,
    viewport,
    'save-failed',
    async () => {
      await page.evaluate(() => window.__pinitMock.mindMap.failNextSave('server'))
      const logged = await expectErrors('save-failed', saveError('500'), async () => {
        await rewriteSelected(page, '고친 가지 5')
        await page.waitForFunction(() => document.querySelector('.mind-map-save__label')?.textContent === '저장하지 못함')
      })
      assert.ok(logged.some((line) => /status: 500/.test(line)), '500을 받지 않았다')
      const retry = page.locator('.mind-map-save__retry')
      assert.equal(await retry.innerText(), '다시 시도')
      assert.equal(await nodeByText(page, '고친 가지 5').count(), 1)
      assert.equal(await selectedLabel(page), '고친 가지 5')
      // 폰에서도 이유와 다시 시도가 막대 안 제목 줄에 들어간다.
      await assertHeaderRows(page)
      await capture(page, viewport, 'save-failed-state')
      await press(page, viewport, retry)
      await waitSaved(page)
      assert.equal(await retry.count(), 0)
      assert.equal(await nodeByText(page, '고친 가지 5').count(), 1)
    },
    { dark: true },
  )

  await step(page, viewport, 'lost-save', async () => {
    // 서버는 반영했지만 응답(503)을 잃은 저장. 다음 저장이 409를 받아도 자기 저장이라 안내 없이 다시 보낸다.
    await canvas(page).focus()
    await watchToasts(page)
    await page.evaluate(() => window.__pinitMock.mindMap.failNextSave('lost'))
    const logged = await expectErrors('lost-save', saveError('503|409'), async () => {
      await page.keyboard.press('ArrowLeft')
      assert.equal(await selectedLabel(page), '빠른 가지 4')
      await rewriteSelected(page, '잃은 저장 4')
      await page.waitForFunction(() => document.querySelector('.mind-map-save__label')?.textContent === '저장하지 못함')
      await page.keyboard.press('ArrowLeft')
      assert.equal(await selectedLabel(page), '빠른 가지 3')
      await rewriteSelected(page, '두 번째 3')
      await waitSaved(page)
    })
    assert.ok(logged.some((line) => /status: 503/.test(line)), '503을 받지 않았다')
    assert.ok(logged.some((line) => /status: 409/.test(line)), '두 번째 저장이 409를 받지 않았다')
    await page.waitForTimeout(300)
    assert.deepEqual(await toastsShown(page), [])
    assert.equal(await page.locator('.mind-map-save__retry').count(), 0)
    // 메뉴로 나갔다 와도 두 글이 다 있다.
    await page.waitForTimeout(CURSOR_WAIT)
    await roundTrip(page, viewport)
    for (const text of ['잃은 저장 4', '두 번째 3']) assert.equal(await nodeByText(page, text).count(), 1, text)
    for (const text of ['빠른 가지 4', '빠른 가지 3']) assert.equal(await nodeByText(page, text).count(), 0, text)
    assert.equal(await selectedLabel(page), '두 번째 3')
  })

  await step(
    page,
    viewport,
    'conflict',
    async () => {
      // 다른 기기가 먼저 고친 뒤 가지를 지운다(1초 뒤 저장) → 409: 한 번 안내하고 최신 맵으로 바꾼다.
      assert.equal(await selectedLabel(page), '두 번째 3')
      await watchToasts(page)
      await page.evaluate(() => window.__pinitMock.mindMap.remoteEdit())
      const logged = await expectErrors('conflict', saveError('409'), async () => {
        await page.keyboard.press('Delete')
        await nodeByText(page, '두 번째 3').waitFor({ state: 'detached' })
        assert.equal(await undoButton(page).isEnabled(), true)
        await nodeByText(page, '두 번째 3').waitFor()
      })
      assert.ok(logged.some((line) => /status: 409/.test(line)), '409를 받지 않았다')
      assert.equal(await nodeByText(page, '이사 준비 (다른 기기)').count(), 1)
      assert.equal(await nodeByText(page, '잃은 저장 4').count(), 1, '지운 가지의 아래가 돌아오지 않았다')
      assert.equal(await undoButton(page).isDisabled(), true)
      await page.locator('.toast__message', { hasText: CONFLICT_TOAST }).waitFor()
      await capture(page, viewport, 'conflict-toast')
      await waitSaved(page)
      await page.waitForTimeout(1500)
      assert.deepEqual(await toastsShown(page), [CONFLICT_TOAST])
    },
    { dark: true },
  )

  await step(page, viewport, 'focus-refetch', async () => {
    await canvas(page).focus()
    const selected = await selectedLabel(page)
    // 되돌릴 것이 있게 체크박스를 붙인다(바로 저장).
    await page.keyboard.press('Control+Enter')
    await waitSaved(page)
    assert.equal(await undoButton(page).isEnabled(), true)
    await watchToasts(page)
    // 창이 다시 활성화되면 안내 없이 다른 기기의 맵으로 바꾸고 되돌리기를 비운다.
    await page.evaluate(() => window.__pinitMock.mindMap.remoteEdit())
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await nodeByText(page, '이사 준비 (다른 기기) (다른 기기)').waitFor({ state: 'attached' })
    assert.equal(await undoButton(page).isDisabled(), true)
    assert.equal(await selectedLabel(page), selected)
    // 쓰는 중에는 바꾸지 않는다.
    await page.keyboard.press('F2')
    await editingLabel(page).waitFor()
    await page.evaluate(() => window.__pinitMock.mindMap.remoteEdit())
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(300)
    assert.equal(await editingLabel(page).count(), 1)
    assert.equal(await nodeByText(page, '이사 준비 (다른 기기) (다른 기기)').count(), 1)
    assert.equal(await nodeByText(page, '이사 준비 (다른 기기) (다른 기기) (다른 기기)').count(), 0)
    await page.keyboard.press('Escape')
    await editingLabel(page).waitFor({ state: 'detached' })
    // 쓰기를 마친 뒤 다시 활성화되면 따라잡는다.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await nodeByText(page, '이사 준비 (다른 기기) (다른 기기) (다른 기기)').waitFor({ state: 'attached' })
    assert.deepEqual(await toastsShown(page), [])
  })

  await step(
    page,
    viewport,
    'limits',
    async () => {
      // 하위 가지에 101자를 붙여 넣는다. 100자까지만 들어가고 안내가 뜨며 계속 쓴다.
      await page.keyboard.press('Tab')
      await editingLabel(page).waitFor()
      await watchToasts(page)
      const long = '가나다라마바사아자차'.repeat(10) + '끝'
      assert.equal([...long].length, 101)
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
      await page.evaluate((text) => navigator.clipboard.writeText(text), long)
      await page.keyboard.press('Control+V')
      await page.locator('.toast__message', { hasText: '글은 100자까지 쓸 수 있어요.' }).waitFor()
      assert.equal(await editingLabel(page).count(), 1)
      assert.equal(await page.evaluate(() => document.activeElement?.isContentEditable), true)
      assert.equal(await editingLabel(page).innerText(), long.slice(0, 100))
      // 붙여 넣은 글이 이미 한도 안으로 잘려 있으므로 Enter는 100자를 확정한다(안내는 한 번).
      await page.keyboard.press('Enter')
      await editingLabel(page).waitFor({ state: 'detached' })
      assert.equal(await selectedLabel(page), long.slice(0, 100))
      await waitSaved(page)
      assert.deepEqual(await toastsShown(page), ['글은 100자까지 쓸 수 있어요.'])
    },
    { dark: true },
  )

  await step(
    page,
    viewport,
    'delete-cursor',
    async () => {
      // 긴 가지를 형 두 번째 3 앞으로 올리고(Alt+↑) 지우면 다음 가지(두 번째 3)가 골라진다. 홈 카드도 그 가지 주변이다.
      const doomed = await selectedLabel(page)
      await page.keyboard.press('Alt+ArrowUp')
      assert.equal(await nodeByText(page, doomed).getAttribute('aria-posinset'), '1')
      await page.keyboard.press('Delete')
      await nodeByText(page, doomed).waitFor({ state: 'detached' })
      assert.equal(await selectedLabel(page), '두 번째 3')
      await page.waitForTimeout(CURSOR_WAIT)
      await waitSaved(page)
      await goMenu(page, viewport, '오늘', '/app/today')
      await todayReady(page)
      await assertCardPicture(page, viewport, '두 번째 3', viewport === 'mobile' ? 200 : 220)
      await homeCard(page).scrollIntoViewIfNeeded()
      await settle(page)
    },
    { dark: true },
  )

  await step(page, viewport, 'leave-saves', async () => {
    // 글을 쓰는 중에 메뉴의 통계로 떠나도 쓰던 글이 확정·저장된다.
    await returnToMap(page, viewport)
    assert.equal(await selectedLabel(page), '두 번째 3')
    await rewriteSelected(page, '떠나며 확정', { confirm: false })
    await goMenu(page, viewport, '통계', '/app/statistics')
    await returnToMap(page, viewport)
    assert.equal(await nodeByText(page, '떠나며 확정').count(), 1)
    assert.equal(await nodeByText(page, '두 번째 3').count(), 0)
    assert.equal(await editingLabel(page).count(), 0)
    assert.equal((await saveLabel(page).innerText()).trim(), '저장됨')
  })

  await step(page, viewport, 'leave-fails', async () => {
    // 떠나며 건 저장이 실패하면 다른 화면에서 알리고, 다시 들어오면 그 나무로 시작해 이어서 저장한다.
    assert.equal(await selectedLabel(page), '떠나며 확정')
    await watchToasts(page)
    await failSaves(page, true)
    const logged = await expectErrors('leave-fails', saveError('500'), async () => {
      await rewriteSelected(page, '떠나며 실패', { confirm: false })
      await goMenu(page, viewport, '통계', '/app/statistics')
      await page.locator('.toast__message', { hasText: LEFT_SAVE_FAILED }).waitFor()
    })
    await failSaves(page, false)
    assert.ok(logged.some((line) => /status: 500/.test(line)), '500을 받지 않았다')
    await capture(page, viewport, 'leave-fails-toast')
    await returnToMap(page, viewport)
    assert.equal(await nodeByText(page, '떠나며 실패').count(), 1)
    await waitSaved(page)
    assert.deepEqual(await toastsShown(page), [LEFT_SAVE_FAILED])
    // 서버에 들어갔다: 나갔다 와도 그대로다.
    await page.waitForTimeout(CURSOR_WAIT)
    await roundTrip(page, viewport)
    assert.equal(await nodeByText(page, '떠나며 실패').count(), 1)
    assert.equal(await selectedLabel(page), '떠나며 실패')

    // 그사이 다른 곳에서 바뀌었으면 덮지 않고 알린다.
    await closeToasts(page)
    await canvas(page).focus()
    await watchToasts(page)
    await failSaves(page, true)
    await expectErrors('leave-fails-moved', saveError('500'), async () => {
      await rewriteSelected(page, '덮으면 안 되는 글', { confirm: false })
      await goMenu(page, viewport, '통계', '/app/statistics')
      await page.locator('.toast__message', { hasText: LEFT_SAVE_FAILED }).waitFor()
    })
    await failSaves(page, false)
    await page.evaluate(() => window.__pinitMock.mindMap.remoteEdit())
    await returnToMap(page, viewport)
    await page.locator('.toast__message', { hasText: LEFT_CHANGE_LOST }).waitFor()
    assert.equal(await nodeByText(page, '덮으면 안 되는 글').count(), 0)
    assert.equal(await nodeByText(page, '떠나며 실패').count(), 1)
    assert.equal(await page.locator('.mind-map-node__label', { hasText: /\(다른 기기\)$/ }).count() > 0, true)
    assert.equal((await saveLabel(page).innerText()).trim(), '저장됨')
    assert.deepEqual(await toastsShown(page), [LEFT_SAVE_FAILED, LEFT_CHANGE_LOST])
    await capture(page, viewport, 'leave-fails-moved-toast')
    await closeToasts(page)
    await canvas(page).focus()
  })

  await step(
    page,
    viewport,
    'a11y',
    async () => {
      const tree = await page.evaluate(() => {
        const canvas = document.querySelector('.mind-map-canvas')
        const nodes = [...canvas.querySelectorAll('.mind-map-node')]
        const byText = (text) => nodes.find((el) => el.querySelector('.mind-map-node__label')?.textContent === text)
        const attrs = (text, names) => Object.fromEntries(names.map((name) => [name, byText(text).getAttribute(name)]))
        const selected = nodes.filter((el) => el.getAttribute('aria-selected') === 'true')
        return {
          role: canvas.getAttribute('role'),
          active: canvas.getAttribute('aria-activedescendant'),
          selectedIds: selected.map((el) => el.id),
          selectedClass: selected.map((el) => el.classList.contains('is-selected')),
          roles: [...new Set(nodes.map((el) => el.getAttribute('role')))],
          others: [...new Set(nodes.filter((el) => !selected.includes(el)).map((el) => el.getAttribute('aria-selected')))],
          place: attrs('장소', ['aria-expanded', 'aria-checked']),
          packing: attrs('짐 정리', ['aria-expanded', 'aria-checked']),
          toss: attrs('버릴 것 고르기', ['aria-checked', 'aria-expanded']),
          boxes: attrs('박스와 테이프 사기', ['aria-checked']),
          leaf: attrs('예산과 지역 정하기', ['aria-expanded', 'aria-checked']),
        }
      })
      assert.equal(tree.role, 'tree')
      assert.equal(tree.selectedIds.length, 1)
      assert.equal(tree.active, tree.selectedIds[0])
      assert.deepEqual(tree.selectedClass, [true])
      assert.deepEqual(tree.roles, ['treeitem'])
      assert.deepEqual(tree.others, ['false'])
      assert.deepEqual(tree.place, { 'aria-expanded': 'false', 'aria-checked': null })
      assert.deepEqual(tree.packing, { 'aria-expanded': 'true', 'aria-checked': null })
      assert.deepEqual(tree.toss, { 'aria-checked': 'true', 'aria-expanded': null })
      assert.deepEqual(tree.boxes, { 'aria-checked': 'false' })
      assert.deepEqual(tree.leaf, { 'aria-expanded': null, 'aria-checked': null })
      assert.equal(await canvas(page).getAttribute('aria-activedescendant'), await page.locator('.mind-map-node.is-selected').getAttribute('id'))
      // 쓰는 글 상자는 이름이 있는 글 상자다. 키보드로 캔버스에 돌아오면 초점 테두리가 보인다.
      await canvas(page).focus()
      await page.keyboard.press('F2')
      await editingLabel(page).waitFor()
      assert.deepEqual(
        await editingLabel(page).evaluate((el) => [el.getAttribute('role'), el.getAttribute('aria-label')]),
        ['textbox', '가지 글'],
      )
      await page.keyboard.press('Escape')
      await editingLabel(page).waitFor({ state: 'detached' })
      const ring = await canvas(page).evaluate((el) => ({
        focused: document.activeElement === el,
        visible: el.matches(':focus-visible'),
        style: getComputedStyle(el).outlineStyle,
        width: getComputedStyle(el).outlineWidth,
      }))
      assert.deepEqual(ring, { focused: true, visible: true, style: 'solid', width: '2px' })
      assert.equal(await page.locator('.mind-map-node__label[role]').count(), 0)
      // 저장 상태는 바뀔 때마다 알리지 않고, 저장하지 못한 이유만 알린다.
      const save = await page.locator('.mind-map-save').evaluate((el) => ({
        role: el.getAttribute('role'),
        live: [...el.querySelectorAll('[aria-live]')].map((child) => [child.className, child.getAttribute('aria-live')]),
      }))
      assert.deepEqual(save, { role: null, live: [['mind-map-save__reason', 'polite']] })
      await capture(page, viewport, 'a11y-focus-ring')
    },
    { dark: true },
  )
}

// ---- 오늘 화면(`/app/today`)의 홈 카드 ----

/**
 * 설계 §7.2 "실제 화면에서 확인한 것"의 패널 시작 위치(px, 맨 위로 올린 화면에서). mock의 일정·작업은 오늘 날짜에 따라
 * 바뀌어 높이가 날마다 다르므로 이 값과 맞추지 않고, 잰 값과 나란히 적기만 한다.
 */
const DESIGN_TOPS = {
  desktop: { tasks: 296, schedules: 612 },
  mobile: { tasks: 375, schedules: 2792 },
}

const bottomTabs = (page) => page.getByRole('navigation', { name: '모바일 주 메뉴', exact: true })
const sidebar = (page) => page.locator('aside.workspace-sidebar')
/** 메뉴(PC 왼쪽 메뉴의 두 묶음, 폰 아래 탭)로 옮긴다. 새로 읽지 않는다. */
const goMenu = async (page, viewport, name, pathname) => {
  const scope = viewport === 'mobile' ? bottomTabs(page) : sidebar(page)
  await press(page, viewport, scope.getByRole('link', { name, exact: true }))
  await page.waitForURL(new RegExp(`${pathname}$`))
}
const homeCard = (page) => page.locator('section.mind-map-card')
const cardPreview = (page) => homeCard(page).locator('.mind-map-card__preview')
const cardAbout = (page) => homeCard(page).locator('.mind-map-card__about')
const cardSelected = (page) => cardPreview(page).locator('.mind-map-node.is-selected .mind-map-node__label').innerText()
const foldButton = (page) => homeCard(page).locator('.workspace-panel__head button')

/** 두 패널이 다 그려지고 카드의 그림이 자리를 잡을 때까지 기다린다. */
const todayReady = async (page, { picture = true } = {}) => {
  await page.locator('.today-workspace').waitFor()
  await page.waitForFunction(() => !document.querySelector('.today-workspace .today-page__loading'))
  if (picture)
    await page.waitForFunction(() => {
      const world = document.querySelector('.mind-map-card__preview .mind-map-world')
      return world && world.style.visibility !== 'hidden'
    })
  await settle(page)
}

/** 페이지를 맨 위(또는 맨 아래)로 올린다. 오늘 화면은 본문 상자가 스크롤한다. */
const scrollTodayTo = (page, where) =>
  page.evaluate((end) => {
    const scrollers = [document.scrollingElement]
    for (let el = document.querySelector('.today-workspace'); el; el = el.parentElement)
      if (el.scrollHeight > el.clientHeight) scrollers.push(el)
    for (const el of scrollers) el.scrollTop = end ? el.scrollHeight : 0
  }, where === 'bottom')

/**
 * "오늘의 작업"·"오늘의 일정"·카드의 상자를 맨 위로 올린 화면에서 잰다. `withoutCard`면 카드가 없던 때의 배치로 잰 뒤 되돌린다:
 * 카드를 `display: none`으로 숨기고, 카드 때문에 더한 grid 영역을 끄고 두 패널을 자동 배치로 둔다(카드 전의 TodayPage.css).
 */
const todayBoxes = async (page, withoutCard = false) => {
  await scrollTodayTo(page, 'top')
  return page.evaluate((remove) => {
    const workspace = document.querySelector('.today-workspace')
    const card = document.querySelector('.mind-map-card')
    const panel = (title) =>
      [...workspace.querySelectorAll('.workspace-panel h2')].find((h) => h.textContent === title).closest('.workspace-panel')
    const tasksPanel = panel('오늘의 작업')
    const schedulesPanel = panel('오늘의 일정')
    if (remove) {
      card.style.display = 'none'
      workspace.style.gridTemplateAreas = 'none'
      workspace.style.gridTemplateRows = 'none'
      tasksPanel.style.gridArea = 'auto'
      schedulesPanel.style.gridArea = 'auto'
    }
    const rect = (el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }
    }
    const out = {
      tasks: rect(tasksPanel),
      schedules: rect(schedulesPanel),
      card: remove ? null : rect(card),
      rowGap: parseFloat(getComputedStyle(workspace).rowGap),
    }
    card.style.display = ''
    workspace.style.gridTemplateAreas = ''
    workspace.style.gridTemplateRows = ''
    tasksPanel.style.gridArea = ''
    schedulesPanel.style.gridArea = ''
    return out
  }, withoutCard)
}

/**
 * 카드가 있어도 "오늘의 작업"은 제자리이고, "오늘의 일정"은 한 칸이면 제자리, 두 칸이면 카드 높이 + 간격만큼만 내려간다.
 * 카드가 없던 때의 배치(`todayBoxes(page, true)`)와 비교한다.
 */
const assertPanelsStay = (shown, removed, columns, label) => {
  const where = `${label}: 카드 있음 ${JSON.stringify({ tasks: shown.tasks.top, schedules: shown.schedules.top })}, 카드 없음 ${JSON.stringify({ tasks: removed.tasks.top, schedules: removed.schedules.top })}`
  assert.ok(near(shown.tasks.top, removed.tasks.top), `오늘의 작업이 움직였다 ${where}`)
  if (columns === 2) {
    const moved = shown.schedules.top - removed.schedules.top
    assert.ok(near(moved, shown.card.height + shown.rowGap), `오늘의 일정이 ${moved}px 내려갔다(카드 ${shown.card.height} + 간격 ${shown.rowGap}) ${where}`)
  } else {
    assert.ok(near(shown.schedules.top, removed.schedules.top), `오늘의 일정이 움직였다 ${where}`)
  }
}

/** mock은 화면 안에서 답해 네트워크 응답 이벤트가 없다. 앱의 HTTP 도우미가 남기는 console 기록으로 응답을 기다린다. */
const consoleSeen = (page, pattern) =>
  new Promise((resolve) => {
    const listen = (message) => {
      if (!pattern.test(message.text())) return
      page.off('console', listen)
      resolve()
    }
    page.on('console', listen)
  })

const near = (actual, expected, tolerance = 0.5) => Math.abs(actual - expected) <= tolerance

/** 카드가 있는 자리: 두 칸이면 오른쪽 칸 맨 위("오늘의 일정" 위), 한 칸이면 "오늘의 일정" 다음 맨 아래. */
const assertCardPlace = (boxes, columns, label) => {
  const { tasks, schedules, card, rowGap } = boxes
  const where = `${label}: ${JSON.stringify(boxes)}`
  if (columns === 2) {
    assert.ok(card.left > tasks.right, `카드가 오른쪽 칸이 아니다 ${where}`)
    assert.ok(near(card.left, schedules.left) && near(card.right, schedules.right), `카드와 일정의 칸이 다르다 ${where}`)
    assert.ok(near(card.top, tasks.top), `카드가 오른쪽 칸 맨 위가 아니다 ${where}`)
    assert.ok(near(schedules.top, card.bottom + rowGap), `일정이 카드 바로 아래가 아니다 ${where}`)
  } else {
    assert.ok(near(card.left, tasks.left) && near(card.right, tasks.right), `카드가 한 칸 전체 폭이 아니다 ${where}`)
    assert.ok(near(card.top, schedules.bottom + rowGap), `카드가 일정 바로 다음이 아니다 ${where}`)
  }
}

/** 고른 가지에 선택 테두리가 있고 그림 상자 안에 보인다. 배율은 PC 90%, 폰 80%. */
const assertCardPicture = async (page, viewport, text, height) => {
  assert.equal((await cardAbout(page).innerText()).trim(), `${text} 주변`)
  assert.equal(await cardSelected(page), text)
  const look = await cardPreview(page).evaluate((preview) => {
    const frame = preview.getBoundingClientRect()
    const world = preview.querySelector('.mind-map-world')
    const selected = preview.querySelector('.mind-map-node.is-selected')
    const r = selected.getBoundingClientRect()
    return {
      height: frame.height,
      k: new DOMMatrix(getComputedStyle(world).transform).a,
      inside: r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom,
      outline: getComputedStyle(selected).outlineStyle,
      worldEvents: getComputedStyle(world).pointerEvents,
      href: preview.getAttribute('href'),
      label: preview.getAttribute('aria-label'),
      readonly: world.classList.contains('mind-map-world--readonly'),
    }
  })
  assert.equal(look.height, height)
  assert.equal(look.k, viewport === 'mobile' ? 0.8 : 0.9)
  assert.ok(look.inside, `${text}가 그림 상자 밖이다`)
  assert.equal(look.outline, 'solid')
  assert.equal(look.worldEvents, 'none')
  assert.equal(look.href, '/app/mind-map')
  assert.equal(look.label, '마인드맵 크게 보기')
  assert.equal(look.readonly, true)
}

const checkOverflow = async (page, width, label) => {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  assert.ok(scrollWidth <= width, `${label}: 가로로 넘친다(${scrollWidth}px)`)
}

/** 홈 카드. 맵을 바꾸는 단계가 있어 새 창(처음 상태의 mock)에서 걷는다. */
const walkToday = async (viewport, openContext) => {
  {
    const { context, page } = await openContext()
    await login(page)
    await page.waitForURL(/\/app\/today$/)
    await todayReady(page)

    await step(
      page,
      viewport,
      viewport === 'mobile' ? 'today-mobile' : 'today-desktop',
      async () => {
        const columns = viewport === 'mobile' ? 1 : 2
        const shown = await todayBoxes(page)
        const removed = await todayBoxes(page, true)
        const design = DESIGN_TOPS[viewport]
        // 오늘 잰 절대 위치는 기록만 한다(mock 데이터가 날짜에 따라 바뀐다). 판단은 카드가 없던 때와의 차이로 한다.
        console.log(
          `${viewport} 패널 위치(오늘 잰 값): 오늘의 작업 ${shown.tasks.top}, 오늘의 일정 ${shown.schedules.top}` +
            ` / 카드 없음 ${removed.tasks.top}, ${removed.schedules.top} / 설계 ${design.tasks}, ${design.schedules}` +
            ` / 카드 ${JSON.stringify(shown.card)}`,
        )
        assertPanelsStay(shown, removed, columns, viewport)
        assertCardPlace(shown, columns, viewport)
        // 머리: 제목(초점을 받지 않는다), 고른 가지 주변, 크게 보기, 접기.
        const head = homeCard(page).locator('.workspace-panel__head')
        assert.equal(await head.locator('h2').innerText(), '마인드맵')
        assert.equal(await head.locator('h2').getAttribute('tabindex'), null)
        assert.equal(await homeCard(page).getAttribute('aria-label'), '마인드맵')
        assert.equal(await head.getByRole('link', { name: '크게 보기 →', exact: true }).getAttribute('href'), '/app/mind-map')
        assert.equal(await foldButton(page).innerText(), '접기')
        assert.equal(await foldButton(page).getAttribute('aria-expanded'), 'true')
        await assertCardPicture(page, viewport, '짐 정리', viewport === 'mobile' ? 200 : 220)
        // 체크박스와 체크된 가지의 취소선이 페이지와 같게 보인다.
        const done = await cardPreview(page).locator('.mind-map-node[data-check="DONE"] .mind-map-node__label').first()
        if (await done.count()) assert.equal(await done.evaluate((el) => getComputedStyle(el).textDecorationLine), 'line-through')
        if (viewport === 'mobile') {
          // 끝까지 내린 화면을 찍는다.
          await scrollTodayTo(page, 'bottom')
          await settle(page)
          const card = await homeCard(page).boundingBox()
          assert.ok(card.y + card.height <= viewports.mobile.height, '끝까지 내려도 카드가 화면 아래로 잘린다')
        }
      },
      { dark: true },
    )

    if (viewport === 'desktop') {
      // 1100px은 두 칸(오른쪽 위), 1000px은 한 칸(맨 아래).
      await step(page, viewport, 'today-1000-1100', async () => {
        for (const [width, columns, height] of [[1100, 2, 220], [1000, 1, 200]]) {
          await page.setViewportSize({ width, height: 860 })
          await page.waitForTimeout(150)
          await settle(page)
          const boxes = await todayBoxes(page)
          console.log(`${width}px 위치: ${JSON.stringify(boxes)}`)
          assertPanelsStay(boxes, await todayBoxes(page, true), columns, `${width}px`)
          assertCardPlace(boxes, columns, `${width}px`)
          await assertCardPicture(page, viewport, '짐 정리', height)
          await checkOverflow(page, width, `${width}px`)
          if (columns === 1) {
            await homeCard(page).scrollIntoViewIfNeeded()
            await settle(page)
          }
          await page.screenshot({ path: path.join(output, `${viewport}-today-${width}.png`) })
          await page.evaluate(() => {
            document.documentElement.dataset.theme = 'dark'
          })
          await settle(page)
          await page.screenshot({ path: path.join(output, `${viewport}-today-${width}-dark.png`) })
          await page.evaluate(() => {
            delete document.documentElement.dataset.theme
          })
        }
        await page.setViewportSize(viewports.desktop)
        await page.waitForTimeout(150)
        await scrollTodayTo(page, 'top')
      })
    }

    await step(page, viewport, 'card-fold', async () => {
      await scrollTodayTo(page, 'top')
      const open = await homeCard(page).boundingBox()
      await homeCard(page).scrollIntoViewIfNeeded()
      await press(page, viewport, foldButton(page))
      assert.equal(await foldButton(page).innerText(), '펴기')
      assert.equal(await foldButton(page).getAttribute('aria-expanded'), 'false')
      const controls = await foldButton(page).getAttribute('aria-controls')
      assert.equal(await page.locator(`[id="${controls}"]`).isHidden(), true)
      assert.equal(await cardPreview(page).isVisible(), false)
      assert.equal(await homeCard(page).getByRole('link', { name: '크게 보기 →', exact: true }).isVisible(), true)
      const head = await homeCard(page).locator('.workspace-panel__head').boundingBox()
      const folded = await homeCard(page).boundingBox()
      assert.ok(near(folded.height, head.height + 2, 1), `접은 카드에 머리 줄 밖의 것이 남았다(${folded.height}, ${head.height})`)
      assert.ok(folded.height < open.height)
      assert.equal(await page.evaluate(() => localStorage.getItem('pinit.mindMap.cardCollapsed')), '1')
      // 새로 읽지 않고 메뉴로 다른 화면에 갔다가 돌아와도 접혀 있다.
      await goMenu(page, viewport, '일정', '/app/schedules')
      await goMenu(page, viewport, '오늘', '/app/today')
      await todayReady(page, { picture: false })
      assert.equal(await foldButton(page).innerText(), '펴기')
      assert.equal(await cardPreview(page).isVisible(), false)
      if (viewport === 'mobile') {
        await homeCard(page).scrollIntoViewIfNeeded()
        await settle(page)
      }
    }, { dark: true })

    await step(page, viewport, 'card-unfold', async () => {
      await press(page, viewport, foldButton(page))
      assert.equal(await foldButton(page).innerText(), '접기')
      assert.equal(await foldButton(page).getAttribute('aria-expanded'), 'true')
      await todayReady(page)
      assert.equal(await page.evaluate(() => localStorage.getItem('pinit.mindMap.cardCollapsed')), '0')
      await assertCardPicture(page, viewport, '짐 정리', viewport === 'mobile' ? 200 : 220)
      await homeCard(page).scrollIntoViewIfNeeded()
      await settle(page)
    })

    await step(page, viewport, 'card-open', async () => {
      // 그림을 누르면 페이지로 가고, 같은 가지가 골라져 있다.
      await press(page, viewport, cardPreview(page))
      await page.waitForURL(/\/app\/mind-map$/)
      await canvas(page).waitFor()
      await page.waitForFunction(() => document.querySelector('.mind-map-canvas .mind-map-world')?.style.visibility !== 'hidden')
      assert.equal(await selectedLabel(page), '짐 정리')
      // 페이지에서 이사 준비를 고르고, 기억한 가지 저장(800ms 뒤)을 기다린 뒤 메뉴의 오늘로 돌아온다.
      const cursorSaved = consoleSeen(page, /API Response.*status: 204.*\/v2\/mind-map\/cursor\b/)
      await press(page, viewport, nodeByText(page, '이사 준비').locator('.mind-map-node__label'))
      assert.equal(await selectedLabel(page), '이사 준비')
      await cursorSaved
      await goMenu(page, viewport, '오늘', '/app/today')
      await todayReady(page)
      await assertCardPicture(page, viewport, '이사 준비', viewport === 'mobile' ? 200 : 220)
      await homeCard(page).scrollIntoViewIfNeeded()
      await settle(page)
    }, { dark: true })
    await context.close()
  }

  {
    // 주제만 있는 맵(pinit 계정은 저장한 맵이 없다).
    const { context, page } = await openContext()
    expectingRejection = { label: 'pinit active schedule', pattern: PINIT_ACTIVE_SCHEDULE_ERROR }
    await login(page, { username: 'pinit', password: 'pinit' })
    await page.waitForURL(/\/app\/today$/)
    await step(page, viewport, 'card-empty', async () => {
      await todayReady(page, { picture: false })
      await homeCard(page).getByText('큰 일을 가지로 쪼개 보세요.', { exact: true }).waitFor()
      const open = homeCard(page).getByRole('link', { name: '마인드맵 열기', exact: true })
      assert.equal(await open.getAttribute('href'), '/app/mind-map')
      assert.match(await open.getAttribute('class'), /workspace-button/)
      assert.equal(await cardPreview(page).count(), 0)
      await homeCard(page).scrollIntoViewIfNeeded()
      await settle(page)
    }, { dark: true })
    await context.close()
    expectingRejection = null
  }

  {
    // 처음 읽기가 실패해도 오늘 화면의 다른 부분은 그려지고, 카드 안에서 다시 시도할 수 있다.
    // 로그인하면 앱이 곧바로 오늘 화면을 열어 맵을 읽으므로, 실패는 로그인 화면에서 미리 건다.
    const { context, page } = await openContext()
    await step(page, viewport, 'card-error', async () => {
      expectingRejection = { label: 'mind-map first load', pattern: MIND_MAP_LOAD_ERROR }
      try {
        await login(page, {
          beforeSubmit: async () => {
            await page.waitForFunction(() => window.__pinitMock?.mindMap)
            await page.evaluate(() => window.__pinitMock.mindMap.failNextLoad(true))
          },
        })
        await page.waitForURL(/\/app\/today$/)
        const failure = homeCard(page).locator('.workspace-inline-error')
        await failure.waitFor()
        // 카드는 서버 문구를 보인다(BE `MindMapErrorMessages.UNREADABLE`).
        assert.match(await failure.innerText(), /저장된 마인드맵을 읽지 못했어요\. 잠시 후 다시 시도해 주세요\./)
      } finally {
        expectingRejection = null
      }
      await todayReady(page, { picture: false })
      assert.ok((await page.locator('.today-workspace__tasks .workspace-task').count()) > 0, '오늘의 작업이 그려지지 않았다')
      assert.ok((await page.locator('.today-workspace__schedules .today-page__schedule-row').count()) > 0, '오늘의 일정이 그려지지 않았다')
      assert.equal(await cardPreview(page).count(), 0)
      await homeCard(page).scrollIntoViewIfNeeded()
      await settle(page)
    }, { dark: true })
    await step(page, viewport, 'card-retry', async () => {
      await press(page, viewport, homeCard(page).getByRole('button', { name: '다시 시도', exact: true }))
      await todayReady(page)
      assert.equal(await homeCard(page).locator('.workspace-inline-error').count(), 0)
      await assertCardPicture(page, viewport, '짐 정리', viewport === 'mobile' ? 200 : 220)
      await homeCard(page).scrollIntoViewIfNeeded()
      await settle(page)
    })
    await step(page, viewport, 'card-refetch-error', async () => {
      // 맵을 가진 뒤 다시 읽기가 실패하면(메뉴로 오늘 화면을 다시 연다) 그림은 그대로다.
      await goMenu(page, viewport, '일정', '/app/schedules')
      await page.evaluate(() => window.__pinitMock.mindMap.failNextLoad(true))
      expectingRejection = { label: 'mind-map reload', pattern: MIND_MAP_LOAD_ERROR }
      try {
        const failed = consoleSeen(page, /API Error.*status: 500.*\/v2\/mind-map\b/)
        await goMenu(page, viewport, '오늘', '/app/today')
        await failed
        await page.waitForTimeout(100)
      } finally {
        expectingRejection = null
      }
      await todayReady(page)
      assert.equal(await homeCard(page).locator('.workspace-inline-error').count(), 0)
      await assertCardPicture(page, viewport, '짐 정리', viewport === 'mobile' ? 200 : 220)
      await homeCard(page).scrollIntoViewIfNeeded()
      await settle(page)
    })
    await context.close()
  }
}

/** 왼쪽 메뉴의 차례·간격과 폰의 아래 탭·설정 줄(Task 13). */
const walkMenu = async (viewport, openContext, size) => {
  const { context, page } = await openContext()
  await login(page)
  await page.waitForURL(/\/app\/today$/)
  await todayReady(page, { picture: false })
  if (viewport === 'desktop') {
    await step(
      page,
      viewport,
      'sidebar',
      async () => {
        // 그리는 차례: 로고 → 내 화면 → 스페이스 상자 → 스페이스 메뉴 → 프로젝트 → 관리.
        const order = await sidebar(page).evaluate((aside) =>
          [...aside.querySelectorAll('.workspace-brand, nav, .space-switcher, .space-projects-nav')].map((el) =>
            el.matches('nav') ? el.getAttribute('aria-label') : el.className.split(' ')[0],
          ),
        )
        console.log(`사이드바 차례 ${JSON.stringify(order)}`)
        const names = (label) => sidebar(page).getByRole('navigation', { name: label, exact: true }).getByRole('link').allInnerTexts()
        assert.deepEqual((await names('내 화면')).map((text) => text.trim()), ['오늘', '마인드맵', '통계'])
        assert.deepEqual((await names('스페이스 메뉴')).map((text) => text.trim()), ['스페이스', '일정', '작업', '작업 맵'])
        // 보이는 묶음 제목이 없다(관리의 이름표는 기존 것).
        assert.equal(await sidebar(page).getByText('나만 보기', { exact: true }).count(), 0)
        assert.equal(await sidebar(page).getByText('내 화면', { exact: true }).count(), 0)
        const gaps = await sidebar(page).evaluate((aside) => {
          const bottom = (el) => el.getBoundingClientRect().bottom
          const top = (el) => el.getBoundingClientRect().top
          const brand = aside.querySelector('.workspace-brand')
          const mine = aside.querySelector('nav[aria-label="내 화면"]')
          const box = aside.querySelector('.space-switcher')
          const after = aside.querySelector('nav[aria-label="스페이스 메뉴"]')
          return {
            logoToGroup: top(mine.firstElementChild) - bottom(brand),
            groupToBox: top(box) - bottom(mine.lastElementChild),
            boxToSpaceMenu: top(after) - bottom(box),
          }
        })
        console.log(`사이드바 간격 ${JSON.stringify(gaps)}`)
        assert.ok(near(gaps.logoToGroup, 24, 1), `로고→내 화면 ${gaps.logoToGroup}px ≠ 24px`)
        assert.ok(near(gaps.groupToBox, 18, 1), `내 화면→스페이스 상자 ${gaps.groupToBox}px ≠ 18px`)
      },
      { dark: true },
    )
    // 마인드맵을 누르면 그 항목이 active다.
    await step(page, viewport, 'sidebar-mind-map-active', async () => {
      await goMenu(page, viewport, '마인드맵', '/app/mind-map')
      await canvas(page).waitFor()
      const link = sidebar(page).getByRole('link', { name: '마인드맵', exact: true })
      assert.match((await link.getAttribute('class')) ?? '', /\bactive\b/)
      assert.equal(await sidebar(page).locator('nav a.active').count(), 1)
    }, { dark: true })
    await goMenu(page, viewport, '오늘', '/app/today')
    // 화면 전환(View Transition)이 끝난 뒤에 창 크기를 바꾼다. 도중에 바꾸면 브라우저가 전환을 중단하고 pageerror를 낸다.
    await page.waitForFunction(() => !document.documentElement.matches(':active-view-transition'))
    // 900px: 메뉴가 보이고 마인드맵이 있다. 899px: 사이드바가 없고 아래 탭이 그대로다.
    await page.setViewportSize({ width: 900, height: 860 })
    await step(page, viewport, 'sidebar-900', async () => {
      await sidebar(page).waitFor({ state: 'visible' })
      assert.equal(await sidebar(page).getByRole('link', { name: '마인드맵', exact: true }).isVisible(), true)
      assert.equal(await bottomTabs(page).isVisible(), false)
    })
    await page.setViewportSize({ width: 899, height: 860 })
    await step(page, viewport, 'sidebar-899', async () => {
      assert.equal(await sidebar(page).isVisible(), false)
      assert.deepEqual((await bottomTabs(page).getByRole('link').allInnerTexts()).map((text) => text.trim()), ['오늘', '일정', '작업', '작업 맵', '통계'])
    })
    await page.setViewportSize(size)
  } else {
    await step(page, viewport, 'bottom-tabs', async () => {
      assert.equal(await sidebar(page).isVisible(), false)
      assert.deepEqual((await bottomTabs(page).getByRole('link').allInnerTexts()).map((text) => text.trim()), ['오늘', '일정', '작업', '작업 맵', '통계'])
    })
    await step(page, viewport, 'settings-row', async () => {
      await press(page, viewport, page.getByRole('button', { name: '설정', exact: true }))
      await page.waitForURL(/\/app\/settings$/)
      const row = page.getByRole('link', { name: /^마인드맵 큰 일을/ })
      assert.equal(await page.getByRole('region', { name: '마인드맵', exact: true }).locator('h2').innerText(), '마인드맵')
      assert.equal(await row.getAttribute('class'), 'settings__row settings__row--link')
    }, { dark: true })
    await press(page, viewport, page.getByRole('link', { name: /^마인드맵 큰 일을/ }))
    await page.waitForURL(/\/app\/mind-map$/)
    await canvas(page).waitFor()
    await press(page, viewport, page.getByRole('link', { name: '← 홈', exact: true }))
    await page.waitForURL(/\/app\/today$/)
  }
  await context.close()
}

let browser
try {
  await mkdir(output, { recursive: true })
  browser = await chromium.launch()
  const only = process.env.QA_VIEWPORT
  /** `QA_TODAY=1`이면 오늘 화면의 홈 카드 단계만 걷는다. */
  const onlyToday = process.env.QA_TODAY === '1'
  /** `QA_MENU=1`이면 왼쪽 메뉴·아래 탭·설정 줄 단계만 걷는다. */
  const onlyMenu = process.env.QA_MENU === '1'
  const open = async (viewport, size) => {
    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      timezoneId: 'Asia/Seoul',
      serviceWorkers: 'block',
      hasTouch: viewport === 'mobile',
    })
    context.setDefaultTimeout(10_000)
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(`${viewport} pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (expectingRejection?.pattern.test(text))
        expectedRejections.push(`${viewport} ${expectingRejection.label}: ${text.split("\n")[0]}`)
      else errors.push(`${viewport} console: ${text}`)
    })
    return { context, page }
  }
  for (const [viewport, size] of Object.entries(viewports)) {
    if (only && only !== viewport) continue
    if (!onlyToday && !onlyMenu) {
      const { context, page } = await open(viewport, size)
      await login(page)
      await walk(page, viewport)
      await context.close()
    }
    if (!onlyMenu) await walkToday(viewport, () => open(viewport, size))
    if (!onlyToday) await walkMenu(viewport, () => open(viewport, size), size)
  }
  for (const line of expectedRejections) console.log(`expected ${line}`)
  assert.deepEqual(errors, [], `브라우저 오류:\n${errors.join('\n')}`)
  console.log('mind-map local check passed')
} finally {
  await browser?.close()
  await server?.close()
}
