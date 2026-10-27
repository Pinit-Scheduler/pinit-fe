// 화면 테마. 'system'이면 OS의 prefers-color-scheme을 따른다.
// 고른 값은 이 브라우저에만 저장한다. index.html의 인라인 스크립트가 첫 렌더 전에 같은 키를 읽어 깜박임을 막는다.

export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'pinit.theme'

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: '기기 설정' },
  { value: 'light', label: '밝게' },
  { value: 'dark', label: '어둡게' },
]

// 모바일 주소창 색. 밝은 테마는 원래 브랜드 남색, 어두운 테마는 theme.css의 --c-page다.
const THEME_COLOR = { light: '#0b1b42', dark: '#0b1220' } as const

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const defaultStorage = (): ThemeStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export const parseThemePreference = (value: string | null | undefined): ThemePreference =>
  value === 'light' || value === 'dark' ? value : 'system'

export const readThemePreference = (storage: ThemeStorage | null = defaultStorage()): ThemePreference => {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export const writeThemePreference = (preference: ThemePreference, storage: ThemeStorage | null = defaultStorage()) => {
  try {
    if (preference === 'system') storage?.removeItem(THEME_STORAGE_KEY)
    else storage?.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // 저장하지 못하면 이번 탭에서만 적용된다.
  }
}

export const systemPrefersDark = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches

export const resolveTheme = (preference: ThemePreference, prefersDark: boolean): 'light' | 'dark' =>
  preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference

/** html의 data-theme과 theme-color 메타를 맞춘다. 'system'이면 data-theme을 지워 CSS 미디어 쿼리에 맡긴다. */
export const applyThemePreference = (preference: ThemePreference) => {
  const root = document.documentElement
  if (preference === 'system') delete root.dataset.theme
  else root.dataset.theme = preference
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', THEME_COLOR[resolveTheme(preference, systemPrefersDark())])
}
