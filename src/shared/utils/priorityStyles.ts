import type { CSSProperties } from 'react'

type PriorityType = 'importance' | 'difficulty'

type ColorScale = {
  hue: number
  saturation: number
  background: [number, number]
  text: [number, number]
  border: [number, number]
}

const scales: Record<PriorityType, ColorScale> = {
  importance: {
    hue: 217, // deep blue
    saturation: 88,
    background: [94, 56],
    text: [38, 18],
    border: [82, 46],
  },
  difficulty: {
    hue: 356, // vivid red
    saturation: 84,
    background: [96, 60],
    text: [36, 16],
    border: [86, 48],
  },
}

const ranges: Record<PriorityType, { min: number; max: number }> = {
  importance: { min: 1, max: 9 },
  difficulty: { min: 1, max: 21 },
}

const clampLevel = (value: number, type: PriorityType) => {
  const { min, max } = ranges[type]
  return Math.min(max, Math.max(min, value))
}

const interpolate = ([start, end]: [number, number], intensity: number) =>
  start + (end - start) * intensity

const buildPriorityStyle = (value: number, type: PriorityType): CSSProperties => {
  const level = clampLevel(value, type)
  const { min, max } = ranges[type]
  const intensity = (level - min) / (max - min) // 0 (min) → 1 (max)
  const { hue, saturation, background, text, border } = scales[type]

  const backgroundLightness = interpolate(background, intensity)
  const textLightness = interpolate(text, intensity)
  const borderLightness = interpolate(border, intensity)

  return {
    backgroundColor: `hsl(${hue} ${saturation}% ${backgroundLightness}%)`,
    color: `hsl(${hue} ${Math.min(100, saturation + 6)}% ${textLightness}%)`,
    boxShadow: `inset 0 0 0 1px hsl(${hue} ${saturation}% ${borderLightness}%)`,
    fontWeight: 700,
  }
}

export const getImportanceStyle = (value: number): CSSProperties => buildPriorityStyle(value, 'importance')

export const getDifficultyStyle = (value: number): CSSProperties => buildPriorityStyle(value, 'difficulty')
