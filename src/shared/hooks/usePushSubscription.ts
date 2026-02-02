import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ensureDeviceId } from '@shared/api/authTokens'
import {
  fetchPushSubscriptionStatus,
  fetchVapidPublicKey,
  subscribePushToken,
  unsubscribePushToken,
} from '@features/settings/api/notifications'
import { logFcmTokenOnce } from '../../firebase/messaging'

type PushStateStatus = 'idle' | 'subscribed' | 'blocked' | 'unsupported' | 'error'

export type PushSubscriptionState = {
  status: PushStateStatus
  message?: string
}

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(normalized)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

const isPushEnvironmentSupported = () =>
  typeof window !== 'undefined' &&
  'Notification' in window &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  window.isSecureContext

const resolveRegistration = async () => {
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) {
    return existing
  }
  if (import.meta.env.PROD) {
    return navigator.serviceWorker.ready
  }
  return null
}

const usePushSubscription = () => {
  const [state, setState] = useState<PushSubscriptionState>({ status: 'idle' })
  const [isProcessing, setIsProcessing] = useState(false)
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null)
  const vapidKeyPromiseRef = useRef<Promise<string> | null>(null)

  const describeStatus = useMemo(() => {
    switch (state.status) {
      case 'subscribed':
        return '알림이 활성화되어 있어요.'
      case 'blocked':
        return state.message || '브라우저에서 알림 권한이 차단되었어요.'
      case 'unsupported':
        return state.message || 'HTTPS 환경 및 지원되는 브라우저에서 이용할 수 있어요.'
      case 'error':
        return state.message || '푸시 알림 설정 중 오류가 발생했어요.'
      default:
        return '브라우저 알림을 허용하면 일정 알림을 받을 수 있어요.'
    }
  }, [state])

  const resolveVapidKey = useCallback(async () => {
    if (vapidPublicKey) return vapidPublicKey
    if (!vapidKeyPromiseRef.current) {
      vapidKeyPromiseRef.current = fetchVapidPublicKey()
        .then((key) => {
          setVapidPublicKey(key)
          return key
        })
        .finally(() => {
          vapidKeyPromiseRef.current = null
        })
    }
    return vapidKeyPromiseRef.current
  }, [vapidPublicKey])

  const refreshStatus = useCallback(async () => {
    if (!isPushEnvironmentSupported()) {
      setState({ status: 'unsupported', message: '지원되지 않는 환경이에요. HTTPS에서 다시 시도해주세요.' })
      return
    }

    if (Notification.permission === 'denied') {
      setState({ status: 'blocked', message: '브라우저 설정에서 알림 권한을 허용해야 해요.' })
      return
    }

    try {
      const deviceId = ensureDeviceId()
      if (!deviceId) {
        setState({ status: 'error', message: '디바이스 정보를 불러오지 못했어요.' })
        return
      }
      const registration = await resolveRegistration()
      if (!registration) {
        setState({
          status: 'error',
          message: '서비스 워커를 찾지 못했어요. 배포 환경에서 새로고침 후 다시 시도해주세요.',
        })
        return
      }

      const subscription = await registration.pushManager.getSubscription()
      let remoteSubscribed: boolean | null = null
      try {
        remoteSubscribed = await fetchPushSubscriptionStatus(deviceId)
      } catch (error) {
        console.warn('[Push] Failed to fetch subscription status:', error)
      }

      if (remoteSubscribed === true) {
        const key = vapidPublicKey || (await resolveVapidKey())
        if (subscription && key) {
          void logFcmTokenOnce(registration, key)
        }
        if (!subscription) {
          setState({
            status: 'error',
            message: '브라우저 구독이 해제되어 다시 등록이 필요해요.',
          })
          return
        }
        setState({ status: 'subscribed' })
        return
      }

      if (subscription) {
        const key = vapidPublicKey || (await resolveVapidKey())
        if (key) {
          void logFcmTokenOnce(registration, key)
        }
        setState({
          status: remoteSubscribed === false ? 'error' : 'subscribed',
          message: remoteSubscribed === false ? '서버 구독 정보를 찾지 못했어요. 다시 등록해주세요.' : undefined,
        })
        return
      }

      setState({ status: 'idle' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '구독 상태를 확인하지 못했어요.'
      setState({ status: 'error', message })
    }
  }, [vapidPublicKey, resolveVapidKey])

  useEffect(() => {
    resolveVapidKey().catch((error) => {
      const message = error instanceof Error ? error.message : 'VAPID 키를 가져오지 못했어요.'
      setState({ status: 'error', message })
    })
    refreshStatus()
  }, [refreshStatus, resolveVapidKey])

  const subscribe = useCallback(async () => {
    let vapidKey: string | null = null
    try {
      vapidKey = await resolveVapidKey()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'VAPID 키를 가져오지 못했어요.'
      setState({ status: 'error', message })
      throw new Error(message)
    }

    if (!vapidKey) {
      const message = 'VAPID 키를 준비하지 못했어요.'
      setState({ status: 'error', message })
      throw new Error(message)
    }

    if (!isPushEnvironmentSupported()) {
      const reason = '푸시 알림을 지원하지 않는 환경이에요. HTTPS에서 지원되는 브라우저로 접속해주세요.'
      setState({ status: 'unsupported', message: reason })
      throw new Error(reason)
    }

    setIsProcessing(true)
    try {
      const permission =
        Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission

      if (permission !== 'granted') {
        const message = '알림 권한이 필요해요. 브라우저 설정에서 허용 후 다시 시도해주세요.'
        setState({ status: 'blocked', message })
        throw new Error(message)
      }

      const registration = await resolveRegistration()
      if (!registration) {
        const message = '서비스 워커가 준비되지 않았어요. 페이지 새로고침 후 다시 시도해주세요.'
        setState({ status: 'error', message })
        throw new Error(message)
      }

      const existing = await registration.pushManager.getSubscription()
      let subscription = existing

      if (!subscription) {
        const applicationServerKey = urlBase64ToUint8Array(vapidKey)
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        })
      }

      const fcmToken = await logFcmTokenOnce(registration, vapidKey)
      if (!fcmToken) {
        throw new Error('FCM 토큰을 발급하지 못했어요. 다시 시도해주세요.')
      }

      const deviceId = ensureDeviceId()
      if (!deviceId) {
        throw new Error('디바이스 정보를 불러오지 못했어요. 다시 시도해주세요.')
      }

      await subscribePushToken(deviceId, fcmToken)
      setState({ status: 'subscribed' })
      void logFcmTokenOnce(registration, vapidKey)
      return subscription
    } catch (error) {
      const message = error instanceof Error ? error.message : '푸시 알림을 설정하지 못했어요.'
      setState((prev) => ({
        status: prev.status === 'blocked' ? 'blocked' : 'error',
        message,
      }))
      throw error
    } finally {
      setIsProcessing(false)
    }
  }, [resolveVapidKey])

  const unsubscribe = useCallback(async () => {
    if (!isPushEnvironmentSupported()) {
      const reason = '푸시 알림을 지원하지 않는 환경이에요. HTTPS에서 지원되는 브라우저로 접속해주세요.'
      setState({ status: 'unsupported', message: reason })
      throw new Error(reason)
    }

    setIsProcessing(true)
    try {
      const deviceId = ensureDeviceId()
      if (!deviceId) {
        throw new Error('디바이스 정보를 불러오지 못했어요. 다시 시도해주세요.')
      }

      const vapidKey = await resolveVapidKey()
      if (!vapidKey) {
        throw new Error('VAPID 키를 가져오지 못했어요. 다시 시도해주세요.')
      }
      const registration = await resolveRegistration()
      if (!registration) {
        throw new Error('서비스 워커가 준비되지 않았어요. 페이지 새로고침 후 다시 시도해주세요.')
      }

      const subscription = await registration.pushManager.getSubscription()
      const fcmToken = await logFcmTokenOnce(registration, vapidKey || undefined)
      if (!fcmToken) {
        throw new Error('FCM 토큰을 찾지 못했어요. 다시 등록한 후 해지해주세요.')
      }

      await unsubscribePushToken(deviceId, fcmToken)
      if (subscription) {
        try {
          await subscription.unsubscribe()
        } catch (error) {
          console.warn('[Push] Failed to unsubscribe locally:', error)
        }
      }
      setState({ status: 'idle' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '푸시 알림 해지에 실패했어요.'
      setState({ status: 'error', message })
      throw error
    } finally {
      setIsProcessing(false)
    }
  }, [resolveVapidKey])

  return {
    state,
    isProcessing,
    describeStatus,
    subscribe,
    unsubscribe,
    refreshStatus,
  }
}

export default usePushSubscription
