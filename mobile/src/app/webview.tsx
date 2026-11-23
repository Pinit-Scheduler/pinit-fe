import { router, useLocalSearchParams } from 'expo-router'
import { Stack } from 'expo-router/stack'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Linking, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { getRequestFailureMessage } from '@/api/errors'
import { isSameOrigin, nativeTargetOf, parseWebMessage, safeWebPath, type RefreshReply } from '@/bridge/protocol'
import { bootScript, refreshReplyScript } from '@/bridge/scripts'
import { APP_USER_AGENT, WEB_ORIGIN } from '@/config'
import { endSession, getAccessToken, getSession, refreshSession, signOut, useSession } from '@/session/store'
import { Button } from '@/ui/kit'
import { space, useTheme } from '@/ui/theme'
import { showToast } from '@/ui/toast'

// react-native-webview의 타입은 추가 props의 기본값이 undefined라, 그대로 쓰면 props 전체가 never가 된다.
type AppWebView = WebView<object>

/**
 * 깊은 화면: 웹 앱을 그대로 보여 준다. 웹은 User-Agent로 앱 안인 것을 알고 아래 탭을 숨기며,
 * 화면을 닫거나 로그인 상태가 바뀔 때 메시지로 알린다(src/bridge/protocol.ts).
 */
export default function WebScreen() {
  const params = useLocalSearchParams<{ path?: string }>()
  const path = safeWebPath(params.path)
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { status } = useSession()
  const webRef = useRef<AppWebView>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [failed, setFailed] = useState(false)
  // 다시 시도하거나 렌더 프로세스가 죽으면 WebView를 새로 만든다.
  const [attempt, setAttempt] = useState(0)
  // 여는 순간의 로그인 상태와 토큰. 이후의 갱신은 웹이 메시지로 요청한다.
  const [opened] = useState(() => ({ signedIn: status === 'signedIn', boot: bootScript(getAccessToken(), WEB_ORIGIN) }))

  // 닫기 시작한 뒤에 온 메시지는 듣지 않는다. 웹이 같은 메시지를 두 번 보내도 화면이 두 번 닫히지 않는다.
  const leaving = useRef(false)
  const close = () => {
    if (leaving.current) return
    leaving.current = true
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  // 이 화면을 연 뒤 세션이 끝났다(로그아웃, 갱신 401). 아래에 있던 탭 화면은 이미 내려갔으므로 로그인 화면으로 바꾼다.
  useEffect(() => {
    if (opened.signedIn && status === 'signedOut') router.replace('/login')
  }, [opened.signedIn, status])

  // Android 뒤로 버튼: 웹 안에 돌아갈 곳이 있으면 웹에서 뒤로, 없으면 화면을 닫는다.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false
      webRef.current?.goBack()
      return true
    })
    return () => subscription.remove()
  }, [canGoBack])

  const reply = (answer: RefreshReply) => webRef.current?.injectJavaScript(refreshReplyScript(answer, WEB_ORIGIN))

  const onMessage = (event: WebViewMessageEvent) => {
    // 웹 앱의 페이지가 보낸 메시지만 듣는다.
    if (!isSameOrigin(event.nativeEvent.url, WEB_ORIGIN)) return
    const message = parseWebMessage(event.nativeEvent.data)
    if (!message || leaving.current) return
    switch (message.type) {
      case 'close':
        close()
        return
      case 'logout':
        signOut().catch((error: unknown) => showToast(getRequestFailureMessage(error, '로그아웃하지 못했어요.'), 'error'))
        return
      case 'refresh': {
        const { id } = message
        void refreshSession().then((result) => {
          if (result.kind === 'refreshed') reply({ id, kind: 'token', token: result.token })
          else if (result.kind === 'unauthorized') {
            reply({ id, kind: 'unauthorized' })
            endSession()
          } else reply({ id, kind: 'transient' })
        })
        return
      }
      case 'route': {
        const target = nativeTargetOf(message.path)
        if (target === 'today') {
          leaving.current = true
          router.dismissTo('/')
          return
        }
        if (target !== 'auth') return
        if (getSession().status !== 'signedIn') {
          // 가입·비밀번호 찾기를 마치고 로그인 화면으로 돌아간다.
          close()
          return
        }
        // 웹이 로그인이 끝났다고 본다(탈퇴, 다른 기기에서 비밀번호 변경 등). 서버에 확인한 뒤에만 로그아웃한다.
        // 답을 기다리는 동안 같은 메시지가 또 와도 한 번만 확인한다.
        leaving.current = true
        void refreshSession().then((result) => {
          leaving.current = false
          if (result.kind === 'unauthorized') endSession()
          else close()
        })
        return
      }
    }
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.surface, paddingTop: insets.top }]}>
      {/* 화면 가장자리 쓸기는 웹 안의 뒤로 가기에 쓴다. 화면 닫기는 웹 상단의 뒤로 버튼이 한다. */}
      <Stack.Screen options={{ gestureEnabled: false }} />
      {failed ? (
        <View style={[styles.center, { backgroundColor: theme.bg }]}>
          <Text style={[styles.failTitle, { color: theme.ink }]}>화면을 불러오지 못했어요.</Text>
          <Text style={[styles.failBody, { color: theme.muted }]}>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</Text>
          <View style={styles.failActions}>
            <Button label="닫기" onPress={close} />
            <Button
              label="다시 시도"
              primary
              onPress={() => {
                setFailed(false)
                setAttempt((count) => count + 1)
              }}
            />
          </View>
        </View>
      ) : (
        <WebView<object>
          key={attempt}
          ref={webRef}
          source={{ uri: WEB_ORIGIN + path }}
          style={{ backgroundColor: theme.bg }}
          containerStyle={{ paddingBottom: insets.bottom, backgroundColor: theme.bg }}
          applicationNameForUserAgent={APP_USER_AGENT}
          injectedJavaScriptBeforeContentLoaded={opened.boot}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          onMessage={onMessage}
          onNavigationStateChange={(navigation) => setCanGoBack(navigation.canGoBack)}
          onShouldStartLoadWithRequest={(request) => {
            if (isSameOrigin(request.url, WEB_ORIGIN) || request.url === 'about:blank') return true
            // iOS는 페이지 안의 프레임도 묻는다. 맨 위 문서만 막는다.
            if (request.isTopFrame === false) return true
            // 다른 사이트는 앱 안에서 열지 않는다. 기기의 브라우저나 메일 앱으로 넘긴다.
            if (/^(https?|mailto|tel):/i.test(request.url)) void Linking.openURL(request.url).catch(() => undefined)
            return false
          }}
          onError={() => setFailed(true)}
          onContentProcessDidTerminate={() => webRef.current?.reload()}
          onRenderProcessGone={() => setAttempt((count) => count + 1)}
          // refresh 쿠키를 웹과 함께 쓴다. 비밀번호 변경·탈퇴 재인증처럼 쿠키가 필요한 웹 화면을 위해서다.
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          decelerationRate="normal"
          webviewDebuggingEnabled={__DEV__}
          startInLoadingState
          renderLoading={() => (
            <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: theme.bg }]}>
              <ActivityIndicator color={theme.muted} />
            </View>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  failTitle: { fontSize: 17, fontWeight: '700' },
  failBody: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  failActions: { flexDirection: 'row', gap: space.md, marginTop: space.md },
})
