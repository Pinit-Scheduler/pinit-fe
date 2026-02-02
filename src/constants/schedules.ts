import type { ScheduleSummary } from '@features/schedules/types/schedule'

export const scheduleTypeLabel: Record<NonNullable<ScheduleSummary['scheduleType']>, string> = {
    DEEP_WORK: '집중 작업',
    QUICK_TASK: '빠른 일정',
    ADMIN_TASK: '행정 작업',
}

export const scheduleTypeLabelCompressed: Record<NonNullable<ScheduleSummary['scheduleType']>, string> = {
    DEEP_WORK: '집중',
    QUICK_TASK: '간단',
    ADMIN_TASK: '행정',
}

export const stateLabel: Record<ScheduleSummary['state'], string> = {
    NOT_STARTED: '미시작',
    IN_PROGRESS: '진행중',
    COMPLETED: '완료',
    SUSPENDED: '일시정지',
}

export const stateIcon: Record<ScheduleSummary['state'], string> = {
    NOT_STARTED: '☐',  // 빈 박스
    IN_PROGRESS: '▶',  // >>
    COMPLETED: '✓',     // 체크
    SUSPENDED: '⏸',     // 일시정지
}
