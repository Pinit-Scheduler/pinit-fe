import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

/**
 * 이 기기에 저장하는 로그인 정보. 앱에서 이 파일만 읽고 쓴다.
 *
 * refresh token은 지금 서버가 httpOnly 쿠키로만 주므로(`/v0/login`, `/v0/refresh`) OS의 쿠키 저장소에 있고
 * 여기에는 access token만 둔다. 앱용 본문 토큰 API(pinit-docs 소셜 로그인 설계 §7.4)가 생기면
 * `refreshToken`을 이 타입에 더한다.
 *
 * 홈 화면 위젯 대비: 위젯은 앱과 다른 프로세스라 이 저장소를 함께 읽어야 한다.
 * - iOS: 아래 OPTIONS에 `accessGroup`(키체인 공유 그룹)을 넣고 위젯 타깃에 같은 그룹을 준다.
 * - Android: 위젯은 같은 앱 프로세스라 그대로 읽을 수 있다.
 * 저장 위치를 바꿀 때 고칠 곳이 이 파일 하나가 되도록, 다른 모듈은 토큰을 직접 저장하지 않는다.
 */
export type StoredSession = { accessToken: string }

const KEY = 'pinit.session'
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'pinit.session',
  // 기기가 잠겨 있어도(백그라운드 갱신, 위젯) 읽을 수 있어야 한다. 다른 기기로 옮겨지지는 않는다.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
}

// 웹(개발용 미리보기)에는 SecureStore가 없다. 실제 앱에서는 쓰이지 않는다.
const webStorage = {
  read: () => globalThis.localStorage?.getItem(KEY) ?? null,
  write: (value: string) => globalThis.localStorage?.setItem(KEY, value),
  clear: () => globalThis.localStorage?.removeItem(KEY),
}

const parse = (raw: string | null): StoredSession | null => {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    const token = (value as { accessToken?: unknown } | null)?.accessToken
    return typeof token === 'string' && token ? { accessToken: token } : null
  } catch {
    return null
  }
}

export const readSession = async (): Promise<StoredSession | null> => {
  try {
    return parse(Platform.OS === 'web' ? webStorage.read() : await SecureStore.getItemAsync(KEY, OPTIONS))
  } catch {
    // 읽지 못하면(키체인 오류 등) 저장된 로그인이 없는 것으로 본다. 회원은 다시 로그인한다.
    return null
  }
}

export const writeSession = async (session: StoredSession) => {
  const value = JSON.stringify(session)
  if (Platform.OS === 'web') webStorage.write(value)
  else await SecureStore.setItemAsync(KEY, value, OPTIONS)
}

export const clearSession = async () => {
  if (Platform.OS === 'web') webStorage.clear()
  else await SecureStore.deleteItemAsync(KEY, OPTIONS)
}
