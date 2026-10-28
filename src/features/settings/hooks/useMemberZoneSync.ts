import { useEffect, useRef } from 'react'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { fetchProfileSettings } from '../api/profileSettings'

/**
 * 앱 화면(AppShell)이 열릴 때 회원 시간대를 한 번 읽어 표시 시간대로 쓴다(ADR-0028). 다른 기기에서 바꾼 시간대도 여기서 따라간다.
 * 로그아웃하면 AppShell이 내려가므로 다음 로그인 때 다시 읽는다. 실패하면 마지막으로 저장한 시간대를 계속 쓴다.
 */
export const useMemberZoneSync = () => {
  const { zoneId, applyZone } = useTimePreferences()
  const didSync = useRef(false)

  useEffect(() => {
    if (didSync.current) return
    didSync.current = true
    fetchProfileSettings()
      .then((settings) => {
        if (settings?.zoneId && settings.zoneId !== zoneId) applyZone(settings.zoneId)
      })
      .catch((error) => {
        console.warn('[TimeZone] 회원 시간대를 불러오지 못했어요:', error)
      })
  }, [zoneId, applyZone])
}
