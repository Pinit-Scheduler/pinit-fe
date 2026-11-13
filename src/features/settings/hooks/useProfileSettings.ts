import { useCallback, useRef } from 'react'
import useRevalidatingQuery from '@shared/hooks/useRevalidatingQuery'
import { fetchProfileSettings, updateProfileSettings } from '../api/profileSettings'
import type { ProfileSettings } from '../api/profileSettings'
import { memberStore, PROFILE_SETTINGS_KEY } from './memberStore'

type UseProfileSettingsReturn = {
  settings: ProfileSettings | null
  isLoading: boolean
  /** 준 값만 저장한다. 실패하면 오류를 던지고 화면 값은 서버 값 그대로 둔다. */
  save: (change: Partial<ProfileSettings>) => Promise<ProfileSettings>
}

/**
 * 하루 목표·시간대. 마지막으로 받은 값이 있으면 바로 보여 주고(시간대를 바꿔 앱이 다시 그려질 때도) 서버 값으로 다시 맞춘다.
 * 읽는 동안 저장했다면 늦게 온 읽기 응답 대신 저장한 값을 둔다. 그래야 방금 저장한 값이 예전 값으로 잠깐 돌아가지 않는다.
 */
const useProfileSettings = (): UseProfileSettingsReturn => {
  const saves = useRef(0)
  const lastSaved = useRef<ProfileSettings | null>(null)
  const { data, isInitialLoading, setData } = useRevalidatingQuery<ProfileSettings | null>(
    PROFILE_SETTINGS_KEY,
    async () => {
      const savesAtStart = saves.current
      const response = await fetchProfileSettings()
      return saves.current === savesAtStart ? response : lastSaved.current
    },
    { store: memberStore, errorMessage: '설정을 불러오지 못했어요.' },
  )

  const save = useCallback(
    async (change: Partial<ProfileSettings>) => {
      const saved = await updateProfileSettings(change)
      saves.current += 1
      lastSaved.current = saved
      setData(saved)
      return saved
    },
    [setData],
  )

  return { settings: data ?? null, isLoading: isInitialLoading, save }
}

export default useProfileSettings
