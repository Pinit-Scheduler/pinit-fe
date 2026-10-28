import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const loadModule = (relativePath) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports })
  return module.exports
}

const rules = loadModule('../src/features/auth/utils/accountRules.ts')

test('username accepts 4-20 letters, digits and underscores only', () => {
  assert.equal(rules.validateUsername('user_01'), null)
  assert.equal(rules.validateUsername('  user_01  '), null)
  for (const invalid of ['', 'abc', 'a'.repeat(21), 'user-01', '사용자이름', 'user 01']) {
    assert.equal(rules.validateUsername(invalid), rules.USERNAME_MESSAGE, invalid)
  }
})

test('password needs a letter and a digit, printable ASCII without spaces, 8-64 characters', () => {
  for (const valid of ['password1', 'PASS!word#9', 'a1' + 'b'.repeat(62)]) {
    assert.equal(rules.validatePassword(valid), null, valid)
  }
  for (const invalid of ['', 'pass1', 'password', '12345678', 'pass word1', '비밀번호password1', 'a1' + 'b'.repeat(63)]) {
    assert.equal(rules.validatePassword(invalid), rules.PASSWORD_MESSAGE, invalid)
  }
})

test('nickname is 1-20 characters after trimming', () => {
  assert.equal(rules.validateNickname('  열정  '), null)
  assert.equal(rules.validateNickname('가'.repeat(20)), null)
  assert.equal(rules.validateNickname('   '), rules.NICKNAME_MESSAGE)
  assert.equal(rules.validateNickname('가'.repeat(21)), rules.NICKNAME_MESSAGE)
})

test('withdrawal needs the exact confirmation phrase', () => {
  assert.equal(rules.isWithdrawalConfirmed(' 탈퇴합니다 '), true)
  assert.equal(rules.isWithdrawalConfirmed('탈퇴'), false)
  assert.equal(rules.isWithdrawalConfirmed('탈퇴 합니다'), false)
})

test('messages match the backend AccountRules wording', () => {
  assert.equal(rules.USERNAME_MESSAGE, '아이디는 영문, 숫자, 밑줄(_)로 4~20자여야 합니다.')
  assert.equal(rules.PASSWORD_MESSAGE, '비밀번호는 영문과 숫자를 모두 포함해 공백 없이 8~64자여야 합니다.')
  assert.equal(rules.NICKNAME_MESSAGE, '별명은 1~20자여야 합니다.')
  assert.equal(rules.WITHDRAWAL_CONFIRMATION, '탈퇴합니다')
})
