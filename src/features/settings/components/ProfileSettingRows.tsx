import { useMemo, useState } from 'react'
import { useToast } from '@contexts/ToastContext'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { formatOffsetLabel, getZoneOffsetMinutes } from '@shared/utils/datetime'
import { formatMinutesLabel, minutesToIsoDuration, parseIsoDurationMinutes } from '@shared/utils/isoDuration'
import type { ProfileSettings } from '../api/profileSettings'
import { dailyObjectiveOptions, suggestedDeviceZone, timeZoneOptions } from '../utils/profileSettings'
import './ProfileSettingRows.css'

type RowProps = {
  settings: ProfileSettings | null
  isLoading: boolean
  isSaving: boolean
  save: (change: Partial<ProfileSettings>) => Promise<ProfileSettings>
}

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** 자동 계획의 하루 목표(ADR-0028 §2). 고르면 바로 저장한다. */
export const DailyObjectiveSetting = ({ settings, isLoading, isSaving, save }: RowProps) => {
  const { addToast } = useToast()
  const current = parseIsoDurationMinutes(settings?.dailyObjectiveWork)
  const options = useMemo(() => dailyObjectiveOptions(current), [current])

  const handleChange = async (minutes: number) => {
    try {
      await save({ dailyObjectiveWork: minutesToIsoDuration(minutes) })
      addToast(`하루 목표를 ${formatMinutesLabel(minutes)}(으)로 바꿨어요.`, 'success')
    } catch (error) {
      addToast(errorMessage(error, '하루 목표를 바꾸지 못했어요.'), 'error')
    }
  }

  return (
    <div className="settings__row profile-setting">
      <div>
        <label className="settings__label" htmlFor="profile-daily-objective">
          하루 목표
        </label>
        <p className="settings__description">
          자동 계획이 하루에 넣는 작업 시간의 상한이에요. 마감이 오늘이거나 지난 작업은 넘을 수 있어요.
        </p>
      </div>
      <select
        id="profile-daily-objective"
        className="profile-setting__select"
        value={current ?? ''}
        disabled={isLoading || isSaving || current === null}
        onChange={(event) => handleChange(Number(event.target.value))}
      >
        {current === null && <option value="">{isLoading ? '불러오는 중' : '알 수 없음'}</option>}
        {options.map((minutes) => (
          <option key={minutes} value={minutes}>
            {formatMinutesLabel(minutes)}
          </option>
        ))}
      </select>
    </div>
  )
}

const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

const supportedZones = (): string[] => {
  try {
    return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  } catch {
    return []
  }
}

const zoneLabel = (zoneId: string) => `${zoneId} (${formatOffsetLabel(getZoneOffsetMinutes(zoneId))})`

/** 회원 시간대(ADR-0028 §3). 영향이 커서 고른 뒤 "바꾸기"를 눌러야 저장한다. */
export const TimeZoneSetting = ({ settings, isLoading, isSaving, save }: RowProps) => {
  const { addToast } = useToast()
  const { applyZone } = useTimePreferences()
  const current = settings?.zoneId ?? null
  const device = useMemo(() => deviceZone(), [])
  const options = useMemo(() => timeZoneOptions(supportedZones(), current, device), [current, device])
  const labels = useMemo(() => new Map(options.map((zoneId) => [zoneId, zoneLabel(zoneId)])), [options])
  const [draft, setDraft] = useState<string | null>(null)
  const selected = draft ?? current ?? ''
  const suggestion = suggestedDeviceZone(current, device)

  const apply = async (zoneId: string) => {
    try {
      const saved = await save({ zoneId })
      setDraft(null)
      addToast(`시간대를 ${saved.zoneId}(으)로 바꿨어요.`, 'success')
      // 저장한 뒤 표시 시간대를 바꾼다. 앱이 캐시를 비우고 새 시간대로 다시 그린다.
      applyZone(saved.zoneId)
    } catch (error) {
      addToast(errorMessage(error, '시간대를 바꾸지 못했어요.'), 'error')
    }
  }

  return (
    <li className="profile-setting profile-setting--zone">
      <label className="settings__label" htmlFor="profile-zone-id">
        시간대
      </label>
      <p className="settings__description">
        오늘·이번 주 화면, 통계의 주 경계, 계획의 기준이에요. 이미 만든 일정·작업·반복은 만들 때의 시간대를 그대로 써요.
      </p>
      <div className="profile-setting__controls">
        <select
          id="profile-zone-id"
          className="profile-setting__select profile-setting__select--wide"
          value={selected}
          disabled={isLoading || isSaving || current === null}
          onChange={(event) => setDraft(event.target.value === current ? null : event.target.value)}
        >
          {current === null && <option value="">{isLoading ? '시간대를 불러오는 중...' : '알 수 없음'}</option>}
          {options.map((zoneId) => (
            <option key={zoneId} value={zoneId}>
              {labels.get(zoneId)}
            </option>
          ))}
        </select>
        {draft && (
          <div className="profile-setting__confirm">
            <button type="button" className="profile-setting__button" disabled={isSaving} onClick={() => apply(draft)}>
              {isSaving ? '바꾸는 중...' : '바꾸기'}
            </button>
            <button
              type="button"
              className="profile-setting__button profile-setting__button--ghost"
              disabled={isSaving}
              onClick={() => setDraft(null)}
            >
              취소
            </button>
          </div>
        )}
      </div>
      {suggestion && !draft && (
        <p className="settings__description profile-setting__hint">
          이 기기는 {suggestion} 시간대예요.
          <button type="button" className="profile-setting__link" disabled={isSaving} onClick={() => setDraft(suggestion)}>
            이 시간대로 바꾸기
          </button>
        </p>
      )}
    </li>
  )
}
