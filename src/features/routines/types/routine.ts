// ADR-0016 생활 시간(GET/PUT /v2/routines) wire 형식.

export type RoutineKind = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SLEEP' | 'CUSTOM'

export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

export type RoutineInput = {
  kind: RoutineKind
  /** 1~20자. CUSTOM이면 필수, 나머지는 null 가능 */
  label: string | null
  /** "HH:mm" 로컬 시각 */
  startTime: string
  /** ISO-8601 기간, 5분~16시간, 분 단위. 자정을 넘을 수 있다 */
  duration: string
  /** 이 요일 startTime에 시작한다 */
  days: DayOfWeek[]
  /** ADR-0027: 시작 시각 알림. 보내지 않으면 서버가 false로 본다. 이전 서버 응답에는 없다 */
  remindAtStart?: boolean
}

export type Routine = RoutineInput & { id: number }

export type RoutinesResponse = { routines: Routine[] }

export type RoutinesRequest = { routines: RoutineInput[] }

// ADR-0027 날짜 예외(GET /v2/routines/overrides, PUT·DELETE /v2/routines/overrides/{date}) wire 형식.
// 예외는 그 날짜에 시작하는 생활 시간 전체를 routines로 바꾼다. 빈 배열은 그날 생활 시간 없음이다.

export type RoutineOverrideItemInput = {
  kind: RoutineKind
  label: string | null
  /** "HH:mm" 그날 시작 시각 */
  startTime: string
  /** ISO-8601 기간 */
  duration: string
  remindAtStart: boolean
}

export type RoutineOverrideItem = RoutineOverrideItemInput & { id: number }

export type RoutineOverride = {
  /** YYYY-MM-DD 회원 로컬 날짜 */
  date: string
  note: string | null
  routines: RoutineOverrideItem[]
}

export type RoutineOverridesResponse = { overrides: RoutineOverride[] }

export type RoutineOverrideRequest = {
  note: string | null
  routines: RoutineOverrideItemInput[]
}
