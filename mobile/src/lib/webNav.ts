import { router } from 'expo-router'

/** 깊은 화면은 웹 앱을 WebView로 연다. path는 웹 앱의 경로다(예: /app/tasks/12). */
export const openWeb = (path: string) => router.push({ pathname: '/webview', params: { path } })
