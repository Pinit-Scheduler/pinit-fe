import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const loadModule = (relativePath, dependencies = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return module.exports
}

const rules = loadModule('../src/features/auth/utils/accountRules.ts')
const errorMessage = loadModule('../src/shared/api/errorMessage.ts')
const emailCode = loadModule('../src/features/auth/utils/emailCode.ts', { './accountRules': rules })
const errors = loadModule('../src/features/auth/utils/emailAuthErrors.ts', { '@shared/api/errorMessage': errorMessage })
const authPaths = loadModule('../src/features/auth/utils/authPaths.ts')
const requirement = loadModule('../src/features/auth/utils/emailRequirement.ts', { './authPaths': authPaths })
const formErrors = loadModule('../src/features/auth/utils/formErrors.ts')

const NOW = Date.parse('2026-11-09T00:00:00Z')

// httpClient의 ApiError와 같은 모양. 화면 문구 결정은 status와 message만 본다.
const apiError = (status, message = '') =>
  Object.assign(new Error(message), { name: 'ApiError', status })

test('email is trimmed and lower-cased before it is validated or sent', () => {
  assert.equal(rules.normalizeEmail('  NewUser@Example.COM '), 'newuser@example.com')
  for (const valid of ['a@b.co', ' User.Name+tag@sub.example.com ']) {
    assert.equal(rules.validateEmail(valid), null, valid)
  }
  const tooLong = `${'a'.repeat(250)}@b.co`
  for (const invalid of ['', '   ', 'user', 'user@', '@example.com', 'user@example', 'us er@example.com', tooLong]) {
    assert.equal(rules.validateEmail(invalid), rules.EMAIL_MESSAGE, invalid)
  }
})

test('pasted codes keep only six digits and the code must be exactly six digits', () => {
  assert.equal(rules.sanitizeEmailCode(' 123-456 '), '123456')
  assert.equal(rules.sanitizeEmailCode('1234567'), '123456')
  assert.equal(rules.sanitizeEmailCode('abc'), '')
  assert.equal(rules.validateEmailCode('000000'), null)
  for (const invalid of ['', '12345', '1234567', '12345a']) {
    assert.equal(rules.validateEmailCode(invalid), rules.EMAIL_CODE_MESSAGE, invalid)
  }
})

test('resend stays locked for 60 seconds after a code is sent and counts down in whole seconds', () => {
  const initial = emailCode.INITIAL_EMAIL_CODE_FLOW
  assert.equal(emailCode.resendWaitSeconds(initial, NOW), 0, 'nothing sent yet')
  assert.equal(emailCode.emailCodeButtonLabel(initial, 0, false), '코드 받기')

  const sent = emailCode.markEmailCodeSent(' User@Example.com ', NOW)
  assert.equal(sent.sentTo, 'user@example.com')
  assert.equal(emailCode.resendWaitSeconds(sent, NOW), 60)
  assert.equal(emailCode.resendWaitSeconds(sent, NOW + 500), 60, 'partial seconds round up')
  assert.equal(emailCode.resendWaitSeconds(sent, NOW + 59_001), 1)
  assert.equal(emailCode.resendWaitSeconds(sent, NOW + 60_000), 0)
  assert.equal(emailCode.resendWaitSeconds(sent, NOW + 120_000), 0)

  assert.equal(emailCode.emailCodeButtonLabel(sent, 42, false), '다시 받기 (42초)')
  assert.equal(emailCode.emailCodeButtonLabel(sent, 0, false), '코드 다시 받기')
  assert.equal(emailCode.emailCodeButtonLabel(sent, 0, true), '보내는 중...')
})

test('a sent code belongs to the normalized address it was sent to', () => {
  const sent = emailCode.markEmailCodeSent('user@example.com', NOW)
  assert.equal(emailCode.isEmailCodeSentTo(sent, ' USER@example.com'), true)
  assert.equal(emailCode.isEmailCodeSentTo(sent, 'other@example.com'), false)
  assert.equal(emailCode.isEmailCodeSentTo(emailCode.INITIAL_EMAIL_CODE_FLOW, ''), false)
})

test('password reset moves to the code step after sending and back when a new code is needed', () => {
  const initial = emailCode.INITIAL_EMAIL_CODE_FLOW
  assert.equal(emailCode.passwordResetStep(initial), 'request')

  const sent = emailCode.markEmailCodeSent('user@example.com', NOW)
  assert.equal(emailCode.passwordResetStep(sent), 'verify')

  // "다른 이메일 입력"이나 409 뒤에는 첫 단계로 돌아가지만, 서버의 60초 한도에 맞춰 대기는 유지한다.
  const again = emailCode.requireNewEmailCode(sent)
  assert.equal(emailCode.passwordResetStep(again), 'request')
  assert.equal(again.sentTo, null)
  assert.equal(emailCode.resendWaitSeconds(again, NOW + 10_000), 50)
  assert.equal(emailCode.emailCodeButtonLabel(again, 50, false), '다시 받기 (50초)')
})

