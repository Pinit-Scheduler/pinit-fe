import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { publicRecord, validatedPublicRecord, QaFailure } from './safe.mjs'
import SafeReporter from './safe-reporter.mjs'
import { RUNTIME } from './constants.mjs'

test('public evidence omits arbitrary credentials, URLs, bodies and unknown codes', () => {
  assert.deepEqual(publicRecord({ step: 'scenario', code: 'unknown-secret', token: 'synthetic-token', url: 'https://invalid.example/?code=synthetic', body: {}, ok: true }), { step: 'scenario', code: 'QA_FAILURE', ok: true })
  assert.equal(new QaFailure('untrusted exception body').message, 'QA_FAILURE')
})
test('worker allowlist rejects whole records with any extra or invalid field', () => {
  assert.equal(validatedPublicRecord({ step: 'result', ok: false, password: 'synthetic' }), null)
  assert.equal(validatedPublicRecord({ step: 'result', count: -1 }), null)
  assert.equal(validatedPublicRecord({ step: 'result', code: 'untrusted' }), null)
  assert.deepEqual(validatedPublicRecord({ step: 'scenario', code: 'TASK_409_SSE_DRAFT_PRESERVED', ok: true }), { step: 'scenario', code: 'TASK_409_SSE_DRAFT_PRESERVED', ok: true })
})
test('reporter handles split buffers and discards raw exceptions and oversized lines', () => {
  const reporter = new SafeReporter()
  const original = process.stdout.write
  let output = ''
  process.stdout.write = (chunk) => { output += chunk; return true }
  try {
    reporter.onStdOut(Buffer.from('raw secret exception\nQA {"step":"scenario","co'))
    reporter.onStdOut(Buffer.from('de":"TASK_409_SSE_DRAFT_PRESERVED","ok":true}\n'))
    reporter.onStdOut('QA ' + 'x'.repeat(4_096) + '\n')
    reporter.onStdErr('stderr synthetic credential')
  } finally { process.stdout.write = original }
  assert.equal(output, 'QA {"step":"scenario","code":"TASK_409_SSE_DRAFT_PRESERVED","ok":true}\n')
})
test('failed or skipped suites cannot export screenshots from a prior successful marker', async () => {
  const reporter = new SafeReporter()
  const original = process.stdout.write
  process.stdout.write = () => true
  try {
    reporter.onBegin()
    reporter.passed = 1
    assert.deepEqual(await reporter.onEnd({ status: 'passed' }), { status: 'passed' })
    assert.equal(JSON.parse(await readFile(new URL('test-passed.json', RUNTIME), 'utf8')).status, 'passed')
    reporter.skipped = 1
    await reporter.onEnd({ status: 'passed' })
    await assert.rejects(readFile(new URL('test-passed.json', RUNTIME)), { code: 'ENOENT' })
  } finally { process.stdout.write = original }
})
