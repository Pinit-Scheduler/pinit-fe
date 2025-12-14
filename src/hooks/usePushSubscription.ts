import { useCallback, useEffect, useMemo, useState } from 'react'
import { registerPushSubscription } from '../api/notifications'
import { logFcmTokenOnce } from '../firebase/messaging'

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
  const vapidPublicKey = "BF8QQIULasLr94n0l0xbv43yZeNICudM5lpQN08VYn2g5VjBPU0wM98HypyRmEb-y0ARRsiZ_wcgSMIC-nq-x20"

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
      const registration = await resolveRegistration()
      if (!registration) {
        setState({
          status: 'error',
          message: '서비스 워커를 찾지 못했어요. 배포 환경에서 새로고침 후 다시 시도해주세요.',
        })
        return
      }

      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        setState({ status: 'subscribed' })
        void logFcmTokenOnce(registration, vapidPublicKey)
        return
      }

      setState({ status: 'idle' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '구독 상태를 확인하지 못했어요.'
      setState({ status: 'error', message })
    }
  }, [vapidPublicKey])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  const subscribe = useCallback(async () => {
    if (!vapidPublicKey) {
      const message = 'VAPID 키가 설정되지 않았어요. 환경 변수를 확인해주세요.'
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
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        })
      }

      const fcmToken = await logFcmTokenOnce(registration, vapidPublicKey)
      if (!fcmToken) {
        throw new Error('FCM 토큰을 발급하지 못했어요. 다시 시도해주세요.')
      }

      await registerPushSubscription(fcmToken)
      setState({ status: 'subscribed' })
      void logFcmTokenOnce(registration, vapidPublicKey)
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
  }, [vapidPublicKey])

  return {
    state,
    isProcessing,
    describeStatus,
    subscribe,
    refreshStatus,
  }
}

export default usePushSubscription
