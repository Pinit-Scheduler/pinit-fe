// 알림 설정(ADR-0021 §3·§8). 서버 계약과 화면 선택지를 한 곳에 둔다.

export type NotificationPreferences = {
  scheduleStartEnabled: boolean
  /** 일정 시작 N분 전 알림. null이면 끔. */
  scheduleReminderMinutes: number | null
  taskDeadlineEnabled: boolean
  /** 마감일 당일 요약 알림 시각(HH:mm, zoneId 기준) */
  taskDeadlineTime: string
  zoneId: string
}

export const REMINDER_MINUTE_OPTIONS = [5, 10, 15, 30, 60] as const

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  scheduleStartEnabled: true,
  scheduleReminderMinutes: null,
  taskDeadlineEnabled: false,
  taskDeadlineTime: '09:00',
  zoneId: 'Asia/Seoul',
}

export const reminderOptionLabel = (minutes: number | null) =>
  minutes === null ? '끔' : minutes === 60 ? '1시간 전' : `${minutes}분 전`

/** select 값('off' 또는 분)을 설정 값으로 바꾼다. 선택지 밖의 값은 끔으로 본다. */
export const parseReminderOption = (value: string): number | null => {
  const minutes = Number(value)
  return (REMINDER_MINUTE_OPTIONS as readonly number[]).includes(minutes) ? minutes : null
}

/** time input 값(HH:mm 또는 HH:mm:ss)을 서버 형식 HH:mm으로 맞춘다. 형식이 틀리면 null. */
export const normalizeDeadlineTime = (value: string): string | null => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value)
  return match ? `${match[1]}:${match[2]}` : null
}

/** 저장할 때 회원 시간대를 함께 보낸다. 마감일 알림 시각은 이 시간대 기준이다. */
export const withZone = (preferences: NotificationPreferences, zoneId: string): NotificationPreferences => ({
  ...preferences,
  zoneId: zoneId || preferences.zoneId,
})
