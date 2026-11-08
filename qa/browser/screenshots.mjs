import { mkdirSync, unlinkSync } from 'node:fs'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CANONICAL, RUNTIME } from './constants.mjs'
import { check, evidence, QaFailure } from './safe.mjs'

const NAMES = ['spaces-desktop', 'spaces-mobile', 'spaces-dark']
const DIRECTORY = new URL('screenshots/', RUNTIME)
const MANIFEST = new URL('screenshots.json', RUNTIME)
const MAX_BYTES = 80 * 1_024
const MAX_TOTAL_BYTES = MAX_BYTES * NAMES.length
const BASE64_CHUNK = 8 * 1_024
const MASK = 'input, textarea, pre, code, [contenteditable], a[href*="invite" i], a[href*="invitation" i], [data-secret]'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const imageFile = (name) => new URL(`${name}.jpg`, DIRECTORY)

async function assertFinalSpace(page) {
  const url = new URL(page.url())
  check(url.origin === CANONICAL && url.pathname === '/app/spaces' && !url.search && !url.hash, 'SCREENSHOT_FINAL_SPACE_REQUIRED')
  check(await page.getByRole('heading', { name: '공간·프로젝트 관리', exact: true }).isVisible(), 'SCREENSHOT_FINAL_SPACE_REQUIRED')
  check(await page.getByText('공간을 불러오는 중…', { exact: true }).count() === 0, 'SCREENSHOT_FINAL_SPACE_REQUIRED')
  check(await page.locator('[role="dialog"]:visible, dialog[open], input[type="password"], form[action*="login" i], form[action*="signin" i]').count() === 0, 'SCREENSHOT_DIALOG_PRESENT')
}

export function prepareScreenshotRun() {
  mkdirSync(DIRECTORY, { recursive: true, mode: 0o700 })
  for (const file of [new URL('test-passed.json', RUNTIME), MANIFEST, ...NAMES.map(imageFile)]) {
    try { unlinkSync(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

async function readManifest() {
  try {
    const stat = await lstat(MANIFEST)
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2_048, 'SCREENSHOT_MANIFEST_INVALID')
    const entries = JSON.parse(await readFile(MANIFEST, 'utf8'))
    check(Array.isArray(entries) && entries.length <= NAMES.length, 'SCREENSHOT_MANIFEST_INVALID')
    const names = new Set()
    for (const entry of entries) {
      check(entry && Object.keys(entry).sort().join(',') === 'bytes,name,sha256', 'SCREENSHOT_MANIFEST_INVALID')
      check(NAMES.includes(entry.name) && !names.has(entry.name), 'SCREENSHOT_MANIFEST_INVALID')
      check(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= MAX_BYTES, 'SCREENSHOT_MANIFEST_INVALID')
      check(typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256), 'SCREENSHOT_MANIFEST_INVALID')
      names.add(entry.name)
    }
    return entries
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw new QaFailure('SCREENSHOT_MANIFEST_INVALID')
  }
}

// These images show genuine candidate dist bytes at the canonical browser origin.
// They do not prove that the canonical CDN/service worker has delivered the release.
export async function captureFinalSpace(page, name) {
  try {
    check(NAMES.includes(name), 'SCREENSHOT_NAME_REQUIRED')
    await assertFinalSpace(page)
    const viewport = page.viewportSize()
    check(viewport && viewport.width >= 320 && viewport.width <= 1_920 && viewport.height >= 240 && viewport.height <= 1_400, 'SCREENSHOT_VIEWPORT_REQUIRED')
    let bytes
    for (const quality of [70, 55, 40, 25]) {
      bytes = await page.screenshot({ type: 'jpeg', quality, fullPage: false, scale: 'css', animations: 'disabled', caret: 'hide', mask: [page.locator(MASK)], maskColor: '#6b7280', timeout: 15_000 })
      if (bytes.length <= MAX_BYTES) break
    }
    check(bytes?.length > 0 && bytes.length <= MAX_BYTES, 'SCREENSHOT_TOO_LARGE')
    await assertFinalSpace(page)
    const entries = (await readManifest()).filter((entry) => entry.name !== name)
    check(entries.length < NAMES.length, 'SCREENSHOT_COUNT_REQUIRED')
    await writeFile(imageFile(name), bytes, { mode: 0o600 })
    entries.push({ name, bytes: bytes.length, sha256: digest(bytes) })
    entries.sort((a, b) => NAMES.indexOf(a.name) - NAMES.indexOf(b.name))
    await writeFile(MANIFEST, JSON.stringify(entries), { mode: 0o600 })
    evidence('screenshots', { ok: true, count: entries.length, sha256: digest(bytes) })
  } catch (error) {
    throw error instanceof QaFailure ? error : new QaFailure('SCREENSHOT_CAPTURE_FAILED')
  }
}

async function exportValidatedScreenshots() {
  check(process.env.QA_EXPORT_SCREENSHOTS === '1', 'SCREENSHOT_EXPORT_OPT_IN_REQUIRED')
  const marker = new URL('test-passed.json', RUNTIME)
  const markerStat = await lstat(marker)
  check(markerStat.isFile() && !markerStat.isSymbolicLink() && markerStat.size <= 256, 'SCREENSHOT_SUCCESS_REQUIRED')
  const summary = JSON.parse(await readFile(marker, 'utf8'))
  check(Object.keys(summary).sort().join(',') === 'failed,passed,skipped,status' && summary.status === 'passed' && Number.isSafeInteger(summary.passed) && summary.passed > 0 && summary.failed === 0 && summary.skipped === 0, 'SCREENSHOT_SUCCESS_REQUIRED')
  const entries = await readManifest()
  check(entries.length >= 2 && entries.length <= NAMES.length, 'SCREENSHOT_COUNT_REQUIRED')
  // Validate the entire bounded set before emitting the first image chunk.
  let total = 0
  const images = []
  for (const entry of entries) {
    const stat = await lstat(imageFile(entry.name))
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size === entry.bytes && stat.size <= MAX_BYTES, 'SCREENSHOT_FILE_INVALID')
    const bytes = await readFile(imageFile(entry.name))
    check(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9 && digest(bytes) === entry.sha256, 'SCREENSHOT_FILE_INVALID')
    total += bytes.length
    check(total <= MAX_TOTAL_BYTES, 'SCREENSHOT_TOO_LARGE')
    images.push({ ...entry, data: bytes.toString('base64') })
  }
  for (const entry of images) {
    const count = Math.ceil(entry.data.length / BASE64_CHUNK)
    for (let index = 0; index < count; index++) {
      // The only string payload exception is a validated, bounded JPEG. Metadata
      // contains fixed names and hashes, never URLs, query strings, or file paths.
      process.stdout.write(`QA_IMAGE ${JSON.stringify({ name: entry.name, index, count, sha256: entry.sha256, data: entry.data.slice(index * BASE64_CHUNK, (index + 1) * BASE64_CHUNK) })}\n`)
    }
  }
  evidence('screenshots', { ok: true, count: images.length })
}

export async function exportScreenshots() {
  try { return await exportValidatedScreenshots() } catch (error) {
    throw error instanceof QaFailure ? error : new QaFailure('SCREENSHOT_EXPORT_FAILED')
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  Promise.resolve().then(() => {
    check(process.argv.length === 3 && process.argv[2] === '--export', 'SCREENSHOT_EXPORT_OPT_IN_REQUIRED')
    return exportScreenshots()
  }).catch(() => {
    evidence('screenshots', { ok: false, code: 'SCREENSHOT_EXPORT_FAILED' })
    process.exitCode = 1
  })
}
