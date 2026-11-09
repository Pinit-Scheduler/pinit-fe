export const SPACE_MARKS: readonly string[] = [
  '#3e8391',
  '#9165b0',
  '#a77d35',
  '#43886b',
  '#ad6280',
]

export function spaceMark(space: { id: number; personal: boolean }): string | null {
  if (space.personal) return null
  return SPACE_MARKS[Math.abs(space.id) % SPACE_MARKS.length]
}
