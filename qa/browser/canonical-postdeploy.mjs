import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const CANONICAL = 'https://pinit.go-gradually.me'
const API = 'https://mono.pinit.go-gradually.me'
const SCOPES = ['mcp:read', 'mcp:write', 'mcp:delete']
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
class SmokeFailure extends Error {}
function check(value, code) {
  if (!value) throw new SmokeFailure(code)
}
async function read(url) {
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  check(response.ok, 'CANONICAL_PUBLIC_READ_FAILED')
  return Buffer.from(await response.arrayBuffer())
}
async function run() {
  check(process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REPOSITORY === 'Pinit-Scheduler/pinit-fe' && process.env.GITHUB_REF === 'refs/heads/master', 'TRUSTED_MASTER_REQUIRED')
  // Public SW bytes are env-independent. Vercel's existing Firebase env can
  // change the JS bundle, so deployment git SHA/READY is checked separately.
  const swFiles = await Promise.all(['/sw.js', '/sw/constants.js'].map(async (path) => [path, await readFile(new URL('../../public' + path, import.meta.url))]))
  const expectedSw = new Map(swFiles.map(([path, bytes]) => [path, digest(bytes)]))
  const expectedCache = /CACHE_NAME:\s*'(pinit-cache-v\d+)'/.exec(swFiles[1][1].toString('utf8'))?.[1]
  check(expectedCache, 'CANONICAL_SW_VERSION_REQUIRED')
  const actualAssets = new Map()
  let paths = []
  let ready = false
  for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    try {
      const html = (await read(CANONICAL + '/')).toString('utf8')
      paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map((match) => match[1])
      check(paths.length >= 2 && paths.length <= 10 && paths.every((path) => /^\/assets\/[A-Za-z0-9._-]+$/.test(path)), 'CANONICAL_ASSET_SET_REQUIRED')
      for (const [path, expected] of expectedSw) check(digest(await read(CANONICAL + path)) === expected, 'CANONICAL_SW_VERSION_REQUIRED')
      actualAssets.clear()
      for (const path of paths) {
        const bytes = await read(CANONICAL + path)
        check(bytes.length > 0 && bytes.length <= 5_000_000 && !bytes.subarray(0, 100).toString('utf8').includes('<!doctype html>'), 'CANONICAL_ASSET_SET_REQUIRED')
        actualAssets.set(path, digest(bytes))
      }
      ready = true
    } catch { ready = false }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  check(ready, 'CANONICAL_RELEASE_NOT_READY')
  const health = JSON.parse((await read(API + '/actuator/health/readiness')).toString('utf8'))
  const metadata = JSON.parse((await read(API + '/.well-known/oauth-authorization-server')).toString('utf8'))
  check(health.status === 'UP' && metadata.scopes_supported?.length === SCOPES.length && SCOPES.every((scope) => metadata.scopes_supported.includes(scope)), 'BACKEND_NOT_READY')
  const browser = await chromium.launch({ headless: true })
  try {
    // Genuine canonical CDN/SW only. No route, accounts, login submission,
    // fixture writes, imported credentials, screenshots or report files.
    const context = await browser.newContext({ viewport: { width: 390, height: 400 }, locale: 'ko-KR', serviceWorkers: 'allow' })
    context.setDefaultTimeout(20_000)
    context.setDefaultNavigationTimeout(30_000)
    const page = await context.newPage()
    await page.goto(CANONICAL + '/login', { waitUntil: 'load' })
    await page.getByRole('heading', { name: '아이디와 비밀번호로 바로 시작', exact: true }).waitFor()
    await page.getByLabel('아이디', { exact: true }).focus()
    check(await page.getByLabel('아이디', { exact: true }).evaluate((element) => element === document.activeElement), 'ERROR_FIELD_FOCUS_REQUIRED')
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'HORIZONTAL_OVERFLOW')
    await page.waitForFunction(async (cacheName) => Boolean((await navigator.serviceWorker.ready).active) && (await caches.keys()).includes(cacheName), expectedCache, { timeout: 30_000 })
    await context.close()
  } finally { await browser.close() }
  for (const hash of actualAssets.values()) process.stdout.write('CANONICAL_ASSET_SHA256 ' + hash + '\n')
  process.stdout.write('CANONICAL_POSTDEPLOY ' + JSON.stringify({ ok: true, count: paths.length, cache: expectedCache }) + '\n')
}
run().catch((error) => {
  // Never forward fetch/Playwright exceptions, URLs, response bodies or secrets.
  process.stdout.write('CANONICAL_POSTDEPLOY ' + JSON.stringify({ ok: false, code: error instanceof SmokeFailure ? error.message : 'CANONICAL_SMOKE_FAILED' }) + '\n')
  process.exitCode = 1
})
