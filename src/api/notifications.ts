import { httpClient } from './httpClient'

const NOTIFICATION_BASE_URL =
  import.meta.env.VITE_NOTIFICATION_API_BASE_URL ||
  (import.meta.env.PROD ? 'https://notification.pinit.go-gradually.me' : 'http://localhost:8082')

export const getNotificationBaseUrl = () => NOTIFICATION_BASE_URL

export type VapidPublicKeyResponse = {
  publicKey: string
}

export type PushTokenRequest = {
  deviceId: string
  token: string
}

export const fetchVapidPublicKey = async (): Promise<string> =>
  httpClient<string>(`${NOTIFICATION_BASE_URL}/push/vapid`)

export const subscribePushToken = (deviceId: string, token: string) =>
  httpClient<void>(`${NOTIFICATION_BASE_URL}/push/subscribe`, {
    method: 'POST',
    json: { deviceId, token } satisfies PushTokenRequest,
  })

export const unsubscribePushToken = (deviceId: string, token: string) =>
  httpClient<void>(`${NOTIFICATION_BASE_URL}/push/unsubscribe`, {
    method: 'POST',
    json: { deviceId, token } satisfies PushTokenRequest,
  })

export const registerPushSubscription = (deviceId: string, token: string) =>
  subscribePushToken(deviceId, token)

export const fetchPushSubscriptionStatus = (memberId: number, deviceId: string) =>
  httpClient<boolean>(`${NOTIFICATION_BASE_URL}/push/subscribed?memberId=${memberId}&deviceId=${deviceId}`)
