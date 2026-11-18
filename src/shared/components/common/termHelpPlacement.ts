/** 말풍선과 그 바깥 가장자리 사이의 여백(px) */
export const TIP_MARGIN = 8

/**
 * "?" 설명 말풍선을 표시 가운데에 두었을 때 `bounds`(화면, 또는 그 안에서 말풍선을 자르는 상자) 밖으로 나가지
 * 않게 옆으로 밀 거리(px). 오른쪽이 +다. 들어갈 자리보다 넓으면 왼쪽 여백에 맞춘다.
 */
export const tipShift = (
  markCenter: number,
  tipWidth: number,
  bounds: { left: number; right: number },
  margin = TIP_MARGIN,
): number => {
  const min = bounds.left + margin
  const max = bounds.right - margin
  const left = markCenter - tipWidth / 2
  const right = markCenter + tipWidth / 2
  if (left < min || tipWidth > max - min) return min - left
  if (right > max) return max - right
  return 0
}
