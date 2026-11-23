import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'

import { Icon, type IconName } from './Icon'
import { HIT, radius, space, useTheme } from './theme'

/** 화면 맨 위의 제목 줄. 오른쪽에 그 화면의 주된 동작을 둔다. */
export function ScreenHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: theme.muted }]}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>
          {title}
        </Text>
      </View>
      {children ? <View style={styles.headerActions}>{children}</View> : null}
    </View>
  )
}

export function Button({
  label,
  icon,
  onPress,
  primary = false,
  disabled = false,
  busy = false,
  style,
}: {
  label: string
  icon?: IconName
  onPress: () => void
  primary?: boolean
  disabled?: boolean
  busy?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  const ink = primary ? theme.onAccent : theme.ink
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? theme.blue : theme.surface,
          borderColor: primary ? theme.blue : theme.controlLine,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}>
      {busy ? <ActivityIndicator size="small" color={ink} /> : icon ? <Icon name={icon} size={18} color={ink} /> : null}
      <Text style={[styles.buttonLabel, { color: ink }]}>{label}</Text>
    </Pressable>
  )
}

/** 아이콘만 있는 버튼. 화면 낭독기가 읽을 이름을 꼭 준다. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  color,
}: {
  icon: IconName
  label: string
  onPress: () => void
  disabled?: boolean
  color?: string
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Icon name={icon} color={color ?? theme.ink} />
    </Pressable>
  )
}

/** 흰 판. 웹의 workspace-panel과 같다. */
export function Panel({ title, trailing, children }: { title: string; trailing?: ReactNode; children: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <View style={styles.panelHead}>
        <Text accessibilityRole="header" style={[styles.panelTitle, { color: theme.ink }]}>
          {title}
        </Text>
        {trailing}
      </View>
      {children}
    </View>
  )
}

export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable accessibilityRole="link" hitSlop={10} onPress={onPress}>
      {({ pressed }) => <Text style={[styles.link, { color: theme.blue, opacity: pressed ? 0.6 : 1 }]}>{label}</Text>}
    </Pressable>
  )
}

export function Note({ children }: { children: string }) {
  const theme = useTheme()
  return <Text style={[styles.note, { color: theme.muted }]}>{children}</Text>
}

/** 불러오지 못했을 때. 무엇이 안 됐는지와 다시 시도 버튼을 함께 보여 준다. */
export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme()
  return (
    <View
      accessibilityRole="alert"
      style={[styles.error, { backgroundColor: theme.errorBg, borderColor: theme.errorLine }]}>
      <Text style={[styles.errorText, { color: theme.errorInk }]}>{message}</Text>
      <Pressable accessibilityRole="button" hitSlop={10} onPress={onRetry}>
        <Text style={[styles.errorRetry, { color: theme.errorInk }]}>다시 시도</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  headerCopy: { flexShrink: 1, gap: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  eyebrow: { fontSize: 13 },
  title: { fontSize: 24, fontWeight: '700' },
  button: {
    minHeight: HIT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  buttonLabel: { fontSize: 15, fontWeight: '600' },
  iconButton: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  panel: { marginHorizontal: space.lg, marginBottom: space.lg, borderRadius: radius.lg, borderWidth: 1, paddingBottom: space.sm },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  panelTitle: { fontSize: 17, fontWeight: '700' },
  link: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 14, lineHeight: 21, paddingHorizontal: space.lg, paddingVertical: space.md },
  error: {
    marginHorizontal: space.lg,
    marginVertical: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  errorRetry: { fontSize: 14, fontWeight: '700' },
})
