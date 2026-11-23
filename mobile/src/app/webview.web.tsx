import { router, useLocalSearchParams } from 'expo-router'
import { Linking, StyleSheet, Text, View } from 'react-native'

import { safeWebPath } from '@/bridge/protocol'
import { WEB_ORIGIN } from '@/config'
import { Button } from '@/ui/kit'
import { space, useTheme } from '@/ui/theme'

/**
 * 브라우저에서 돌리는 개발용 미리보기에는 WebView가 없다. 어떤 웹 화면이 열릴 자리인지만 보여 준다.
 * 실제 앱(iOS·Android)은 webview.tsx를 쓴다.
 */
export default function WebScreenPreview() {
  const params = useLocalSearchParams<{ path?: string }>()
  const path = safeWebPath(params.path)
  const theme = useTheme()
  return (
    <View style={[styles.fill, { backgroundColor: theme.bg }]}>
      <Text style={[styles.title, { color: theme.ink }]}>앱에서는 이 자리에 웹 화면이 열려요.</Text>
      <Text style={[styles.path, { color: theme.muted }]}>{WEB_ORIGIN + path}</Text>
      <View style={styles.actions}>
        <Button label="닫기" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Button label="새 탭에서 열기" primary onPress={() => void Linking.openURL(WEB_ORIGIN + path)} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  path: { fontSize: 13, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.md },
})
