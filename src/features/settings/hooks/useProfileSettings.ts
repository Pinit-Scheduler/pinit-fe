import { useCallback, useEffect, useState } from 'react'
import { fetchProfileSettings, updateProfileSettings } from '../api/profileSettings'
import type { ProfileSettings } from '../api/profileSettings'

type UseProfileSettingsReturn = {
  settings: ProfileSettings | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  /** 준 값만 저장한다. 실패하면 오류를 던지고 화면 값은 서버 값 그대로 둔다. */
  save: (change: Partial<ProfileSettings>) => Promise<ProfileSettings>
}

const useProfileSettings = (): UseProfileSettingsReturn => {
  const [settings, setSettings] = useState<ProfileSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    fetchProfileSettings()
      .then((response) => {
        if (isMounted) setSettings(response)
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
    setIsSaving(true)
    try {
      const saved = await updateProfileSettings(change)
      setSettings(saved)
      setError(null)
      return saved
    } finally {
      setIsSaving(false)
    }
  }, [])

  return { settings, isLoading, isSaving, error, save }
}

export default useProfileSettings