test('error statuses map to the documented messages and only 409 asks for a new code', () => {
  const describe = errors.describeEmailAuthError
  const codeMessage = '인증 코드가 올바르지 않거나 만료되었어요'

  assert.deepEqual({ ...describe(apiError(400, codeMessage), 'submit') }, { message: codeMessage, requiresNewCode: false })
  assert.equal(describe(apiError(400), 'submit').message, errors.EMAIL_AUTH_MESSAGES.invalid)
  // 비밀번호 재설정에서 새 비밀번호가 현재와 같으면 서버는 코드를 쓴 뒤 400으로 새 코드를 받으라고 한다.
  const samePassword = '새 비밀번호가 현재 비밀번호와 같습니다. 새 인증 코드를 받아 다른 비밀번호로 다시 시도해 주세요.'
  assert.deepEqual({ ...describe(apiError(400, samePassword), 'submit') }, { message: samePassword, requiresNewCode: true })
  assert.equal(describe(apiError(400, samePassword), 'send').requiresNewCode, false)

  assert.deepEqual({ ...describe(apiError(409), 'submit') }, {
    message: errors.EMAIL_AUTH_MESSAGES.conflict,
    requiresNewCode: true,
  })
  assert.equal(describe(apiError(409, '새 코드를 받아 주세요.'), 'submit').message, '새 코드를 받아 주세요.')

  assert.equal(describe(apiError(429), 'send').message, errors.EMAIL_AUTH_MESSAGES.tooMany)
  const limited = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
  assert.equal(describe(apiError(429, limited), 'send').message, limited)

  assert.equal(describe(apiError(503), 'send').message, errors.EMAIL_AUTH_MESSAGES.mailFailed)
  assert.equal(describe(apiError(503), 'submit').message, errors.EMAIL_AUTH_MESSAGES.unavailable)

  assert.equal(describe(apiError(0, 'Failed to fetch'), 'send').message, errors.EMAIL_AUTH_MESSAGES.network)
  assert.equal(describe(apiError(500), 'submit').message, errors.EMAIL_AUTH_MESSAGES.unknown)
  assert.equal(describe(new Error(''), 'submit').message, errors.EMAIL_AUTH_MESSAGES.unknown)
  assert.equal(describe('boom', 'submit').requiresNewCode, false)
})

test('emailRequired routes to registration until it is done and leaves the registration screen afterwards', () => {
  const { decideEmailGate } = requirement
  const registration = authPaths.EMAIL_REGISTRATION_PATH
  assert.equal(decideEmailGate(true, '/app/today'), 'toRegistration')
  assert.equal(decideEmailGate(true, '/oauth/consent'), 'toRegistration')
  assert.equal(decideEmailGate(true, registration), 'render')
  assert.equal(decideEmailGate(false, registration), 'leaveRegistration')
  assert.equal(decideEmailGate(false, '/app/today'), 'render')
  // React Router는 대소문자와 끝의 /를 무시하고 같은 화면으로 연다.
  for (const alias of ['/email-registration/', '/EMAIL-REGISTRATION', '/Email-Registration//']) {
    assert.equal(requirement.isEmailRegistrationPath(alias), true, alias)
    assert.equal(decideEmailGate(true, alias), 'render', alias)
    assert.equal(decideEmailGate(false, alias), 'leaveRegistration', alias)
  }
  assert.equal(requirement.isEmailRegistrationPath('/email-registration-old'), false)
})

test('emailRequired is remembered per member and notifies subscribers only on change', () => {
  const store = requirement.createEmailRequirementStore()
  let notified = 0
  const unsubscribe = store.subscribe(() => { notified += 1 })

  assert.equal(store.get('1'), null, 'unknown until the server says')
  store.set(null, true)
  assert.equal(notified, 0, 'no member, nothing to remember')

  store.set('1', true)
  assert.equal(store.get('1'), true)
  assert.equal(store.get('2'), null, 'another member is unknown')
  assert.equal(store.get(null), null)
  store.set('1', true)
  assert.equal(notified, 1, 'same value does not notify again')

  store.set('1', false)
  assert.equal(store.get('1'), false)
  assert.equal(notified, 2)

  unsubscribe()
  store.set('2', true)
  assert.equal(notified, 2)
})

test('only a boolean emailRequired from the server decides; missing fields stay unknown', () => {
  assert.equal(requirement.readEmailRequired({ token: 't', emailRequired: true }), true)
  assert.equal(requirement.readEmailRequired({ token: 't', emailRequired: false }), false)
  for (const response of [undefined, null, {}, { token: 't' }, { emailRequired: 'true' }]) {
    assert.equal(requirement.readEmailRequired(response), null, JSON.stringify(response))
  }
})

test('focus goes to the first invalid field in screen order', () => {
  const order = ['username', 'password', 'email', 'code']
  assert.equal(formErrors.firstErrorField(order, { code: 'x', email: 'y' }), 'email')
  assert.equal(formErrors.firstErrorField(order, { form: 'z' }), null)
  assert.equal(formErrors.firstErrorField(order, {}), null)
})
