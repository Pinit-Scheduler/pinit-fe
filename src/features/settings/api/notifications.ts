import { buildNotificationUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'

export type PushTokenRequest = {
  deviceId: string
  token: string
}

export const fetchVapidPublicKey = async (): Promise<string> =>
  httpClient<string>(buildNotificationUrl('/push/vapid'))

export const subscribePushToken = (deviceId: string, token: string) =>
  httpClient<void>(buildNotificationUrl('/push/subscribe'), {
    method: 'POST',
    json: { deviceId, token } satisfies PushTokenRequest,
  })

export const unsubscribePushToken = (deviceId: string, token: string) =>
  httpClient<void>(buildNotificationUrl('/push/unsubscribe'), {
    method: 'POST',
    json: { deviceId, token } satisfies PushTokenRequest,
  })

export const fetchPushSubscriptionStatus = (deviceId: string) =>
  httpClient<boolean>(buildNotificationUrl(`/push/subscribed?deviceId=${deviceId}`))
