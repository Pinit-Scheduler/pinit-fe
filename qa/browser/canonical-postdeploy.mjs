import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { CANONICAL, API } from './constants.mjs'
import { check, evidence, failureCode, QaFailure } from './safe.mjs'
import { assertNoOverflow } from './ui.mjs'

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function read(url) {
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  check(response.ok, 'CANONICAL_PUBLIC_READ_FAILED')
  return Buffer.from(await response.arrayBuffer())
}
async function run() {
  check(process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REPOSITORY === 'Pinit-Scheduler/pinit-fe' && process.env.GITHUB_REF === 'refs/heads/master', 'TRUSTED_MASTER_REQUIRED')
  // The Vercel build may contain its existing Firebase env values whereas the
  // candidate QA build intentionally has no platform secrets. Do not incorrectly
  // require their JS hashes to match. Public SW files are env-independent and
  // are compared byte-for-byte; actual canonical asset hashes are recorded.
  const expectedSw = new Map(await Promise.all(['/sw.js', '/sw/constants.js'].map(async (path) => [path, digest(await readFile(new URL('../../public' + path, import.meta.url)))])))
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
      let spacesBundle = false
      for (const path of paths) {
        const bytes = await read(CANONICAL + path)
        check(bytes.length > 0 && bytes.length <= 5_000_000 && !bytes.subarray(0, 100).toString('utf8').includes('<!doctype html>'), 'CANONICAL_ASSET_SET_REQUIRED')
        actualAssets.set(path, digest(bytes))
        if (path.endsWith('.js') && bytes.includes(Buffer.from('mcp:spaces'))) spacesBundle = true
      }
      ready = spacesBundle
    } catch { ready = false }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
  check(ready, 'CANONICAL_RELEASE_NOT_READY')
  const health = JSON.parse((await read(API + '/actuator/health/readiness')).toString('utf8'))
  const metadata = JSON.parse((await read(API + '/.well-known/oauth-authorization-server')).toString('utf8'))
  check(health.status === 'UP' && metadata.scopes_supported?.includes('mcp:spaces'), 'BACKEND_NOT_READY')
  const browser = await chromium.launch({ headless: true })
  try {
    // No route/fulfill at all: this is the actual canonical CDN and real SW.
    // No accounts, signup, login submission, fixture writes or stored credentials.
    const context = await browser.newContext({ viewport: { width: 390, height: 400 }, locale: 'ko-KR', serviceWorkers: 'allow' })
    const page = await context.newPage()
    await page.goto(CANONICAL + '/login', { waitUntil: 'load' })
    await page.getByRole('heading', { name: '아이디와 비밀번호로 바로 시작', exact: true }).waitFor()
    await page.getByLabel('아이디', { exact: true }).focus()
    check(await page.getByLabel('아이디', { exact: true }).evaluate((element) => element === document.activeElement), 'ERROR_FIELD_FOCUS_REQUIRED')
    await assertNoOverflow(page)
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.ready).active) && (await caches.keys()).includes('pinit-cache-v26'), undefined, { timeout: 30_000 })
    await context.close()
  } finally { await browser.close() }
  for (const hash of actualAssets.values()) evidence('transport', { code: 'CANONICAL_POSTDEPLOY', ok: true, sha256: hash, sourceHead: process.env.GITHUB_SHA })
  evidence('result', { code: 'CANONICAL_POSTDEPLOY', ok: true, count: paths.length })
}
run().catch((error) => { evidence('result', { code: failureCode(error), status: error instanceof QaFailure ? error.status : undefined, ok: false }); process.exitCode = 1 })
