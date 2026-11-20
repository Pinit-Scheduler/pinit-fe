const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)

/** 유니코드 White_Space 25개 코드 포인트(오름차순). 폭 없는 공백(U+200B, U+FEFF)은 글자다. */
export const WHITE_SPACE: readonly number[] = [
  ...range(0x09, 0x0d),
  0x20,
  0x85,
  0xa0,
  0x1680,
  ...range(0x2000, 0x200a),
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
]

const whiteSpaceSet = new Set<number>(WHITE_SPACE)

export const isWhiteSpace = (codePoint: number): boolean => whiteSpaceSet.has(codePoint)

/** 공백이 이어진 곳을 U+0020 하나로 바꾸고 앞뒤 공백을 뺀다. */
export const normalizeText = (raw: string): string => {
  let out = ''
  let pendingSpace = false
  for (const char of raw) {
    if (isWhiteSpace(char.codePointAt(0)!)) {
      pendingSpace = out !== ''
    } else {
      if (pendingSpace) out += ' '
      pendingSpace = false
      out += char
    }
  }
  return out
}

/** 코드 포인트 수. */
export const textLength = (text: string): number => [...text].length

/** 정리한 길이가 `max`를 넘지 않도록 앞에서부터 남긴 글. 한도 안이면 그대로다. */
export const clipText = (raw: string, max: number): string => {
  let out = ''
  let length = 0
  let pendingSpace = false
  for (const char of raw) {
    if (isWhiteSpace(char.codePointAt(0)!)) {
      pendingSpace = length > 0
    } else {
      const added = pendingSpace ? 2 : 1
      if (length + added > max) break
      length += added
      pendingSpace = false
    }
    out += char
  }
  return out
}
