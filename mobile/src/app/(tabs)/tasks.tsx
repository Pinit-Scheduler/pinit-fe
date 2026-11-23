import { useEffect, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TASK_PAGE_SIZE, fetchMyTasks, type TaskListStatus } from '@/api/tasks'
import { tasks as taskStore } from '@/data/entities'
import { useResource } from '@/data/resource'
import { useSpaceNames } from '@/data/spaces'
import { openWeb } from '@/lib/webNav'
import { Button, IconButton, InlineError, Note, ScreenHeader } from '@/ui/kit'
import { TaskRow } from '@/ui/TaskRow'
import { HIT, radius, space, useTheme } from '@/ui/theme'

const TASKS_ERROR = '작업을 불러오지 못했어요.'
const FILTERS: { value: TaskListStatus; label: string }[] = [
  { value: 'CURRENT', label: '진행 중' },
  { value: 'COMPLETED', label: '완료' },
]

/**
 * 작업: 모든 스페이스에서 내게 배정된 작업을 마감 빠른 순으로 보고 완료를 표시한다.
 * 검색·필터·정렬과 스페이스별 보기는 웹 화면에서 한다.
 */
export default function TasksScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const spaceName = useSpaceNames()
  // pages: 지금까지 펼친 쪽 수. 끝까지 내리면 한 쪽 늘린다.
  const [view, setView] = useState<{ status: TaskListStatus; pages: number }>({ status: 'CURRENT', pages: 1 })
  const query = useResource(
    `tasks/${view.status}`,
    (signal) => fetchMyTasks(view.status, view.pages, signal),
    TASKS_ERROR,
  )
  const { data, reload } = query
  useEffect(() => {
    if (data) taskStore.remember(data.items)
  }, [data])
  // 쪽 수를 늘리면 늘어난 만큼 다시 받는다. 첫 쪽은 화면에 들어올 때 이미 받는다.
  useEffect(() => {
    if (view.pages > 1) void reload()
  }, [view.pages, reload])

  const items = data?.items
  const loadingMore = query.fetching && !!items && view.pages * TASK_PAGE_SIZE > items.length && !data.last
  const showMore = () => {
    if (!data || data.last || query.fetching || data.items.length < view.pages * TASK_PAGE_SIZE) return
    setView((previous) => ({ ...previous, pages: previous.pages + 1 }))
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: space.xl }}
      data={items ?? []}
      keyExtractor={(task) => String(task.id)}
      renderItem={({ item }) => (
        <View style={{ backgroundColor: theme.surface }}>
          <TaskRow task={item} spaceName={spaceName(item.spaceId)} onOpen={(id) => openWeb(`/app/tasks/${id}`)} />
        </View>
      )}
      onEndReachedThreshold={0.4}
      onEndReached={showMore}
      refreshControl={<RefreshControl refreshing={false} tintColor={theme.muted} onRefresh={() => void reload()} />}
      ListHeaderComponent={
        <View>
          <ScreenHeader title="작업">
            <IconButton icon="search" label="검색·필터 (웹 화면)" onPress={() => openWeb('/app/tasks')} />
            <Button label="작업 추가" icon="plus" primary onPress={() => openWeb('/app/tasks/new')} />
          </ScreenHeader>
          <View accessibilityRole="tablist" style={[styles.filters, { backgroundColor: theme.meterTrack }]}>
            {FILTERS.map((filter) => {
              const selected = filter.value === view.status
              return (
                <Pressable
                  key={filter.value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setView({ status: filter.value, pages: 1 })}
                  style={[styles.filter, selected && { backgroundColor: theme.surface }]}>
                  <Text style={[styles.filterLabel, { color: selected ? theme.ink : theme.muted }]}>{filter.label}</Text>
                </Pressable>
              )
            })}
          </View>
          {query.error ? <InlineError message={query.error} onRetry={() => void reload()} /> : null}
          {query.loading ? <Note>작업을 불러오는 중…</Note> : null}
          {items && items.length === 0 ? (
            <Note>{view.status === 'CURRENT' ? '진행 중인 작업이 없어요. 새 작업을 추가해 보세요.' : '완료한 작업이 없어요.'}</Note>
          ) : null}
        </View>
      }
      ListFooterComponent={loadingMore ? <Note>더 불러오는 중…</Note> : undefined}
    />
  )
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', marginHorizontal: space.lg, marginBottom: space.md, padding: 3, borderRadius: radius.md },
  filter: { flex: 1, minHeight: HIT - 6, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  filterLabel: { fontSize: 14, fontWeight: '600' },
})
