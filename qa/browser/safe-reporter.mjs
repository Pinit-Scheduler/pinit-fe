import { writeFile, unlink } from 'node:fs/promises'
import { validatedPublicRecord } from './safe.mjs'
import { RUNTIME } from './constants.mjs'
import { prepareScreenshotRun } from './screenshots.mjs'

const TEST_STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted'])
const RUN_STATUSES = new Set(['passed', 'failed', 'timedout', 'interrupted'])
const MAX_LINE = 2_048

export default class SafeReporter {
  constructor() {
    this.passed = 0
    this.failed = 0
    this.skipped = 0
    this.output = ''
    this.discardLine = false
    this.runnerError = false
  }
  onBegin() {
    // Synchronous reset prevents a previous run's files from becoming exportable.
    try { prepareScreenshotRun() } catch { this.runnerError = true }
  }
  onTestEnd(_test, result) {
    const status = TEST_STATUSES.has(result.status) ? result.status : 'failed'
    if (status === 'passed') this.passed++
    else if (status === 'skipped') this.skipped++
    else this.failed++
    // Never serialize names, Playwright errors, call logs, attachments or stdout.
    process.stdout.write(`QA_TEST ${JSON.stringify({ status })}\n`)
  }
  onStdOut(chunk) {
    // QA records are ASCII. A bounded line buffer also handles split Buffers;
    // malformed UTF-8 and oversized arbitrary stdout are discarded, never echoed.
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) return
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    for (const character of text) {
      if (character === '\n') {
        if (!this.discardLine) this.forwardLine(this.output)
        this.output = ''
        this.discardLine = false
      } else if (!this.discardLine) {
        if (this.output.length >= MAX_LINE) { this.output = ''; this.discardLine = true }
        else this.output += character
      }
    }
  }
  forwardLine(line) {
    if (!line.startsWith('QA ')) return
    try {
      const record = validatedPublicRecord(JSON.parse(line.slice(3)))
      if (record) process.stdout.write(`QA ${JSON.stringify(record)}\n`)
    } catch { /* Do not print even a fragment of invalid worker output. */ }
  }
  onStdErr() {}
  onError() { this.runnerError = true; process.stdout.write('QA_ERROR RUNNER_ERROR\n') }
  async onEnd(result) {
    this.output = ''
    let status = RUN_STATUSES.has(result.status) ? result.status : 'failed'
    if (this.runnerError || this.failed > 0) status = 'failed'
    const summary = { status, passed: this.passed, failed: this.failed, skipped: this.skipped }
    const marker = new URL('test-passed.json', RUNTIME)
    try {
      if (status === 'passed' && this.passed > 0 && this.failed === 0 && this.skipped === 0) {
        await writeFile(marker, JSON.stringify(summary), { flag: 'wx', mode: 0o600 })
      } else {
        await unlink(marker).catch((error) => { if (error.code !== 'ENOENT') throw error })
      }
    } catch {
      status = 'failed'
      summary.status = status
      process.stdout.write('QA_ERROR RUNNER_ERROR\n')
    }
    process.stdout.write(`QA_TOTAL ${JSON.stringify(summary)}\n`)
    return { status }
  }
}
