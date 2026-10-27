import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchNotificationPreferences, saveNotificationPreferences } from '../api/notificationPreferences'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  withZone,
} from '../utils/notificationPreferences'

type UseNotificationPreferencesReturn = {
  preferences: NotificationPreferences
  isLoading: boolean
  isSaving: boolean
  loadError: string | null
  /** 바꾼 값을 바로 저장한다. 실패하면 이전 값으로 되돌리고 오류를 던진다. */
  update: (patch: Partial<NotificationPreferences>) => Promise<void>
}

const useNotificationPreferences = (zoneId: string): UseNotificationPreferencesReturn => {
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const latest = useRef(preferences)

  useEffect(() => {
    latest.current = preferences
  }, [preferences])

  useEffect(() => {
    let isMounted = true
    const load = async () => {
      try {
        const response = await fetchNotificationPreferences()
        if (isMounted && response) setPreferences(response)
      } catch (error) {
        if (isMounted) setLoadError(error instanceof Error ? error.message : '알림 설정을 불러오지 못했어요.')
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
      const previous = latest.current
      const next = withZone({ ...previous, ...patch }, zoneId)
      latest.current = next
      setPreferences(next)
      setIsSaving(true)
      try {
        const saved = await saveNotificationPreferences(next)
        if (saved) setPreferences(saved)
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
