import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchNotificationPreferences, saveNotificationPreferences } from '../api/notificationPreferences'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  withZone,
} from '../utils/notificationPreferences'
import { notificationPreferencesCache } from './memberCache'

type UseNotificationPreferencesReturn = {
  preferences: NotificationPreferences
  isLoading: boolean
  isSaving: boolean
  loadError: string | null
  /** 바꾼 값을 바로 저장한다. 실패하면 이전 값으로 되돌리고 오류를 던진다. */
  update: (patch: Partial<NotificationPreferences>) => Promise<void>
}

/**
 * 알림 설정. 마지막으로 받은 값이 있으면 기본값 대신 바로 보여 주고, 서버 값으로 다시 맞춘다.
 * 읽는 동안 사용자가 이미 바꿨다면 늦게 온 읽기 응답은 버린다. 그래야 토글이 예전 값으로 되튀지 않는다.
 */
const useNotificationPreferences = (zoneId: string): UseNotificationPreferencesReturn => {
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    () => notificationPreferencesCache.read() ?? DEFAULT_NOTIFICATION_PREFERENCES,
  )
  const [isLoading, setIsLoading] = useState(() => notificationPreferencesCache.read() === undefined)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const latest = useRef(preferences)
  const updates = useRef(0)

  useEffect(() => {
    latest.current = preferences
  }, [preferences])

  useEffect(() => {
    let isMounted = true
    const updatesAtStart = updates.current
    const load = async () => {
      try {
        const response = await fetchNotificationPreferences()
        if (isMounted && response && updates.current === updatesAtStart) {
          setPreferences(response)
          notificationPreferencesCache.write(response)
        }
      } catch (error) {
        if (isMounted) setLoadError(error instanceof Error && error.message ? error.message : '알림 설정을 불러오지 못했어요.')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    load()
    return () => {
      isMounted = false
    }
  }, [])

  const update = useCallback(
    async (patch: Partial<NotificationPreferences>) => {
      updates.current += 1
      const previous = latest.current
      const next = withZone({ ...previous, ...patch }, zoneId)
      latest.current = next
      setPreferences(next)
      setIsSaving(true)
      try {
        const saved = await saveNotificationPreferences(next)
        if (saved) {
          setPreferences(saved)
          notificationPreferencesCache.write(saved)
        }
      } catch (error) {
        setPreferences(previous)
        throw error
      } finally {
        setIsSaving(false)
      }
    },
    [zoneId],
  )

  return { preferences, isLoading, isSaving, loadError, update }
}

export default useNotificationPreferences
