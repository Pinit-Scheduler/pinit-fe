import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : []
  })
}

// Copy rules span every screen's strings, so they are checked over the source text.
const PLACEHOLDER_COPY = /분류\s*(를\s*)?확인/

test('user-facing copy says 스페이스, not 공간', () => {
  const offenders = sourceFiles('src')
    .filter((file) =>
      readFileSync(file, 'utf8')
        .replaceAll('저장 공간', '')
        .replaceAll('여유 공간', '')
        .includes('공간'))
    .map((file) => file.replaceAll(String.fromCharCode(92), '/'))
  assert.deepEqual(offenders, [])
})

test('no placeholder classification copy remains', () => {
  const offenders = sourceFiles('src')
    .filter((file) => PLACEHOLDER_COPY.test(readFileSync(file, 'utf8')))
    .map((file) => file.replaceAll(String.fromCharCode(92), '/'))
  assert.deepEqual(offenders, [])
})

test('classification-check regex rejects the wording variants', () => {
  for (const text of ['분류 확인 중', '분류를 확인', '분류확인', '분류 를 확인'])
    assert.equal(PLACEHOLDER_COPY.test(text), true)
  assert.equal(PLACEHOLDER_COPY.test('프로젝트를 확인한 뒤'), false)
})
