import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load, plain } from './load.mjs'

const dateKey = load('../src/lib/dateKey.ts')
const jwt = load('../src/lib/jwt.ts')
const schedule = load('../src/lib/schedule.ts')
const duration = load('../src/lib/isoDuration.ts')
const errors = load('../src/api/errors.ts')

test('날짜 키에 일 수를 더한다(월·연 경계, 윤년)', () => {
  assert.equal(dateKey.addDaysToDateKey('2026-11-23', 1), '2026-11-24')
  assert.equal(dateKey.addDaysToDateKey('2026-11-30', 1), '2026-12-01')
  assert.equal(dateKey.addDaysToDateKey('2026-12-31', 1), '2027-01-01')
  assert.equal(dateKey.addDaysToDateKey('2026-01-01', -1), '2025-12-31')
  assert.equal(dateKey.addDaysToDateKey('2028-02-28', 1), '2028-02-29')
  assert.equal(dateKey.addDaysToDateKey('2026-11-23', 7), '2026-11-30')
})

test('주는 월요일에 시작한다', () => {
  // 2026-11-23은 월요일이다.
  assert.equal(dateKey.weekStartOf('2026-11-23'), '2026-11-23')
  assert.equal(dateKey.weekStartOf('2026-11-25'), '2026-11-23')
  assert.equal(dateKey.weekStartOf('2026-11-29'), '2026-11-23') // 일요일은 그 주의 마지막 날
  assert.equal(dateKey.weekStartOf('2026-11-22'), '2026-11-16')
  assert.deepEqual(plain(dateKey.weekDaysOf('2026-11-26')), [
    '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29',
  ])
})

test('날짜 라벨', () => {
  assert.equal(dateKey.weekdayLabel('2026-11-23'), '월')
  assert.equal(dateKey.weekdayLabel('2026-11-29'), '일')
  assert.equal(dateKey.formatMonthDay('2026-11-23'), '11월 23일 (월)')
  assert.equal(dateKey.formatFullDate('2026-01-05'), '2026년 1월 5일 월요일')
  assert.equal(dateKey.formatDueLabel('2026-01-05'), '1/5')
  assert.equal(dateKey.dayOfMonth('2026-11-09'), 9)
})

