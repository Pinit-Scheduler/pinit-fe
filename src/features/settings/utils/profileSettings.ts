// 설정 화면의 하루 목표·시간대 선택지(ADR-0028). 의존성이 없어야 node 테스트에서 그대로 불러 쓸 수 있다.

/** 서버 규칙: 30분 이상 16시간 이하, 5분 단위. 화면은 30분 간격으로 고르게 한다. */
export const DAILY_OBJECTIVE_MIN_MINUTES = 30
export const DAILY_OBJECTIVE_MAX_MINUTES = 16 * 60
export const DAILY_OBJECTIVE_STEP_MINUTES = 30

/** 하루 목표 선택지(분). 지금 값이 30분 간격이 아니어도(API로 바꾼 경우) 목록에 넣어 그대로 보이게 한다. */
export const dailyObjectiveOptions = (currentMinutes: number | null): number[] => {
  const options: number[] = []
  for (let minutes = DAILY_OBJECTIVE_MIN_MINUTES; minutes <= DAILY_OBJECTIVE_MAX_MINUTES; minutes += DAILY_OBJECTIVE_STEP_MINUTES) {
    options.push(minutes)
  }
  if (currentMinutes !== null && !options.includes(currentMinutes)) {
    options.push(currentMinutes)
    options.sort((a, b) => a - b)
  }
  return options
}

/** 오프셋 전용 id("+09:00", "UTC+9")와 약어는 서버가 받지 않는다. 지역 id만 남긴다. */
const isRegionZoneId = (zoneId: string) => zoneId === 'UTC' || /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(zoneId)

/**
 * 시간대 선택지. 브라우저가 아는 IANA 목록에 UTC, 지금 회원 시간대, 기기 시간대를 더해 중복 없이 이름순으로 돌려준다.
 * 브라우저가 목록을 주지 않으면 세 값만 쓴다.
 */
export const timeZoneOptions = (supported: readonly string[], current: string | null, device: string | null): string[] => {
  const zones = new Set<string>(supported.filter(isRegionZoneId))
  zones.add('UTC')
  if (current) zones.add(current)
  if (device && isRegionZoneId(device)) zones.add(device)
  return [...zones].sort((a, b) => a.localeCompare(b))
}

/** 기기 시간대가 회원 시간대와 다를 때만 기기 시간대를 돌려준다. 제안에 쓴다. */
export const suggestedDeviceZone = (current: string | null, device: string | null): string | null => {
  if (!current || !device || device === current || !isRegionZoneId(device)) return null
  return device
}
