import type { CSSProperties } from 'react'

// Values stay explicit; semantic ink is legible in both themes.
export const getImportanceStyle = (): CSSProperties => ({
  color: 'var(--c-blue-700)',
})

export const getDifficultyStyle = (): CSSProperties => ({
  color: 'var(--c-rose-700)',
})
