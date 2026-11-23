import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { Task } from '@/api/types'
import { toggleTaskCompletion, usePendingChanges } from '@/data/actions'
import { tasks } from '@/data/entities'
import { formatDueLabel } from '@/lib/dateKey'
import { formatIsoDurationLabel } from '@/lib/isoDuration'
import { Icon } from './Icon'
import { HIT, space, useTheme } from './theme'

/** 값이 최댓값에 가까울수록 아래에서부터 차오르는 동그라미. 웹의 workspace-meter와 같은 정보다. */
function Meter({ value, max, label, fill }: { value: number; max: number; label: string; fill: string }) {
  const theme = useTheme()
  const ratio = Math.max(0, Math.min(1, value / max))
  return (
    <View accessibilityLabel={`${label} ${value} / ${max}`} style={[styles.meter, { backgroundColor: theme.meterTrack }]}>
      <View style={[styles.meterFill, { backgroundColor: fill, height: `${ratio * 100}%` }]} />
      <Text style={[styles.meterText, { color: theme.meterInk }]}>{value}</Text>
    </View>
  )
}

/** 작업 한 줄. 왼쪽 동그라미로 완료·완료 취소, 제목을 누르면 상세. 웹 WorkspaceTaskCard와 같은 동작이다. */
export function TaskRow({
  task: received,
  spaceName,
  onOpen,
}: {
  task: Task
  /** 개인 스페이스가 아닐 때만 넘긴다. */
  spaceName?: string | null
  onOpen: (id: number) => void
}) {
  const theme = useTheme()
  const task = tasks.useLatest(received)
  const pendingDone = usePendingChanges().tasks[task.id]
  const done = pendingDone ?? task.completed
  const allowed = task.completed ? task.allowedActions.reopen === true : task.allowedActions.complete === true
  const meta = [
    spaceName,
    task.recurring ? '반복' : null,
    !done && task.inboundDependencyCount > 0 ? `이전 작업 ${task.inboundDependencyCount}개 남음` : null,
    `예상 ${formatIsoDurationLabel(task.effectiveExpectedDuration) ?? '시간 미입력'}`,
  ].filter(Boolean)

  return (
    <View style={[styles.row, { borderColor: theme.line }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${task.title} ${done ? '완료 취소' : '완료'}`}
        accessibilityState={{ checked: done, disabled: !allowed }}
        disabled={!allowed}
        hitSlop={8}
        onPress={() => void toggleTaskCompletion(task)}
        style={styles.checkHit}>
        <View
          style={[
            styles.check,
            {
              borderColor: done ? theme.blue : theme.controlLine,
              backgroundColor: done ? theme.blue : 'transparent',
              opacity: allowed ? 1 : 0.45,
            },
          ]}>
          {done ? <Icon name="check" size={16} color={theme.onAccent} /> : null}
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityHint="작업 상세를 엽니다" onPress={() => onOpen(task.id)} style={styles.copy}>
        <Text
          style={[
            styles.title,
            { color: done ? theme.completed : theme.ink, textDecorationLine: done ? 'line-through' : 'none' },
          ]}>
          {task.title}
        </Text>
        <Text style={[styles.meta, { color: done ? theme.completed : theme.muted }]}>{meta.join(' · ')}</Text>
      </Pressable>
      <View style={styles.side}>
        <Text style={[styles.due, { color: done ? theme.completed : theme.muted }]}>
          {done ? '완료' : `${formatDueLabel(task.dueDate.date)} 마감`}
        </Text>
        <View style={styles.meters}>
          <Meter value={task.importance} max={9} label="중요도" fill={theme.meterBlue} />
          <Meter value={task.difficulty} max={21} label="난이도" fill={theme.meterPink} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  checkHit: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minHeight: HIT, justifyContent: 'center', gap: 4 },
  title: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  meta: { fontSize: 13, lineHeight: 19 },
  side: { alignItems: 'flex-end', gap: space.sm, paddingTop: 2 },
  due: { fontSize: 13 },
  meters: { flexDirection: 'row', gap: 6 },
  meter: { width: 30, height: 30, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  meterFill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  meterText: { fontSize: 13, fontWeight: '700' },
})
