import { useEffect } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { fetchMySchedules } from '@/api/schedules'
import { fetchMyReadyTasks, fetchMyTasksDueOn } from '@/api/tasks'
import type { Task } from '@/api/types'
import { schedules as scheduleStore, tasks as taskStore } from '@/data/entities'
import { useResource } from '@/data/resource'
import { useSpaceNames } from '@/data/spaces'
import { useToday, useZoneId } from '@/data/zone'
import { formatFullDate, formatMonthDay } from '@/lib/dateKey'
import { instantOf } from '@/lib/datetime'
import { openWeb } from '@/lib/webNav'
import { Button, InlineError, Note, Panel, ScreenHeader, TextLink } from '@/ui/kit'
import { ScheduleRow } from '@/ui/ScheduleRow'
import { TaskRow } from '@/ui/TaskRow'
import { space, useTheme } from '@/ui/theme'

const TASKS_ERROR = '작업을 불러오지 못했어요.'
const SCHEDULES_ERROR = '일정을 불러오지 못했어요.'

/** 오늘: 모든 스페이스에서 내게 배정된 오늘 일정, 오늘 마감 작업, 바로 시작할 수 있는 작업. 웹 '오늘' 화면과 같은 조회다. */
export default function TodayScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const today = useToday()
  const zoneId = useZoneId()
  const spaceName = useSpaceNames()
  const dayKey = `${today}@${zoneId}`

  const scheduleQuery = useResource(
    `today/schedules/${dayKey}`,
    (signal) => fetchMySchedules(today, signal),
    SCHEDULES_ERROR,
  )
  const taskQuery = useResource(
    `today/tasks/${dayKey}`,
    async (signal) => {
      const [due, ready] = await Promise.all([fetchMyTasksDueOn(today, signal), fetchMyReadyTasks(signal)])
      return { due, ready }
    },
    TASKS_ERROR,
  )
  const schedules = scheduleQuery.data
  const tasks = taskQuery.data
  useEffect(() => {
    if (schedules) scheduleStore.remember(schedules)
  }, [schedules])
  useEffect(() => {
    if (tasks) taskStore.remember([...tasks.due, ...tasks.ready])
  }, [tasks])

  const sorted = schedules && [...schedules].sort((a, b) => instantOf(a.date) - instantOf(b.date))
  const openTask = (id: number) => openWeb(`/app/tasks/${id}`)
  const taskRows = (rows: Task[], empty: string) =>
    rows.length ? (
      rows.map((task) => <TaskRow key={task.id} task={task} spaceName={spaceName(task.spaceId)} onOpen={openTask} />)
    ) : (
      <Note>{empty}</Note>
    )

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: space.xl }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          tintColor={theme.muted}
          onRefresh={() => {
            void scheduleQuery.reload()
            void taskQuery.reload()
          }}
        />
      }>
      <ScreenHeader eyebrow={formatFullDate(today)} title="오늘의 내 작업">
        <Button label="하루 계획" icon="sun" onPress={() => openWeb('/app/plan')} />
      </ScreenHeader>

      <Panel
        title="오늘의 일정"
        trailing={<TextLink label="달력 보기" onPress={() => openWeb('/app/schedules')} />}>
        <Text style={[styles.date, { color: theme.muted }]}>
          {formatMonthDay(today)}
          {sorted ? ` · ${sorted.length}개` : ''}
        </Text>
        {scheduleQuery.error ? <InlineError message={scheduleQuery.error} onRetry={() => void scheduleQuery.reload()} /> : null}
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
            <Note>오늘 일정이 없어요. 새로운 일정을 추가해 보세요.</Note>
          )
        ) : scheduleQuery.loading ? (
          <Note>일정을 불러오는 중…</Note>
        ) : null}
      </Panel>

      <Panel title="오늘의 작업" trailing={<TextLink label="작업 추가" onPress={() => openWeb('/app/tasks/new?from=today')} />}>
        {taskQuery.error ? <InlineError message={taskQuery.error} onRetry={() => void taskQuery.reload()} /> : null}
        {tasks ? (
          <View>
            <Text style={[styles.section, { color: theme.ink }]}>오늘 마감 {tasks.due.length}</Text>
            {taskRows(tasks.due, '오늘 마감인 작업이 없어요.')}
            <Text style={[styles.section, { color: theme.ink }]}>바로 시작할 수 있는 작업</Text>
            {taskRows(tasks.ready, '바로 시작할 수 있는 작업이 없어요.')}
          </View>
        ) : taskQuery.loading ? (
          <Note>작업을 불러오는 중…</Note>
        ) : null}
      </Panel>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  date: { fontSize: 13, paddingHorizontal: space.lg, paddingBottom: space.sm },
  section: { fontSize: 14, fontWeight: '700', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
})
