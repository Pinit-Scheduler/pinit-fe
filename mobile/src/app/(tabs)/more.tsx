import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getRequestFailureMessage } from '@/api/errors'
import { openWeb } from '@/lib/webNav'
import { signOut } from '@/session/store'
import { Icon, type IconName } from '@/ui/Icon'
import { ScreenHeader } from '@/ui/kit'
import { HIT, radius, space, useTheme } from '@/ui/theme'
import { showToast } from '@/ui/toast'

const LINKS: { label: string; icon: IconName; path: string }[] = [
  { label: '하루 계획', icon: 'sun', path: '/app/plan' },
  { label: '마감 위험 예보', icon: 'risk', path: '/app/deadline-risk' },
  { label: '작업 맵', icon: 'map', path: '/app/task-map' },
  { label: '통계', icon: 'chart', path: '/app/statistics' },
  { label: '마인드맵', icon: 'mindMap', path: '/app/mind-map' },
  { label: '스페이스', icon: 'spaces', path: '/app/spaces' },
  { label: '쪼개기 보관함', icon: 'split', path: '/app/tasks/splits' },
  { label: '설정', icon: 'settings', path: '/app/settings' },
]

/** 더보기: 앱이 직접 그리지 않는 화면으로 가는 목록. 누르면 웹 화면이 열린다. */
export default function MoreScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [loggingOut, setLoggingOut] = useState(false)

  const logout = async () => {
    setLoggingOut(true)
    try {
      await signOut()
    } catch (error) {
      showToast(getRequestFailureMessage(error, '로그아웃하지 못했어요.'), 'error')
      setLoggingOut(false)
    }
  }

  const row = (label: string, icon: IconName, onPress: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderColor: theme.line, opacity: disabled ? 0.5 : pressed ? 0.6 : 1 }]}>
      <Icon name={icon} color={theme.muted} />
      <Text style={[styles.label, { color: theme.ink }]}>{label}</Text>
      <Icon name="forward" size={18} color={theme.controlLine} />
    </Pressable>
  )

  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: space.xl }}>
      <ScreenHeader title="더보기" />
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        {LINKS.map((link) => row(link.label, link.icon, () => openWeb(link.path)))}
      </View>
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        {row(loggingOut ? '로그아웃하는 중…' : '로그아웃', 'logout', () => void logout(), loggingOut)}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  group: { marginHorizontal: space.lg, marginBottom: space.lg, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: {
    minHeight: HIT + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1, fontSize: 16 },
})
