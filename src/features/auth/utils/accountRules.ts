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
