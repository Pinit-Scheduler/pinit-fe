import { Stack } from 'expo-router/stack'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { clearEntities } from '@/data/entities'
import { clearResources } from '@/data/resource'
import { bootSession, useSession } from '@/session/store'
import { useTheme } from '@/ui/theme'
import { ToastHost } from '@/ui/toast'

// 저장된 로그인을 읽을 때까지 시작 화면을 유지한다. 로그인 화면이 잠깐 비쳤다 사라지지 않게 한다.
void SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const { status } = useSession()
  const theme = useTheme()

  useEffect(() => {
    void bootSession()
  }, [])

  useEffect(() => {
    if (status === 'loading') return
    void SplashScreen.hideAsync()
    // 로그아웃하면 앞 회원의 응답을 버린다. 다음 회원에게 보이면 안 된다.
    if (status === 'signedOut') {
      clearResources()
      clearEntities()
    }
  }, [status])

  if (status === 'loading') return null
  const signedIn = status === 'signedIn'

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        {/* 가입·비밀번호 찾기처럼 로그인 전에 여는 웹 화면도 있어 로그인 여부로 막지 않는다. */}
        <Stack.Screen name="webview" />
      </Stack>
      <ToastHost />
    </SafeAreaProvider>
  )
}
