import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/shared/components/common/termHelpPlacement.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const module = { exports: {} }
vm.runInNewContext(outputText, { module, exports: module.exports })
const { tipShift } = module.exports

// 390px 화면, 말풍선 280px, 여백 8px
const screen = { left: 0, right: 390 }
test('가운데에 두어도 들어가면 옮기지 않는다', () => {
  assert.equal(tipShift(195, 280, screen), 0)
})
test('왼쪽 끝 가까운 표시는 말풍선을 오른쪽으로 밀어 왼쪽 여백에 맞춘다', () => {
  // "이전 조각" 옆 표시(가운데 x=79): 가운데 정렬이면 왼쪽 끝이 -61px이었다(D2).
  const shift = tipShift(79, 280, screen)
  assert.equal(79 - 140 + shift, 8)
})
test('오른쪽 끝 가까운 표시는 왼쪽으로 당겨 오른쪽 여백에 맞춘다', () => {
  const shift = tipShift(370, 280, screen)
  assert.equal(370 + 140 + shift, 382)
})
test('자르는 상자(창)가 화면보다 좁으면 그 상자 안에 맞춘다', () => {
  const dialog = { left: 40, right: 360 }
  assert.equal(60 - 140 + tipShift(60, 280, dialog), 48)
  assert.equal(340 + 140 + tipShift(340, 280, dialog), 352)
})
test('말풍선이 들어갈 자리보다 넓으면 왼쪽 여백에 맞춘다', () => {
  assert.equal(100 - 150 + tipShift(100, 300, { left: 0, right: 200 }), 8)
})
