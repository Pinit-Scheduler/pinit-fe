import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import type { ColorValue, StyleProp, ViewStyle } from 'react-native'

type Name = Extract<SymbolViewProps['name'], object>

// iOS는 SF Symbols, Android는 Material Symbols를 쓴다. 화면은 이 이름만 안다.
const ICONS = {
  sun: { ios: 'sun.max', android: 'sunny', web: 'sunny' },
  calendar: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  task: { ios: 'checkmark.square', android: 'task_alt', web: 'task_alt' },
  more: { ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  play: { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' },
  pause: { ios: 'pause.fill', android: 'pause', web: 'pause' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  square: { ios: 'square', android: 'crop_square', web: 'crop_square' },
  back: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  forward: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  repeat: { ios: 'repeat', android: 'repeat', web: 'repeat' },
  map: { ios: 'point.3.connected.trianglepath.dotted', android: 'account_tree', web: 'account_tree' },
  chart: { ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' },
  mindMap: { ios: 'circle.hexagongrid', android: 'hub', web: 'hub' },
  spaces: { ios: 'person.2', android: 'group', web: 'group' },
  risk: { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  split: { ios: 'arrow.triangle.branch', android: 'call_split', web: 'call_split' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' },
} satisfies Record<string, Name>

export type IconName = keyof typeof ICONS

export function Icon({
  name,
  size = 22,
  color,
  style,
}: {
  name: IconName
  size?: number
  color: ColorValue
  style?: StyleProp<ViewStyle>
}) {
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} style={style} />
}
