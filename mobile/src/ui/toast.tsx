import { useEffect, useSyncExternalStore } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { radius, space, useTheme } from './theme'

type Toast = { id: number; message: string; kind: 'info' | 'error' }

const SHOWN_MS = 3500
let current: Toast | null = null
let nextId = 1
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const read = () => current

/** 화면 위쪽에 잠깐 보이는 한 줄 안내. 새 안내가 오면 앞의 것을 바꾼다. */
export const showToast = (message: string, kind: Toast['kind'] = 'info') => {
  current = { id: nextId++, message, kind }
  emit()
}

export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, read, read)
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => {
      if (current?.id === toast.id) {
        current = null
        emit()
      }
    }, SHOWN_MS)
    return () => clearTimeout(timer)
  }, [toast])

  if (!toast) return null
  const error = toast.kind === 'error'
  return (
    <View pointerEvents="none" style={[styles.host, { top: insets.top + space.sm }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.toast,
          {
            backgroundColor: error ? theme.errorBg : theme.surface,
            borderColor: error ? theme.errorLine : theme.line,
            shadowColor: theme.shadow,
          },
        ]}>
        <Text style={[styles.text, { color: error ? theme.errorInk : theme.ink }]}>{toast.message}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    maxWidth: 480,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { fontSize: 14, lineHeight: 20 },
})
