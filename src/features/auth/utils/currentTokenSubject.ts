import { getAccessToken, getTokenSubject } from '@shared/api/authTokens'

/** 지금 저장된 access token의 회원 식별자. 로그인하지 않았으면 null. */
export const currentTokenSubject = () => {
  const token = getAccessToken()
  return token ? getTokenSubject(token) : null
}
