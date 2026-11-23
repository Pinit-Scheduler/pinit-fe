import type { BottomTabBarProps } from 'expo-router/js-tabs'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { openWeb } from '@/lib/webNav'
import { ActiveScheduleBar } from './ActiveScheduleBar'
import { Icon, type IconName } from './Icon'
import { radius, useTheme } from './theme'

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: '오늘', icon: 'sun' },
  schedules: { label: '일정', icon: 'calendar' },
  tasks: { label: '작업', icon: 'task' },
  more: { label: '더보기', icon: 'more' },
}

/**
 * 아래 탭 바. 가운데 + 버튼은 웹과 같이 작업 탭에서는 작업을, 그 밖에서는 일정을 추가한다.
 * 진행 중인 일정의 컨트롤 바가 그 위에 붙는다.
 */
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const active = state.routes[state.index]?.name
  const taskMode = active === 'tasks'
  const item = (name: string) => {
    const route = state.routes.find((candidate) => candidate.name === name)
    const tab = TABS[name]
    if (!route || !tab) return null
    const focused = active === name
    const color = focused ? theme.blue : theme.muted
    return (
      <Pressable
        key={name}
        accessibilityRole="tab"
        accessibilityLabel={tab.label}
        accessibilityState={{ selected: focused }}
        onPress={() => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          if (!focused && !event.defaultPrevented) navigateToTab(route.key)
        }}
        style={styles.item}>
        <Icon name={tab.icon} color={color} />
        <Text style={[styles.label, { color, fontWeight: focused ? '700' : '500' }]}>{tab.label}</Text>
      </Pressable>
    )
  }
  return (
    <View>
      <ActiveScheduleBar />
      <View
        accessibilityRole="tablist"
        style={[styles.bar, { backgroundColor: theme.surface, borderColor: theme.line, paddingBottom: insets.bottom }]}>
        {item('index')}
        {item('schedules')}
        <View style={styles.item}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={taskMode ? '작업 추가' : '일정 추가'}
            onPress={() => openWeb(taskMode ? '/app/tasks/new' : '/app/schedules/new')}
            style={({ pressed }) => [styles.add, { backgroundColor: theme.blue, opacity: pressed ? 0.8 : 1 }]}>
            <Icon name="plus" size={24} color={theme.onAccent} />
          </Pressable>
        </View>
        {item('tasks')}
        {item('more')}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  item: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 11 },
  add: { width: 46, height: 46, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
})
