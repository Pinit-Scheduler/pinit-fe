import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadModules } from './support/mocks.mjs'

const load = loadModules()
const text = load('src/features/mind-map/model/text.ts')
const cases = JSON.parse(
  readFileSync(new URL('./fixtures/mind-map-text-cases.json', import.meta.url), 'utf8'),
)

test('공유 표대로 정리하고 센다', () => {
  assert.equal(cases.length, 8)
  for (const c of cases) {
    assert.equal(text.normalizeText(c.input), c.normalized, c.name)
    assert.equal(text.textLength(c.normalized), c.codePoints, c.name)
  }
})

test('White_Space 집합을 정확히 안다', () => {
  assert.equal(text.WHITE_SPACE.length, 25)
  for (const cp of [0x09, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000])
    assert.equal(text.isWhiteSpace(cp), true, cp.toString(16))
  for (const cp of [0x200b, 0xfeff, 0x1c, 0x180e]) assert.equal(text.isWhiteSpace(cp), false, cp.toString(16))
})

test('이모지 100개는 100자, 101개는 101자', () => {
  assert.equal(text.textLength('😀'.repeat(100)), 100)
  assert.equal(text.textLength('😀'.repeat(101)), 101)
})

test('정리한 길이가 한도를 넘지 않게 앞에서부터 자른다', () => {
  assert.equal(text.clipText('가나다', 3), '가나다')
  assert.equal(text.clipText('가나다라', 3), '가나다')
  assert.equal(text.clipText('😀'.repeat(101), 100), '😀'.repeat(100))
  // 이어진 공백은 하나로 세고, 앞뒤 공백은 세지 않는다.
  assert.equal(text.clipText('  가   나', 3), '  가   나')
  assert.equal(text.clipText('가 나다', 3), '가 나')
  // 마지막 글자 앞의 공백 하나를 더할 자리가 없으면 그 글자도 넣지 않는다.
  assert.equal(text.textLength(text.normalizeText(text.clipText('가나 다', 2))), 2)
  assert.equal(text.clipText('가나 다', 2), '가나 ')
})
