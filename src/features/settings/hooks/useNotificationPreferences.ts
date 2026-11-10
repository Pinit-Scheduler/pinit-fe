import { useCallback, useEffect, useRef } from 'react'

import useRevalidatingQuery from '@shared/hooks/useRevalidatingQuery'
import { fetchNotificationPreferences, saveNotificationPreferences } from '../api/notificationPreferences'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  withZone,
} from '../utils/notificationPreferences'
import { memberStore } from './memberStore'

type UseNotificationPreferencesReturn = {
  preferences: NotificationPreferences
  isLoading: boolean
  loadError: string | null
  /** 바꾼 값을 바로 저장한다. 실패하면 이전 값으로 되돌리고 오류를 던진다. */
  update: (patch: Partial<NotificationPreferences>) => Promise<void>
}

/**
 * 알림 설정. 마지막으로 받은 값이 있으면 기본값 대신 바로 보여 주고, 서버 값으로 다시 맞춘다.
 * 읽는 동안 사용자가 이미 바꿨다면 늦게 온 읽기 응답 대신 화면 값을 둔다. 그래야 토글이 예전 값으로 되튀지 않는다.
 */
const useNotificationPreferences = (zoneId: string): UseNotificationPreferencesReturn => {
  const updates = useRef(0)
  const shown = useRef<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES)
  const { data, error, isInitialLoading, setData } = useRevalidatingQuery<NotificationPreferences | null>(
    'settings/notification-preferences',
    async () => {
      const updatesAtStart = updates.current
      const response = await fetchNotificationPreferences()
      return updates.current === updatesAtStart ? response : shown.current
    },
    { store: memberStore, errorMessage: '알림 설정을 불러오지 못했어요.' },
  )
  const preferences = data ?? DEFAULT_NOTIFICATION_PREFERENCES

  useEffect(() => {
    shown.current = preferences
  }, [preferences])

  const update = useCallback(
    async (patch: Partial<NotificationPreferences>) => {
      updates.current += 1
      const previous = shown.current
      const next = withZone({ ...previous, ...patch }, zoneId)
      shown.current = next
      setData(next)
      try {
        const saved = await saveNotificationPreferences(next)
        if (saved) {
          shown.current = saved
          setData(saved)
        }
      } catch (error) {
        shown.current = previous
        setData(previous)
        throw error
      }
    },
    [setData, zoneId],
  )

  return { preferences, isLoading: isInitialLoading, loadError: error, update }
}

export default useNotificationPreferences
