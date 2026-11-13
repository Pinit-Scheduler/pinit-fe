import { useCallback } from 'react'
import { useToast } from '@contexts/ToastContext'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import {
  dispatchScheduleChanged,
  dispatchTaskChanged,
} from '@shared/utils/events'
import { restoreSchedule, restoreTask } from '../api/trash'
import { restoreTaskMessage } from '../utils/trashLabels'

const TRASH_RETRY = '설정 → 휴지통에서'

/** 되돌리기 버튼을 누를 시간. 일반 토스트(3초)보다 길다(ADR-0024 §13). */
export const UNDO_TOAST_MS = 6000

/**
 * 삭제 직후 "휴지통으로 옮겼어요 · 되돌리기" 토스트를 띄운다. 되돌리면 목록과 캘린더가 다시 읽도록 변경 이벤트를 보낸다.
 */
export const useTrashUndo = () => {
  const { addToast } = useToast()

  const offerTaskUndo = useCallback(
    (taskId: number, onRestored?: () => void) => {
      addToast('작업을 휴지통으로 옮겼어요.', 'success', {
        durationMs: UNDO_TOAST_MS,
        action: {
          label: '되돌리기',
          onAction: () => {
            restoreTask(taskId)
              .then((result) => {
                dispatchTaskChanged(taskId, 'restore')
                dispatchScheduleChanged({ reason: 'restore' })
                onRestored?.()
                addToast(
                  result
                    ? restoreTaskMessage(result.skippedDependencies)
                    : '작업을 복구했어요.',
                  'success',
                )
              })
              .catch((error) => {
                console.error('작업 되돌리기 실패', error)
                addToast(
                  getRequestFailureMessage(
                    error,
                    '작업을 되돌리지 못했어요.',
                    { retryFrom: TRASH_RETRY },
                  ),
                  'error',
                )
              })
          },
        },
      })
    },
    [addToast],
  )

  const offerScheduleUndo = useCallback(
    (scheduleId: number, onRestored?: () => void) => {
      addToast('일정을 휴지통으로 옮겼어요.', 'success', {
        durationMs: UNDO_TOAST_MS,
        action: {
          label: '되돌리기',
          onAction: () => {
            restoreSchedule(scheduleId)
              .then(() => {
                dispatchScheduleChanged({ reason: 'restore', scheduleId })
                dispatchTaskChanged({ reason: 'restore' })
                onRestored?.()
                addToast('일정을 되돌렸어요.', 'success')
              })
              .catch((error) => {
                console.error('일정 되돌리기 실패', error)
                addToast(
                  getRequestFailureMessage(
                    error,
                    '일정을 되돌리지 못했어요.',
                    { retryFrom: TRASH_RETRY },
                  ),
                  'error',
                )
              })
          },
        },
      })
    },
    [addToast],
  )

  return { offerTaskUndo, offerScheduleUndo }
}
