export const FIBONACCI_DIFFICULTIES = [1, 2, 3, 5, 8, 13, 21] as const

export type DifficultyValue = typeof FIBONACCI_DIFFICULTIES[number]

export const DEFAULT_DIFFICULTY: DifficultyValue = 2

export const isValidDifficulty = (value: number): value is DifficultyValue =>
  FIBONACCI_DIFFICULTIES.includes(value as DifficultyValue)
