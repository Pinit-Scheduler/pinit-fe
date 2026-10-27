import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type {
  DifficultyFactor,
  TimeCalibrationResponse,
  WeeklyReviewItem,
  WeeklyReviewResponse,
} from '../features/calibration/types/calibration'
import { weekStartOf } from '../features/calibration/utils/calibrationView'

dayjs.extend(utc)
dayjs.extend(timezone)

// 개발용 모크. 계수·주간 리뷰 계산은 서버(ADR-0018)에 있고, 여기서는 화면 확인에 필요한 모양과
// 대표 사례(난이도별 계수, 표본 부족으로 전체 계수를 쓰는 난이도, 표본 없음, 초과·단축 작업, 측정 못 한 일정)만 고정값으로 준다.
// 보정 켜기·끄기는 메모리에 남는다. 이번 주보다 앞선 주는 같은 모양을, 미래 주는 빈 주를 돌려준다.

const ZONE_ID = 'Asia/Seoul'
const WINDOW_DAYS = 90
const MIN_SAMPLES = 5

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

let calibrationEnabled = false

const factor = (difficulty: number, value: number, rawMedian: number | null, sampleCount: number, source: DifficultyFactor['source']) => ({
  difficulty,
  factor: value,
  rawMedian,
  sampleCount,
  source,
})

const calibration = (): TimeCalibrationResponse => ({
  enabled: calibrationEnabled,
  windowDays: WINDOW_DAYS,
  minSamples: MIN_SAMPLES,
  overall: { factor: 1.25, rawMedian: 1.25, sampleCount: 23 },
  byDifficulty: [
    factor(1, 1.1, 1.1, 6, 'DIFFICULTY'),
    factor(2, 1.25, 1.4, 3, 'OVERALL'),
    factor(3, 1.3, 1.3, 8, 'DIFFICULTY'),
    factor(5, 1.25, null, 0, 'OVERALL'),
    factor(8, 1.6, 1.6, 6, 'DIFFICULTY'),
    factor(13, 1.25, 2.1, 2, 'OVERALL'),
    factor(21, 1, null, 0, 'NONE'),
  ],
})

const item = (scheduleId: number, title: string, difficulty: number, baseDuration: string, actualDuration: string, ratio: number): WeeklyReviewItem => ({
  scheduleId,
  taskId: scheduleId + 100,
  title,
  difficulty,
  baseDuration,
  actualDuration,
  ratio,
})

const reviewFor = (weekStart: string): WeeklyReviewResponse => {
  const thisWeek = weekStartOf(dayjs().tz(ZONE_ID).format('YYYY-MM-DD'))
  const empty = thisWeek !== null && weekStart > thisWeek
  return {
    weekStart,
    zoneId: ZONE_ID,
    summary: empty
      ? { measuredCount: 0, totalBase: 'PT0S', totalActual: 'PT0S', medianRatio: null, accuracy: null, previousWeekMedianRatio: 1.3 }
      : { measuredCount: 7, totalBase: 'PT6H', totalActual: 'PT7H35M', medianRatio: 1.3, accuracy: 0.43, previousWeekMedianRatio: 1.45 },
    byDifficulty: empty
      ? []
      : [
          { difficulty: 3, count: 3, medianRatio: 1.2 },
          { difficulty: 8, count: 3, medianRatio: 1.6 },
          { difficulty: 13, count: 1, medianRatio: 0.8 },
        ],
    overruns: empty
      ? []
      : [item(11, '발표 자료 만들기', 8, 'PT1H30M', 'PT2H40M', 1.78), item(12, 'UI 리서치 정리', 3, 'PT45M', 'PT1H10M', 1.56)],
    underruns: empty ? [] : [item(13, '분기 보고서 초안', 13, 'PT2H', 'PT1H35M', 0.79)],
    unmeasured: empty
      ? { noTimer: 0, taskCompletedOnly: 0, running: 0, runningElapsed: 'PT0S', outlier: 0 }
      : { noTimer: 2, taskCompletedOnly: 1, running: 1, runningElapsed: 'PT25M', outlier: 1 },
    calibration: calibration(),
  }
}

export const handleCalibration = async (path: string, method: string, searchParams: URLSearchParams, request: Request) => {
  if (path === '/v2/time-calibration' && method === 'GET') return json(calibration())

  if (path === '/v2/time-calibration' && method === 'PUT') {
    const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null
    if (typeof body?.enabled !== 'boolean') return json({ message: 'enabled가 필요합니다.' }, 400)
    calibrationEnabled = body.enabled
    return json(calibration())
  }

  if (path === '/v2/statistics/weekly-review' && method === 'GET') {
    const requested = searchParams.get('weekStart')
    const weekStart = weekStartOf(requested ?? dayjs().tz(ZONE_ID).format('YYYY-MM-DD'))
    if (!weekStart) return json({ message: 'weekStart는 YYYY-MM-DD여야 합니다.' }, 400)
    return json(reviewFor(weekStart))
  }

  return null
}
