// 알림 설정(ADR-0021 §3·§8). 서버 계약과 화면 선택지를 한 곳에 둔다.

export type NotificationPreferences = {
  scheduleStartEnabled: boolean
  /** 일정 시작 N분 전 알림. null이면 끔. */
  scheduleReminderMinutes: number | null
  taskDeadlineEnabled: boolean
  /** 마감일 당일 요약 알림 시각(HH:mm, zoneId 기준) */
  taskDeadlineTime: string
  zoneId: string
  /**
   * 작업 쪼개기 푸시(ADR-0035 §14.4). 꺼도 알림함 기록은 남는다.
   * 서버(Gate X6)가 아직 없어 이름은 가정이다. 이 항목을 모르는 서버의 응답에는 없을 수 있어 `taskSplitEnabledOf`로 읽는다.
   */
  taskSplitEnabled: boolean
}

export const REMINDER_MINUTE_OPTIONS = [5, 10, 15, 30, 60] as const

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  scheduleStartEnabled: true,
  scheduleReminderMinutes: null,
  taskDeadlineEnabled: false,
  taskDeadlineTime: '09:00',
  zoneId: 'Asia/Seoul',
  taskSplitEnabled: true,
}

/** 쪼개기 알림이 켜져 있는가. 값이 없으면(쪼개기 항목을 모르는 서버의 응답) 켜짐이다. */
export const taskSplitEnabledOf = (preferences: Partial<NotificationPreferences>): boolean =>
  preferences.taskSplitEnabled ?? true

/**
 * 쪼개기 알림 줄을 그릴지. 서버 응답에 그 항목이 있을 때만이다. 모르는 서버는 저장해도 값을 무시해
 * 줄이 "저장됨"을 보이면서 켜진 채로 남는다.
 */
export const taskSplitKnownIn = (
  preferences: Partial<NotificationPreferences> | null | undefined,
): boolean => preferences?.taskSplitEnabled != null

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