const token = (payload) =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`

test('토큰 만료를 만료 60초 전부터 만료로 본다', () => {
  const now = 1_800_000_000_000
  assert.equal(jwt.isTokenExpired(token({ exp: now / 1000 + 300 }), now), false)
  assert.equal(jwt.isTokenExpired(token({ exp: now / 1000 + 61 }), now), false)
  assert.equal(jwt.isTokenExpired(token({ exp: now / 1000 + 60 }), now), true)
  assert.equal(jwt.isTokenExpired(token({ exp: now / 1000 - 1 }), now), true)
})

test('만료 시각을 읽을 수 없는 토큰은 서버 판단에 맡긴다', () => {
  assert.equal(jwt.isTokenExpired('not-a-token', Date.now()), false)
  assert.equal(jwt.isTokenExpired('a.b.c', Date.now()), false)
  assert.equal(jwt.isTokenExpired(token({ sub: '1' }), Date.now()), false)
})

test('토큰의 회원을 읽는다(한글이 든 본문, 패딩 있는 base64 포함)', () => {
  assert.equal(jwt.tokenSubject(token({ sub: 7 })), '7')
  assert.equal(jwt.tokenSubject(token({ memberId: '12', nickname: '데모 유저' })), '12')
  assert.equal(jwt.tokenSubject(token({ exp: 1 })), null)
  assert.equal(jwt.tokenSubject('garbage'), null)
  const padded = `${Buffer.from('{"alg":"none"}').toString('base64')}.${Buffer.from('{"sub":1,"exp":2}').toString('base64')}.x`
  assert.equal(jwt.tokenSubject(padded), '1')
})

test('일정 카드: 미시작은 시작, 완료는 되돌리기, 권한이 없으면 아무것도 하지 않는다', () => {
  assert.equal(schedule.cardTapAction('NOT_STARTED', { start: true }), 'START')
  assert.equal(schedule.cardTapAction('NOT_STARTED', { start: false }), null)
  assert.equal(schedule.cardTapAction('NOT_STARTED', undefined), null)
  assert.equal(schedule.cardTapAction('COMPLETED', { cancel: true }), 'CANCEL')
  assert.equal(schedule.cardTapAction('COMPLETED', {}), null)
  // 진행중·일시정지는 컨트롤 바에서 다룬다.
  assert.equal(schedule.cardTapAction('IN_PROGRESS', { suspend: true, complete: true, cancel: true }), null)
  assert.equal(schedule.cardTapAction('SUSPENDED', { start: true, cancel: true }), null)
})

test('즉시 완료는 미시작이고 완료가 허용될 때만 보인다', () => {
  assert.equal(schedule.canQuickComplete('NOT_STARTED', { complete: true }), true)
  assert.equal(schedule.canQuickComplete('NOT_STARTED', { complete: false }), false)
  assert.equal(schedule.canQuickComplete('IN_PROGRESS', { complete: true }), false)
  assert.equal(schedule.canQuickComplete('COMPLETED', { complete: true }), false)
})

test('동작마다 저장 뒤의 상태와 허용 키가 맞다', () => {
  assert.deepEqual(plain(schedule.TARGET_STATE), {
    START: 'IN_PROGRESS', SUSPEND: 'SUSPENDED', COMPLETE: 'COMPLETED', CANCEL: 'NOT_STARTED',
  })
  assert.equal(schedule.isAllowed({ suspend: true }, 'SUSPEND'), true)
  assert.equal(schedule.isAllowed({ suspend: true }, 'START'), false)
  assert.equal(schedule.isAllowed(null, 'COMPLETE'), false)
  assert.equal(schedule.isActiveState('IN_PROGRESS'), true)
  assert.equal(schedule.isActiveState('SUSPENDED'), true)
  assert.equal(schedule.isActiveState('NOT_STARTED'), false)
  assert.equal(schedule.isActiveState('COMPLETED'), false)
})

test('기간 라벨', () => {
  assert.equal(duration.formatIsoDurationLabel('PT30M'), '30분')
  assert.equal(duration.formatIsoDurationLabel('PT1H30M'), '1시간 30분')
  assert.equal(duration.formatIsoDurationLabel('PT2H'), '2시간')
  assert.equal(duration.formatIsoDurationLabel('PT0S'), '0분')
  assert.equal(duration.formatIsoDurationLabel('P1DT1H'), '25시간')
  assert.equal(duration.formatIsoDurationLabel('1:30'), null)
  assert.equal(duration.formatIsoDurationLabel(null), null)
})

test('실패 문구: 서버 문구가 있으면 그대로, 없으면 할 일을 붙인다', () => {
  const server = new errors.ApiError('이미 진행 중인 다른 일정이 있어요.', 409, { code: 'STATE_CONFLICT' })
  assert.equal(errors.getRequestFailureMessage(server, '일정 상태를 바꾸지 못했어요.'), '이미 진행 중인 다른 일정이 있어요.')
  const silent = new errors.ApiError('', 500, null)
  assert.equal(errors.getRequestFailureMessage(silent, '작업을 불러오지 못했어요.'), '작업을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  const offline = new errors.ApiError('Network request failed', 0, null)
  assert.equal(errors.getRequestFailureMessage(offline, '작업을 불러오지 못했어요.'), '작업을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
  assert.equal(errors.getRequestFailureMessage(new TypeError('x'), '로그인하지 못했어요.'), '로그인하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
})

test('응답 본문의 문구를 읽는다', () => {
  assert.equal(errors.getApiErrorMessage({ message: ' 아이디 또는 비밀번호가 잘못되었습니다. ' }), '아이디 또는 비밀번호가 잘못되었습니다.')
  assert.equal(errors.getApiErrorMessage({ errors: [{ reason: '제목은 필수입니다.' }, { reason: '제목은 필수입니다.' }, { reason: '날짜가 잘못됐어요.' }] }), '제목은 필수입니다. 날짜가 잘못됐어요.')
  assert.equal(errors.getApiErrorMessage('plain text'), '')
  assert.equal(errors.getApiErrorMessage(null), '')
})

test('버전이 어긋난 409만 편집 충돌로 본다', () => {
  assert.equal(errors.isEditConflict(new errors.ApiError('', 409, { code: 'VERSION_CONFLICT' })), true)
  assert.equal(errors.isEditConflict(new errors.ApiError('', 409, { code: 'STATE_CONFLICT' })), false)
  assert.equal(errors.isEditConflict(new errors.ApiError('', 400, { code: 'VERSION_CONFLICT' })), false)
  assert.equal(errors.isEditConflict(new Error('x')), false)
  assert.equal(
    errors.conflictReloadedMessage(new errors.ApiError('다른 참여자가 먼저 수정했어요.', 409, { code: 'VERSION_CONFLICT' })),
    '다른 참여자가 먼저 수정했어요. 최신 내용을 다시 불러왔어요.',
  )
})
