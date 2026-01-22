import dayjs from 'dayjs'
import type { DateTimeWithZone } from '../types/datetime'
import type { Task } from '../types/task'
import type { ScheduleResponse, ScheduleState } from '../types/schedule'

export type MockUser = {
  id: number
  username: string
  password: string
  nickname: string
  zoneOffset: string
}

const makeDateTime = (offsetDays: number, hour: number, minute = 0, zoneId = 'UTC'): DateTimeWithZone => ({
  dateTime: dayjs().add(offsetDays, 'day').hour(hour).minute(minute).second(0).format('YYYY-MM-DDTHH:mm:ss'),
  zoneId,
})

let taskSeq = 3
let scheduleSeq = 3

export const mockUsers: MockUser[] = [
  { id: 1, username: 'demo', password: 'demo1234', nickname: '데모 유저', zoneOffset: '+09:00' },
  { id: 2, username: 'pinit', password: 'pinit', nickname: 'Pinit 팀', zoneOffset: '+09:00' },
]

export const mockTasks: Task[] = [
  {
    id: 1,
    title: 'UI 리서치 정리',
    description: '다음 스프린트 준비용',
    dueDate: makeDateTime(0, 18, 0),
    importance: 7,
    difficulty: 3,
    isCompleted: false,
    inboundTaskCount: 0,
  },
  {
    id: 2,
    title: '푸시 알림 세팅',
    description: '웹 푸시 키/토큰 확인',
    dueDate: makeDateTime(1, 10, 0),
    importance: 6,
    difficulty: 2,
    isCompleted: false,
    inboundTaskCount: 1,
  },
  {
    id: 3,
    title: '통계 뷰 QA',
    description: '주간 통계 지표 검증',
    dueDate: makeDateTime(-1, 15, 30),
    importance: 5,
    difficulty: 1,
    isCompleted: true,
    inboundTaskCount: 0,
  },
]

export const mockSchedules: ScheduleResponse[] = [
  {
    id: 1,
    ownerId: 1,
    title: 'Deep Work 블록',
    description: 'UI 설계',
    date: makeDateTime(0, 9, 0),
    scheduleType: 'DEEP_WORK',
    state: 'IN_PROGRESS',
    taskId: 1,
    duration: '01:00:00',
  },
  {
    id: 2,
    ownerId: 1,
    title: '알림 점검',
    description: '푸시 모듈 테스트',
    date: makeDateTime(0, 14, 0),
    scheduleType: 'ADMIN_TASK',
    state: 'NOT_STARTED',
    taskId: 2,
    duration: '00:45:00',
  },
  {
    id: 3,
    ownerId: 1,
    title: '회고 준비',
    description: '주간 통계 리뷰',
    date: makeDateTime(-1, 17, 0),
    scheduleType: 'QUICK_TASK',
    state: 'COMPLETED',
    duration: '00:30:00',
  },
]

export const mockPushSubscriptions = new Map<string, Set<string>>()
export const vapidPublicKey = 'MOCK_VAPID_PUBLIC_KEY'

export let activeScheduleId: number | null = mockSchedules.find((item) => item.state === 'IN_PROGRESS')?.id ?? null

export const nextTaskId = () => ++taskSeq
export const nextScheduleId = () => ++scheduleSeq

export const setActiveScheduleId = (id: number | null, nextState?: ScheduleState) => {
  activeScheduleId = id
  if (id == null || nextState == null) return
  mockSchedules.forEach((schedule) => {
    if (schedule.id === id) {
      schedule.state = nextState
    } else if (nextState === 'IN_PROGRESS' && schedule.state === 'IN_PROGRESS') {
      schedule.state = 'SUSPENDED'
    }
  })
}

export const makeToken = (userId: number, ttlMinutes = 60) => {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const payload = btoa(
    JSON.stringify({
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + ttlMinutes * 60,
    }),
  )
  return `${header}.${payload}.mock`
}
