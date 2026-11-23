import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import type { Schedule, ScheduleState } from '@/api/types'
import { runScheduleAction, usePendingChanges } from '@/data/actions'
import { schedules } from '@/data/entities'
import { formatTime } from '@/lib/datetime'
import { formatIsoDurationLabel } from '@/lib/isoDuration'
import { STATE_LABEL, TYPE_LABEL, canQuickComplete, cardTapAction } from '@/lib/schedule'
import { Icon, type IconName } from './Icon'
import { HIT, radius, space, useTheme, type Theme } from './theme'

const STATE_ICON: Record<ScheduleState, IconName> = {
  NOT_STARTED: 'square',
  IN_PROGRESS: 'play',
  COMPLETED: 'check',
  SUSPENDED: 'pause',
}

export const stateColor = (theme: Theme, state: ScheduleState) =>
  state === 'IN_PROGRESS' ? theme.running : state === 'SUSPENDED' ? theme.suspended : state === 'COMPLETED' ? theme.done : theme.muted

const TAP_LABEL: Record<ScheduleState, string> = {
  NOT_STARTED: '시작',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료 취소',
  SUSPENDED: '일시정지',
}

/**
 * 일정 한 줄. 웹 ScheduleCard와 같은 동작이다.
 * 왼쪽 상태 버튼: 미시작이면 시작, 완료면 미시작으로 되돌리기. 오른쪽: 미시작 일정의 즉시 완료.
 * 진행중·일시정지 일정의 일시정지·완료·취소는 화면 아래 컨트롤 바에서 한다.
 */
export function ScheduleRow({
  schedule: received,
  spaceName,
  onOpen,
}: {
  schedule: Schedule
  /** 개인 스페이스가 아닐 때만 넘긴다. */
  spaceName?: string | null
  onOpen: (id: number) => void
}) {
  const theme = useTheme()
  const schedule = schedules.useLatest(received)
  const pending = usePendingChanges().schedule
  const saving = pending?.id === schedule.id
  // 저장하는 동안에는 바뀔 상태를 먼저 보여 준다.
  const state = saving ? pending.target : schedule.state
  const done = state === 'COMPLETED'
  const tapAction = saving ? null : cardTapAction(schedule.state, schedule.allowedActions)
  const quickComplete = !saving && canQuickComplete(schedule.state, schedule.allowedActions)
  const meta = [
    schedule.scheduleType ? TYPE_LABEL[schedule.scheduleType] : null,
    formatIsoDurationLabel(schedule.plannedDuration),
    spaceName,
  ].filter(Boolean)

  return (
    <View style={[styles.row, { borderColor: theme.line }]}>
      <Text style={[styles.time, { color: done ? theme.completed : theme.muted }]}>{formatTime(schedule.date)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${schedule.title}, ${STATE_LABEL[state]} 상태${tapAction ? `, 누르면 ${TAP_LABEL[schedule.state]}` : ''}`}
        accessibilityState={{ disabled: !tapAction, busy: saving }}
        disabled={!tapAction}
        hitSlop={8}
        onPress={() => tapAction && void runScheduleAction(schedule, tapAction)}
        style={[styles.state, { borderColor: tapAction ? theme.controlLine : 'transparent' }]}>
        {saving ? (
          <ActivityIndicator size="small" color={stateColor(theme, state)} />
        ) : (
          <Icon name={STATE_ICON[state]} size={20} color={stateColor(theme, state)} />
        )}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityHint="일정 상세를 엽니다" onPress={() => onOpen(schedule.id)} style={styles.copy}>
        <Text style={[styles.status, { color: stateColor(theme, state) }]}>{STATE_LABEL[state]}</Text>
        <Text
          style={[
            styles.title,
            { color: done ? theme.completed : theme.ink, textDecorationLine: done ? 'line-through' : 'none' },
          ]}>
          {schedule.title}
        </Text>
        {meta.length || schedule.recurring ? (
          <View style={styles.meta}>
            {schedule.recurring ? (
              <View style={[styles.badge, { backgroundColor: theme.blueSoft }]}>
                <Icon name="repeat" size={12} color={theme.blue} />
                <Text style={[styles.badgeText, { color: theme.blue }]}>반복</Text>
              </View>
            ) : null}
            {meta.length ? <Text style={[styles.metaText, { color: theme.muted }]}>{meta.join(' · ')}</Text> : null}
          </View>
        ) : null}
      </Pressable>
      {quickComplete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${schedule.title} 즉시 완료`}
          onPress={() => void runScheduleAction(schedule, 'COMPLETE')}
          style={({ pressed }) => [styles.quick, { borderColor: theme.controlLine, opacity: pressed ? 0.6 : 1 }]}>
          <Icon name="check" size={16} color={theme.ink} />
          <Text style={[styles.quickText, { color: theme.ink }]}>즉시 완료</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  time: { width: 44, paddingTop: 10, fontSize: 13, fontVariant: ['tabular-nums'] },
  state: {
    width: HIT,
    height: HIT,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minHeight: HIT, justifyContent: 'center', gap: 2 },
  status: { fontSize: 12, fontWeight: '600' },
  title: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 2 },
  metaText: { fontSize: 13 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  badgeText: { fontSize: 12, fontWeight: '600' },
  quick: {
    minHeight: HIT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  quickText: { fontSize: 13, fontWeight: '600' },
})
