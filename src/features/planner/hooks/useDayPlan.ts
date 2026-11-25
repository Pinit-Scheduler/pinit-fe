import { useSpaces } from '@features/spaces/store'
import { ownSchedules } from '@features/spaces/scope'
import { fetchSchedules } from '@features/schedules/api/schedules'
import type { ScheduleResponse } from '@features/schedules/types/schedule'
import { useEffect, useMemo, useRef } from 'react'
import useRevalidatingQuery from '@shared/hooks/useRevalidatingQuery'
import { sameData } from '@shared/utils/sameData'
import { fetchDayPlan } from '../api/plans'
import type { DayPlanResponse } from '../types/plan'
import { dayPlanKey } from '../utils/planData'

type UseDayPlanParams = {
  date: string
  zoneId: string
  horizonDays: number
}

type UseDayPlanReturn = {
  plan: DayPlanResponse | null
  /** 화면의 계획을 요청한 조건. 같은 조건을 다시 불러온 계획인지 가린다 */
  planKey: string | null
  /** 시간창이 걸친 날짜(계획일, 자정을 넘으면 다음 날)의 내 기존 일정. 고른 스페이스와 상관없이 모든 스페이스에서 읽는다 */
  schedules: ScheduleResponse[]
  isLoading: boolean
  /** 화면의 계획을 다시 불러오는 중이다. 끝나기 전에는 계획이 바뀔 수 있다 */
  isRefreshing: boolean
  /** 지금 조건(날짜·시간대·범위·스페이스)의 계획이 아직 한 번도 오지 않았다 */
  isInitialLoading: boolean
  error: string | null
  refetch: () => void
}

type LoadedPlan = {
  plan: DayPlanResponse
  schedules: ScheduleResponse[]
}

const NO_SCHEDULES: ScheduleResponse[] = []

// 일정은 개인 단위다. 계획이 피해야 할 시간은 고른 스페이스의 일정이 아니라 내 일정 전부다.
// 계획 제안(`fetchDayPlan`)은 여전히 고른 스페이스·프로젝트의 작업으로 만든다.
const fetchSchedulesOn = (date: string, zoneId: string) =>
  fetchSchedules({ dateTime: `${date}T12:00:00`, zoneId }, { allSpaces: true })

const loadDayPlan = async (
  date: string,
  zoneId: string,
  horizonDays: number,
): Promise<LoadedPlan> => {
  const [plan, sameDay] = await Promise.all([
    fetchDayPlan({ date, zoneId, horizonDays }),
    fetchSchedulesOn(date, zoneId),
  ])
  // 취침이 기상보다 이르면 시간창이 다음 날까지 이어지므로 그날 일정도 장애물로 보여 준다.
  const windowEndDate = plan.window.end.dateTime.slice(0, 10)
  const nextDay =
    windowEndDate > date ? await fetchSchedulesOn(windowEndDate, zoneId) : []
  const byId = new Map<number, ScheduleResponse>()
  ;[...sameDay, ...nextDay].forEach((schedule) => byId.set(schedule.id, schedule))
  return {
    plan,
    // 같은 zoneId로 요청한 응답이라 로컬 시각 문자열 순서가 시간 순서다.
    schedules: [...byId.values()].sort((a, b) =>
      a.date.dateTime.localeCompare(b.date.dateTime),
    ),
  }
}

/** 다시 불러온 내용이 같으면 지난 객체를 그대로 쓴다. 화면이 객체가 바뀐 것을 보고 편집 상태를 되돌리지 않게 한다. */
const keepUnchanged = (previous: LoadedPlan, next: LoadedPlan): LoadedPlan => {
  const plan = sameData(previous.plan, next.plan) ? previous.plan : next.plan
  const schedules = sameData(previous.schedules, next.schedules)
    ? previous.schedules
    : next.schedules
  return plan === previous.plan && schedules === previous.schedules
    ? previous
    : { plan, schedules }
}

/**
 * 하루 계획 제안과, 같은 시간대에 이미 있는 일정을 함께 불러온다.
 * 다시 불러오는 동안과 실패한 뒤에도 같은 조건의 계획은 화면에 남긴다.
 * 조건이 바뀌면 이전 조건의 계획은 내보내지 않는다.
 */
const useDayPlan = ({
  date,
  zoneId,
  horizonDays,
}: UseDayPlanParams): UseDayPlanReturn => {
  const {
    selectedSpaceId,
    selectedProjectId,
    memberId,
    spaces,
    error: workspaceError,
    reload: reloadWorkspace,
  } = useSpaces()
  const key = dayPlanKey({
    date,
    zoneId,
    horizonDays,
    spaceId: selectedSpaceId,
    projectId: selectedProjectId,
  })
  const shown = useRef<{ key: string; loaded: LoadedPlan } | null>(null)
  const query = useRevalidatingQuery<LoadedPlan>(
    'plan/day/' + key,
    async () => {
      const loaded = await loadDayPlan(date, zoneId, horizonDays)
      const previous = shown.current
      return previous?.key === key ? keepUnchanged(previous.loaded, loaded) : loaded
    },
    { errorMessage: '계획을 불러오지 못했어요.' },
  )
  useEffect(() => {
    shown.current = query.data ? { key, loaded: query.data } : null
  }, [key, query.data])
  // 내가 누구인지 모르면(스페이스 정보가 아직 없거나 못 받음) 받은 일정에서 내 일정을 가릴 수 없다.
  // 그동안은 계획을 내보내지 않는다. 기존 일정 없이 계획을 보이면 겹침을 못 보고 승인하게 된다.
  const memberKnown = memberId !== 0
  const data = memberKnown ? query.data : undefined
  // 다시 불러오는 동안에는 지난 실패를 내린다. 계획이 없으면 그동안 불러오는 중으로 보인다.
  // 스페이스 정보를 못 받았으면 그 실패를 계획의 실패로 보인다.
  const error = query.isFetching
    ? null
    : (query.error ?? (memberKnown ? null : (workspaceError ?? null)))
  const isInitialLoading = data === undefined && error === null
  // 받은 일정은 캐시에 그대로 두고 여기서 내 일정만 남긴다. 회원·스페이스 정보가 늦게 와도 빈 목록이 캐시에 남지 않는다.
  const loadedSchedules = data?.schedules ?? NO_SCHEDULES
  const schedules = useMemo(
    () => ownSchedules(loadedSchedules, memberId, spaces),
    [loadedSchedules, memberId, spaces],
  )
  return {
    plan: data?.plan ?? null,
    planKey: data ? key : null,
    schedules,
    isLoading: query.isFetching || isInitialLoading,
    isRefreshing: query.isRefreshing,
    isInitialLoading,
    error,
    refetch: () => {
      if (!memberKnown) void reloadWorkspace().catch(() => {})
      query.refetch()
    },
  }
}

export default useDayPlan
