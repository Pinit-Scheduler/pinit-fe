import { getAccessToken, getTokenSubject } from '@shared/api/authTokens'
import type { ProfileSettings } from '../api/profileSettings'
import type { AccountInfo } from '../api/account'
import type { NotificationPreferences } from '../utils/notificationPreferences'
import type { OAuthGrant } from '@features/oauth/types/oauth'

const accountScope = () => {
  const token = getAccessToken()
  return (token && getTokenSubject(token)) || 'guest'
}

/**
 * 설정 화면을 다시 열 때(또는 시간대를 바꿔 앱이 다시 그려질 때) 마지막으로 받은 값을 바로 보여 주는 캐시.
 * 로그인한 계정별로 하나만 둔다. 다른 계정으로 바뀌면 읽지 않는다. 화면은 이 값을 먼저 보이고 서버 값으로 다시 맞춘다.
 */
export const createMemberCache = <T>() => {
  let entry: { scope: string; value: T } | null = null
  return {
    read: (): T | undefined => (entry && entry.scope === accountScope() ? entry.value : undefined),
    write: (value: T) => {
      entry = { scope: accountScope(), value }
    },
  }
}

export const profileSettingsCache = createMemberCache<ProfileSettings>()
export const notificationPreferencesCache = createMemberCache<NotificationPreferences>()
export const accountCache = createMemberCache<AccountInfo>()
export const oauthGrantsCache = createMemberCache<OAuthGrant[]>()
