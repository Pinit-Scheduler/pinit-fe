import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const load = () => {
  const source = readFileSync(new URL('../src/shared/components/common/confirm.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, Promise, Set })
  return module.exports
}

const ask = { title: '제안을 버릴까요?', body: '본문', confirmLabel: '제안 버리기', cancelLabel: '그대로 두기' }

test('답을 받으면 그 값으로 끝나고 창이 비워진다', async () => {
  const c = load()
  const answer = c.askConfirm(ask)
  assert.equal(c.currentConfirm().title, '제안을 버릴까요?')
  c.answerConfirm(true)
  assert.equal(await answer, true)
  assert.equal(c.currentConfirm(), null)
})
test('창이 떠 있을 때 다시 물으면 앞의 창은 아니오로 끝난다', async () => {
  const c = load()
  const first = c.askConfirm(ask)
  const second = c.askConfirm({ ...ask, title: '쪼개기 요청을 취소할까요?' })
  assert.equal(await first, false)
  assert.equal(c.currentConfirm().title, '쪼개기 요청을 취소할까요?')
  c.answerConfirm(false)
  assert.equal(await second, false)
})
test('바뀔 때마다 구독자가 불리고, 떠 있는 창이 없으면 답해도 아무 일이 없다', () => {
  const c = load()
  let calls = 0
  const stop = c.subscribeConfirm(() => calls++)
  c.answerConfirm(true)
  void c.askConfirm(ask)
  c.answerConfirm(false)
  stop()
  void c.askConfirm(ask)
  assert.equal(calls, 3)
})
