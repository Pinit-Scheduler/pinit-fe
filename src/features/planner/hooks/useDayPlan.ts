import { useSpaces } from '@features/spaces/store'
import { fetchSchedules } from '@features/schedules/api/schedules'
import type { ScheduleResponse } from '@features/schedules/types/schedule'
import { useEffect, useRef } from 'react'
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
  /** 시간창이 걸친 날짜(계획일, 자정을 넘으면 다음 날)의 기존 일정 */
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

const fetchSchedulesOn = (date: string, zoneId: string) =>
  fetchSchedules({ dateTime: `${date}T12:00:00`, zoneId })

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
  const { selectedSpaceId, selectedProjectId } = useSpaces()
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
  // 다시 불러오는 동안에는 지난 실패를 내린다. 계획이 없으면 그동안 불러오는 중으로 보인다.
  const error = query.isFetching ? null : query.error
  const isInitialLoading = query.data === undefined && error === null
  return {
    plan: query.data?.plan ?? null,
    planKey: query.data ? key : null,
    schedules: query.data?.schedules ?? NO_SCHEDULES,
    isLoading: query.isFetching || isInitialLoading,
    isRefreshing: query.isRefreshing,
    isInitialLoading,
    error,
    refetch: query.refetch,
  }
}

export default useDayPlan
