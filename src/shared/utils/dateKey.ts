// URL 등에서 받은 날짜 키(YYYY-MM-DD)를 해석한다. 의존성이 없어야 node 테스트에서 그대로 불러 쓸 수 있다.

export type DateKeyParts = {
  year: number
  /** 1~12 */
  month: number
  day: number
}

/** 달력에 있는 YYYY-MM-DD면 연·월·일을, 아니면 null을 돌려준다. */
export const parseDateKey = (value?: string | null): DateKeyParts | null => {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return { year, month, day }
}
