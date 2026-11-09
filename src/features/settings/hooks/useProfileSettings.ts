import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchProfileSettings, updateProfileSettings } from '../api/profileSettings'
import type { ProfileSettings } from '../api/profileSettings'
import { profileSettingsCache } from './memberCache'

type UseProfileSettingsReturn = {
  settings: ProfileSettings | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  /** 준 값만 저장한다. 실패하면 오류를 던지고 화면 값은 서버 값 그대로 둔다. */
  save: (change: Partial<ProfileSettings>) => Promise<ProfileSettings>
}

/**
 * 하루 목표·시간대. 마지막으로 받은 값이 있으면 바로 보여 주고(시간대를 바꿔 앱이 다시 그려질 때도) 서버 값으로 다시 맞춘다.
 * 읽는 동안 저장했다면 늦게 온 읽기 응답은 버린다. 그래야 방금 저장한 값이 예전 값으로 잠깐 돌아가지 않는다.
 */
const useProfileSettings = (): UseProfileSettingsReturn => {
  const [settings, setSettings] = useState<ProfileSettings | null>(() => profileSettingsCache.read() ?? null)
  const [isLoading, setIsLoading] = useState(() => profileSettingsCache.read() === undefined)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saves = useRef(0)

  useEffect(() => {
    let isMounted = true
    const savesAtStart = saves.current
    fetchProfileSettings()
      .then((response) => {
        if (!isMounted || saves.current !== savesAtStart) return
        setSettings(response)
        if (response) profileSettingsCache.write(response)
      })
      .catch((err) => {
        if (isMounted) setError(err instanceof Error ? err.message : '설정을 불러오지 못했어요.')
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })
    return () => {
      isMounted = false
    }
  }, [])

  const save = useCallback(async (change: Partial<ProfileSettings>) => {
    saves.current += 1
    setIsSaving(true)
    try {
      const saved = await updateProfileSettings(change)
      setSettings(saved)
      profileSettingsCache.write(saved)
      setError(null)
      return saved
    } finally {
      setIsSaving(false)
    }
  }, [])

  return { settings, isLoading, isSaving, error, save }
}

export default useProfileSettings
