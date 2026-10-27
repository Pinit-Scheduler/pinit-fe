import { useCallback, useEffect, useState } from 'react'
import { applyThemePreference, readThemePreference, writeThemePreference, type ThemePreference } from './theme'

/** 저장된 테마 선택을 읽고 바꾼다. 'system'일 때는 OS 테마가 바뀌면 주소창 색도 따라 바꾼다. */
export const useThemePreference = () => {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference())

  useEffect(() => {
    applyThemePreference(preference)
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyThemePreference('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next)
    setPreferenceState(next)
  }, [])

  return { preference, setPreference }
}
