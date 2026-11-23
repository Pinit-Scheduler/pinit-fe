import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { fetchActiveScheduleId } from '@/api/member'
import { fetchSchedule } from '@/api/schedules'
import type { Schedule, ScheduleAction } from '@/api/types'
import { runScheduleAction, usePendingChanges } from '@/data/actions'
import { schedules } from '@/data/entities'
import { useResource } from '@/data/resource'
import { STATE_LABEL, isActiveState, isAllowed } from '@/lib/schedule'
import { openWeb } from '@/lib/webNav'
import { Icon, type IconName } from './Icon'
import { stateColor } from './ScheduleRow'
import { HIT, radius, space, useTheme, type Theme } from './theme'

const loadActive = async (signal: AbortSignal) => {
  const id = await fetchActiveScheduleId()
  return id ? await fetchSchedule(id, signal) : null
}

/**
 * 진행중이거나 일시정지한 내 일정을 탭 바 위에 보여 주고, 일시정지·재개·완료·취소를 바로 할 수 있게 한다.
 * 웹의 MiniPlayerBar와 같다. 서버가 알려 준 활성 일정만 다룬다.
 */
export function ActiveScheduleBar() {
  const theme = useTheme()
  const { data } = useResource('active-schedule', loadActive, '진행 중인 일정을 불러오지 못했어요.')
  useEffect(() => {
    if (data) schedules.remember(data)
  }, [data])
  const pending = usePendingChanges().schedule
  if (!data) return null
  return <Bar key={data.id} received={data} pending={pending} theme={theme} />
}

function Bar({
  received,
  pending,
  theme,
}: {
  received: Schedule
  pending: ReturnType<typeof usePendingChanges>['schedule']
  theme: Theme
}) {
  const schedule = schedules.useLatest(received)
  const saving = pending?.id === schedule.id
  const state = saving ? pending.target : schedule.state
  if (!isActiveState(state)) return null
  const running = state === 'IN_PROGRESS'
  const ink = stateColor(theme, state)
  const control = (action: ScheduleAction, icon: IconName, label: string, primary = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // 저장하는 동안에는 저장 전 상태의 권한이 남아 있다. 그동안은 막지 않고 잠금이 누름을 무시한다.
      accessibilityState={{ disabled: !saving && !isAllowed(schedule.allowedActions, action) }}
      disabled={!saving && !isAllowed(schedule.allowedActions, action)}
      onPress={() => void runScheduleAction(schedule, action)}
      style={({ pressed }) => [
        styles.control,
        {
          backgroundColor: primary ? theme.blue : theme.surface,
          borderColor: primary ? theme.blue : theme.controlLine,
          opacity: !saving && !isAllowed(schedule.allowedActions, action) ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}>
      <Icon name={icon} size={20} color={primary ? theme.onAccent : theme.ink} />
    </Pressable>
  )
  return (
    <View
      accessibilityLabel="일정 컨트롤 바"
      style={[
        styles.bar,
        { backgroundColor: theme.surface, borderColor: theme.line, borderLeftColor: ink, shadowColor: theme.shadow },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${schedule.title}, ${STATE_LABEL[state]}, 상세 보기`}
        onPress={() => openWeb(`/app/schedules/${schedule.id}`)}
        style={styles.summary}>
        <Icon name={running ? 'play' : 'pause'} size={22} color={ink} />
        <View style={styles.copy}>
          <Text numberOfLines={1} style={[styles.title, { color: theme.ink }]}>
            {schedule.title}
          </Text>
          <Text style={[styles.state, { color: ink }]}>{STATE_LABEL[state]}</Text>
        </View>
      </Pressable>
      <View accessibilityLabel="일정 조작" style={styles.controls}>
        {running ? control('SUSPEND', 'pause', '일시정지', true) : control('START', 'play', '재개', true)}
        {control('COMPLETE', 'check', '완료')}
        {control('CANCEL', 'close', '취소하고 미시작으로')}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: space.md,
    marginBottom: space.sm,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderLeftWidth: 3,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  summary: { flex: 1, minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: space.md },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600' },
  state: { fontSize: 13 },
  controls: { flexDirection: 'row', gap: space.sm },
  control: { width: HIT, height: HIT, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
})
