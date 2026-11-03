import type { DifficultyValue } from '@constants/difficulty'
/** Existing server difficulty estimate; this does not apply learned calibration. */
export const DIFFICULTY_ESTIMATE_MINUTES: Record<DifficultyValue, number> = {
  1: 15,
  2: 30,
  3: 45,
  5: 60,
  8: 90,
  13: 120,
  21: 180,
}
