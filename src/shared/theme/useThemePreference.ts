import { useCallback, useEffect, useState } from 'react'
import { applyThemePreference, readThemePreference, writeThemePreference, type ThemePreference } from './theme'

/** 저장된 테마 선택을 읽고 바꾼다. OS 테마 변화는 main.tsx의 watchSystemTheme이 따라간다. */
export const useThemePreference = () => {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference())

  useEffect(() => {
    applyThemePreference(preference)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next)
    setPreferenceState(next)
  }, [])

  return { preference, setPreference }
}
