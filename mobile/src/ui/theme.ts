import { useColorScheme } from 'react-native'

// 웹 워크스페이스 팔레트(src/shared/styles/workspacePalette.css)와 같은 값이다.
const light = {
  bg: '#f4f6fa',
  surface: '#ffffff',
  ink: '#202a3c',
  muted: '#626e80',
  line: '#e9edf3',
  controlLine: '#cfd8e5',
  blue: '#345ce5',
  blueSoft: '#edf2ff',
  onAccent: '#ffffff',
  completed: '#8c9bb5',
  meterBlue: '#a7bcfa',
  meterPink: '#e6a9bc',
  meterTrack: '#edf0f5',
  meterInk: '#202a3c',
  running: '#345ce5',
  suspended: '#92400e',
  done: '#166534',
  errorBg: '#fef2f2',
  errorLine: '#fecaca',
  errorInk: '#991b1b',
  shadow: '#0f172a',
}

const dark: typeof light = {
  bg: '#151c2a',
  surface: '#202a3c',
  ink: '#e3e9f4',
  muted: '#a3b0c5',
  line: '#354258',
  controlLine: '#52617a',
  blue: '#9bb4ff',
  blueSoft: '#2a3d65',
  onAccent: '#142547',
  completed: '#8c9bb5',
  // 어두운 화면에서는 숫자를 밝게 두고 채움을 낮춰, 채움이 적은 동그라미에서도 숫자가 읽히게 한다.
  meterBlue: '#4a63b8',
  meterPink: '#a8587a',
  meterTrack: '#354258',
  meterInk: '#e3e9f4',
  running: '#9bb4ff',
  suspended: '#fbbf24',
  done: '#86efac',
  errorBg: '#3b1d24',
  errorLine: '#7f2f3b',
  errorInk: '#fecaca',
  shadow: '#000000',
}

export type Theme = typeof light

export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light)

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const
export const radius = { sm: 6, md: 8, lg: 12 } as const
/** 손가락으로 누르는 영역의 최소 크기. */
export const HIT = 44
