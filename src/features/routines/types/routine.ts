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
}

export type Routine = RoutineInput & { id: number }

export type RoutinesResponse = { routines: Routine[] }

export type RoutinesRequest = { routines: RoutineInput[] }
