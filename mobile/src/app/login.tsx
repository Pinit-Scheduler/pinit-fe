import { Image } from 'expo-image'
import { useRef, useState, type ComponentRef } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getRequestFailureMessage } from '@/api/errors'
import { openWeb } from '@/lib/webNav'
import { signIn } from '@/session/store'
import { Button, TextLink } from '@/ui/kit'
import { HIT, radius, space, useTheme } from '@/ui/theme'

/** 아이디·비밀번호 로그인. 가입과 비밀번호 찾기는 웹 화면으로 연다. */
export default function LoginScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null)

  const submit = async () => {
    if (submitting) return
    if (!username.trim() || !password) {
      setError('아이디와 비밀번호를 입력해 주세요.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      // 성공하면 세션 상태가 바뀌어 이 화면이 내려가고 탭 화면이 열린다.
      await signIn(username.trim(), password)
    } catch (failure) {
      setError(getRequestFailureMessage(failure, '로그인하지 못했어요.'))
      setSubmitting(false)
    }
  }

  const input = [styles.input, { color: theme.ink, borderColor: theme.controlLine, backgroundColor: theme.surface }]
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.fill, { backgroundColor: theme.bg }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}>
        <Image source={require('../../assets/images/splash-icon.png')} style={styles.logo} accessibilityLabel="Pinit" />
        <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>
          Pinit에 로그인
        </Text>

        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.muted }]}>아이디</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            accessibilityLabel="아이디"
            style={input}
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.muted }]}>비밀번호</Text>
          <TextInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            accessibilityLabel="비밀번호"
            style={input}
          />
        </View>

        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: theme.errorInk, backgroundColor: theme.errorBg, borderColor: theme.errorLine }]}>
            {error}
          </Text>
        ) : null}

        <Button label="로그인" primary busy={submitting} onPress={() => void submit()} style={styles.submit} />

        <View style={styles.links}>
          <TextLink label="회원가입" onPress={() => openWeb('/signup')} />
          <TextLink label="비밀번호 찾기" onPress={() => openWeb('/forgot-password')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.xl, gap: space.lg, maxWidth: 480, width: '100%', alignSelf: 'center' },
  logo: { width: 72, height: 72, alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: space.sm },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { minHeight: HIT + 4, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16 },
  error: { fontSize: 14, lineHeight: 20, padding: space.md, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  submit: { marginTop: space.sm },
  links: { flexDirection: 'row', justifyContent: 'center', gap: space.xl, marginTop: space.sm },
})
