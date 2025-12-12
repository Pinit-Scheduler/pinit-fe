import { httpClient } from './httpClient'

const NOTIFICATION_BASE_URL =
  import.meta.env.VITE_NOTIFICATION_API_BASE_URL ||
  (import.meta.env.PROD ? 'https://notification.pinit.go-gradually.me' : 'http://localhost:8093')

export const getNotificationBaseUrl = () => NOTIFICATION_BASE_URL

export type VapidPublicKeyResponse = {
  publicKey: string
}

export type PushTokenRequest = {
  token: string
}

const extractTokenFromSubscription = (subscription: PushSubscriptionJSON) => {
  const token = subscription.endpoint?.split('/')?.pop()
  if (!token) {
    throw new Error('푸시 토큰 정보를 찾지 못했어요.')
  }
  return token
}

export const fetchVapidPublicKey = async (): Promise<VapidPublicKeyResponse> => {
  const publicKey = await httpClient<string>(`${NOTIFICATION_BASE_URL}/push/vapid`)
  return { publicKey }
}

export const subscribePushToken = (token: string) =>
  httpClient<void>(`${NOTIFICATION_BASE_URL}/push/subscribe`, {
    method: 'POST',
    json: { token } satisfies PushTokenRequest,
  })

export const unsubscribePushToken = (token: string) =>
  httpClient<void>(`${NOTIFICATION_BASE_URL}/push/unsubscribe`, {
    method: 'POST',
    json: { token } satisfies PushTokenRequest,
  })

export const registerPushSubscription = (subscription: PushSubscriptionJSON) =>
  subscribePushToken(extractTokenFromSubscription(subscription))
