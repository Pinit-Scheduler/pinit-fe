import { useCallback, useEffect, useRef, useState } from 'react'

/** 저장 확인 표시가 머무는 시간 */
export const SAVED_FLASH_MS = 1600

/**
 * 어느 줄이 방금 저장됐는지 잠시 기억한다. `flash(key)`를 부르면 `isFlashing(key)`가 SAVED_FLASH_MS 동안 참이다.
 * 같은 줄을 다시 저장하면 시간을 새로 센다.
 */
const useSavedFlash = () => {
  const [flashing, setFlashing] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const flash = useCallback((key: string) => {
    if (timer.current) clearTimeout(timer.current)
    setFlashing(key)
    timer.current = setTimeout(() => {
      timer.current = null
      setFlashing(null)
    }, SAVED_FLASH_MS)
  }, [])

  const isFlashing = useCallback((key: string) => flashing === key, [flashing])

  return { flash, isFlashing }
}

export default useSavedFlash
