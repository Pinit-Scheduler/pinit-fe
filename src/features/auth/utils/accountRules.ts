// 로컬 계정 입력 규칙(ADR-0022 §1). 서버 AccountRules와 같은 규칙·문구를 쓰고, 최종 판단은 서버가 한다.
export const USERNAME_MESSAGE = '아이디는 영문, 숫자, 밑줄(_)로 4~20자여야 합니다.'
export const PASSWORD_MESSAGE = '비밀번호는 영문과 숫자를 모두 포함해 공백 없이 8~64자여야 합니다.'
export const NICKNAME_MESSAGE = '별명은 1~20자여야 합니다.'
export const NICKNAME_MAX_LENGTH = 20

// 탈퇴 확인 문구. 서버 AccountService.WITHDRAWAL_CONFIRMATION과 같다.
export const WITHDRAWAL_CONFIRMATION = '탈퇴합니다'

const USERNAME = /^[A-Za-z0-9_]{4,20}$/
// 공백 없는 출력 가능 ASCII(! ~ ~) 8~64자, 영문과 숫자를 각각 1자 이상.
const PASSWORD = /^(?=.*[A-Za-z])(?=.*[0-9])[!-~]{8,64}$/

/** 규칙을 어기면 안내 문구, 지키면 null. */
export const validateUsername = (username: string): string | null =>
  USERNAME.test(username.trim()) ? null : USERNAME_MESSAGE

export const validatePassword = (password: string): string | null =>
  PASSWORD.test(password) ? null : PASSWORD_MESSAGE

export const validateNickname = (nickname: string): string | null => {
  const trimmed = nickname.trim()
  return trimmed.length >= 1 && trimmed.length <= NICKNAME_MAX_LENGTH ? null : NICKNAME_MESSAGE
}

export const isWithdrawalConfirmed = (confirmation: string) => confirmation.trim() === WITHDRAWAL_CONFIRMATION

// 이메일 인증 코드(이메일 인증·비밀번호 찾기 설계 §5·§6). 서버 EmailAddress가 같은 정규화를 하고 최종 판단한다.
export const EMAIL_MESSAGE = '올바른 이메일 주소를 입력해 주세요.'
export const EMAIL_MAX_LENGTH = 254
export const EMAIL_CODE_LENGTH = 6
export const EMAIL_CODE_MESSAGE = '메일로 받은 6자리 숫자 코드를 입력해 주세요.'

// 형식은 "공백·@ 없는 앞부분 @ 점이 있는 도메인"까지만 본다. 국제화 도메인·별칭은 따로 다루지 않는다.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_CODE = /^[0-9]{6}$/

/** 앞뒤 공백을 지우고 소문자로 바꾼다. 서버에 보내는 값과 "어느 주소로 보냈는지" 비교에 같은 값을 쓴다. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export const validateEmail = (email: string): string | null => {
  const normalized = normalizeEmail(email)
  return normalized.length <= EMAIL_MAX_LENGTH && EMAIL.test(normalized) ? null : EMAIL_MESSAGE
}

/** 붙여 넣은 코드의 공백·하이픈처럼 숫자가 아닌 글자를 지우고 6자리까지만 남긴다. */
export const sanitizeEmailCode = (input: string) => input.replace(/\D/g, '').slice(0, EMAIL_CODE_LENGTH)

export const validateEmailCode = (code: string): string | null => (EMAIL_CODE.test(code) ? null : EMAIL_CODE_MESSAGE)
