import { useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { fetchMySchedules, fetchMyWeekSchedules } from '@/api/schedules'
import { schedules as scheduleStore } from '@/data/entities'
import { useResource } from '@/data/resource'
import { useSpaceNames } from '@/data/spaces'
import { useToday, useZoneId } from '@/data/zone'
import { addDaysToDateKey, dayOfMonth, formatMonthDay, weekDaysOf, weekdayLabel } from '@/lib/dateKey'
import { dateKeyOf, instantOf } from '@/lib/datetime'
import { openWeb } from '@/lib/webNav'
import { IconButton, InlineError, Note, Panel, ScreenHeader, TextLink } from '@/ui/kit'
import { ScheduleRow } from '@/ui/ScheduleRow'
import { HIT, radius, space, useTheme } from '@/ui/theme'

const SCHEDULES_ERROR = '일정을 불러오지 못했어요.'

/** 일정: 주간 날짜 띠에서 날짜를 골라 그날의 내 일정을 보고 상태를 바꾼다. 월간 달력과 시간 옮기기는 웹 화면에서 한다. */
export default function SchedulesScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const today = useToday()
  const zoneId = useZoneId()
  const spaceName = useSpaceNames()
  // 고른 날짜가 없으면 오늘을 본다. 자정이 지나면 오늘을 따라간다.
  const [picked, setPicked] = useState<string | null>(null)
  const selected = picked ?? today
  const week = weekDaysOf(selected)

  const dayQuery = useResource(
    `schedules/day/${selected}@${zoneId}`,
    (signal) => fetchMySchedules(selected, signal),
    SCHEDULES_ERROR,
  )
  // 주가 같으면 날짜를 바꿔도 다시 받지 않는다. 날짜 띠의 점(일정 있음)에 쓴다.
  const weekQuery = useResource(
    `schedules/week/${week[0]}@${zoneId}`,
    (signal) => fetchMyWeekSchedules(week[0], signal),
    SCHEDULES_ERROR,
  )
  const schedules = dayQuery.data
  useEffect(() => {
    if (schedules) scheduleStore.remember(schedules)
  }, [schedules])

  const busyDays = new Set(weekQuery.data?.map((schedule) => dateKeyOf(schedule.date)))
  const sorted = schedules && [...schedules].sort((a, b) => instantOf(a.date) - instantOf(b.date))
  const moveWeek = (weeks: number) => setPicked(addDaysToDateKey(selected, weeks * 7))

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: space.xl }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          tintColor={theme.muted}
          onRefresh={() => {
            void dayQuery.reload()
            void weekQuery.reload()
          }}
        />
      }>
      <ScreenHeader title="일정">
        <TextLink label="월간 달력" onPress={() => openWeb('/app/schedules')} />
      </ScreenHeader>

      <View style={[styles.week, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <View style={styles.weekHead}>
          <IconButton icon="back" label="이전 주" onPress={() => moveWeek(-1)} />
          <Text style={[styles.weekLabel, { color: theme.ink }]}>
            {formatMonthDay(week[0])} – {formatMonthDay(week[6])}
          </Text>
          <IconButton icon="forward" label="다음 주" onPress={() => moveWeek(1)} />
        </View>
        <View style={styles.days}>
          {week.map((dateKey) => {
            const isSelected = dateKey === selected
            const isToday = dateKey === today
            return (
              <Pressable
                key={dateKey}
                accessibilityRole="button"
                accessibilityLabel={`${formatMonthDay(dateKey)}${isToday ? ', 오늘' : ''}${busyDays.has(dateKey) ? ', 일정 있음' : ''}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => setPicked(dateKey)}
                style={[
                  styles.day,
                  {
                    backgroundColor: isSelected ? theme.blue : 'transparent',
                    borderColor: isToday && !isSelected ? theme.blue : 'transparent',
                  },
                ]}>
                <Text style={[styles.dayName, { color: isSelected ? theme.onAccent : theme.muted }]}>{weekdayLabel(dateKey)}</Text>
                <Text style={[styles.dayNumber, { color: isSelected ? theme.onAccent : theme.ink }]}>{dayOfMonth(dateKey)}</Text>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: busyDays.has(dateKey) ? (isSelected ? theme.onAccent : theme.blue) : 'transparent' },
                  ]}
                />
              </Pressable>
            )
          })}
        </View>
      </View>

      <Panel
        title={formatMonthDay(selected)}
        trailing={
          selected === today ? (
            <TextLink label="일정 추가" onPress={() => openWeb(`/app/schedules/new?date=${selected}`)} />
          ) : (
            <View style={styles.panelLinks}>
              <TextLink label="오늘" onPress={() => setPicked(null)} />
              <TextLink label="일정 추가" onPress={() => openWeb(`/app/schedules/new?date=${selected}`)} />
            </View>
          )
        }>
        {dayQuery.error ? <InlineError message={dayQuery.error} onRetry={() => void dayQuery.reload()} /> : null}
        {sorted ? (
          sorted.length ? (
            sorted.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                spaceName={spaceName(schedule.spaceId)}
                onOpen={(id) => openWeb(`/app/schedules/${id}`)}
              />
            ))
          ) : (
            <Note>이 날은 일정이 없어요.</Note>
          )
        ) : dayQuery.loading ? (
          <Note>일정을 불러오는 중…</Note>
        ) : null}
      </Panel>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  week: { marginHorizontal: space.lg, marginBottom: space.lg, borderRadius: radius.lg, borderWidth: 1, padding: space.sm },
  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekLabel: { fontSize: 15, fontWeight: '600' },
  days: { flexDirection: 'row', gap: 4, marginTop: space.xs },
  day: { flex: 1, minHeight: HIT + 20, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: radius.md, borderWidth: 1 },
  dayName: { fontSize: 12 },
  dayNumber: { fontSize: 16, fontWeight: '700' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  panelLinks: { flexDirection: 'row', gap: space.lg },
})
