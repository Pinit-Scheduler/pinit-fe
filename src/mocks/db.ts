import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { DateTimeWithZone, DateWithOffset } from '../shared/types/datetime'
import type { Task } from '../features/tasks/types/task'
import type { ScheduleResponse, ScheduleState } from '../features/schedules/types/schedule'
import type { OAuthAuthorizationRequest, OAuthGrant } from '../features/oauth/types/oauth'

dayjs.extend(utc)
dayjs.extend(timezone)

export type MockUser = {
  id: number
  username: string
  password: string
  nickname: string
  zoneOffset: string
}

const makeDateTime = (offsetDays: number, hour: number, minute = 0, zoneId = 'Asia/Seoul'): DateTimeWithZone => {
  const base = dayjs().tz(zoneId).add(offsetDays, 'day').hour(hour).minute(minute).second(0)
  return {
    dateTime: base.format('YYYY-MM-DDTHH:mm:ss'),
    zoneId,
  }
}

const makeDateWithOffset = (offsetDays: number, zoneId = 'Asia/Seoul'): DateWithOffset => {
  const base = dayjs().tz(zoneId).add(offsetDays, 'day').hour(0).minute(0).second(0)
  return {
    date: base.format('YYYY-MM-DD'),
    zoneId,
    offset: base.format('Z'),
  }
}

let taskSeq = 6
let scheduleSeq = 4

export const mockUsers: MockUser[] = [
  { id: 1, username: 'demo', password: 'demo1234', nickname: '데모 유저', zoneOffset: '+09:00' },
  { id: 2, username: 'pinit', password: 'pinit', nickname: 'Pinit 팀', zoneOffset: '+09:00' },
]

export const mockTasks: Task[] = [
  {
    id: 1,
    title: 'UI 리서치 정리',
    description: '다음 스프린트 준비용',
    dueDate: makeDateWithOffset(0, 'Asia/Seoul'),
    importance: 7,
    difficulty: 3,
    isCompleted: false,
    completed: false,
    inboundDependencyCount: 0,
  },
  {
    id: 2,
    title: '푸시 알림 세팅',
    description: '웹 푸시 키/토큰 확인',
    dueDate: makeDateWithOffset(1, 'Asia/Seoul'),
    importance: 6,
    difficulty: 2,
    isCompleted: false,
    completed: false,
    inboundDependencyCount: 1,
  },
  {
    id: 3,
    title: '통계 뷰 QA',
    description: '주간 통계 지표 검증',
    dueDate: makeDateWithOffset(-1, 'Asia/Seoul'),
    importance: 5,
    difficulty: 1,
    isCompleted: true,
    completed: true,
    inboundDependencyCount: 0,
  },
  // 하루 계획(/app/plan) 확인용 후보 작업
  {
    id: 4,
    title: '발표 자료 만들기',
    description: '다음 주 데모 슬라이드',
    dueDate: makeDateWithOffset(2, 'Asia/Seoul'),
    importance: 8,
    difficulty: 8,
    expectedDuration: 'PT1H30M',
    isCompleted: false,
    completed: false,
    inboundDependencyCount: 0,
  },
  {
    id: 5,
    title: '분기 보고서 초안',
    description: '지표 정리와 초안 작성',
    dueDate: makeDateWithOffset(0, 'Asia/Seoul'),
    importance: 6,
    difficulty: 13,
    expectedDuration: null,
    isCompleted: false,
    completed: false,
    inboundDependencyCount: 0,
  },
  {
    id: 6,
    title: '메일함 정리',
    description: '답장 밀린 메일 처리',
    dueDate: makeDateWithOffset(5, 'Asia/Seoul'),
    importance: 3,
    difficulty: 2,
    expectedDuration: 'PT20M',
    isCompleted: false,
    completed: false,
    inboundDependencyCount: 0,
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
    plannedDuration: 'PT1H',
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
    plannedDuration: 'PT45M',
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
    plannedDuration: 'PT30M',
  },
  {
    id: 4,
    ownerId: 1,
    title: '릴리즈 노트 정리',
    description:
      '1) 완료 항목 정리\n2) 담당자 피드백 반영\n3) 배포 공지 초안 작성\n4) FAQ 링크 추가',
    date: makeDateTime(0, 16, 30),
    scheduleType: 'ADMIN_TASK',
    state: 'NOT_STARTED',
    duration: '00:20:00',
    plannedDuration: 'PT30M',
  },
]

export const mockPushSubscriptions = new Map<string, Set<string>>()
export const vapidPublicKey = 'MOCK_VAPID_PUBLIC_KEY'

const daysFromNow = (days: number) => dayjs().add(days, 'day').toISOString()


export let activeScheduleId: number | null = mockSchedules.find((item) => item.state === 'IN_PROGRESS')?.id ?? null

export const nextTaskId = () => ++taskSeq
export const nextScheduleId = () => ++scheduleSeq

const minutesFromNow = (minutes: number) => dayjs().add(minutes, 'minute').toISOString()

// /oauth/consent?request=demo-local | demo-web | demo-delete | demo-read 로 동의 화면을 확인할 수 있다. 그 외 id는 404(만료)다.
export const mockOAuthAuthorizationRequests: Record<string, OAuthAuthorizationRequest & { redirectUri: string }> = {
  'demo-local': {
    requestId: 'demo-local',
    clientName: 'Claude Code',
    clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
    redirectHost: 'localhost:6274',
    localhostRedirect: true,
    requestedScopes: ['mcp:read', 'mcp:write'],
    expiresAt: minutesFromNow(10),
    redirectUri: 'http://localhost:6274/callback',
  },
  'demo-web': {
    requestId: 'demo-web',
    clientName: 'Claude',
    clientId: 'mock-dcr-client-7f3a',
    redirectHost: 'claude.ai',
    localhostRedirect: false,
    requestedScopes: ['mcp:read', 'mcp:write'],
    expiresAt: minutesFromNow(10),
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  },
  'demo-delete': {
    requestId: 'demo-delete',
    clientName: 'Claude',
    clientId: 'mock-dcr-client-7f3a',
    redirectHost: 'claude.ai',
    localhostRedirect: false,
    // ADR-0014 계약: 삭제는 requestedScopes가 아니라 optInScopes로 온다. demo-local 등은 optInScopes가 없는 이전 응답이다.
    requestedScopes: ['mcp:read', 'mcp:write'],
    optInScopes: ['mcp:delete'],
    expiresAt: minutesFromNow(10),
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  },
  'demo-read': {
    requestId: 'demo-read',
    clientName: 'Read Only Agent',
    clientId: 'mock-dcr-client-read',
    redirectHost: 'localhost:8976',
    localhostRedirect: true,
    requestedScopes: ['mcp:read'],
    expiresAt: minutesFromNow(10),
    redirectUri: 'http://localhost:8976/oauth/callback',
  },
}

export const mockOAuthGrants: OAuthGrant[] = [
  {
    grantId: 2,
    clientName: 'Claude',
    clientId: 'mock-dcr-client-7f3a',
    scopes: ['mcp:read', 'mcp:write', 'mcp:delete'],
    createdAt: daysFromNow(-5),
    lastUsedAt: daysFromNow(0),
    connectionCount: 2,
  },
  {
    grantId: 1,
    clientName: 'Claude Code',
    clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
    scopes: ['mcp:read'],
    createdAt: daysFromNow(-12),
    lastUsedAt: null,
    connectionCount: 1,
  },
]

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
