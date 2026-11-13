import { useEffect } from 'react'
import type { FocusEvent, MouseEvent, TouchEvent } from 'react'

// 로그인·가입·비밀번호 찾기·이메일 등록 화면이 함께 쓰는 카드 화면 동작.

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (window.navigator as unknown as { standalone?: boolean })?.standalone === true

// PWA standalone 모드에서 입력란 포커스가 씹히는 문제를 막는다.
const focusInStandalone = (
  event: TouchEvent<HTMLInputElement> | MouseEvent<HTMLInputElement> | FocusEvent<HTMLInputElement>,
) => {
  const target = event.currentTarget
  if (!isStandalone()) return
  requestAnimationFrame(() => {
    target.focus({ preventScroll: false })
    setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
  })
}

/** 입력란에 펼쳐 넣는다: `<input {...standaloneFocusProps} />` */
export const standaloneFocusProps = {
  onTouchStart: focusInStandalone,
  onTouchEnd: focusInStandalone,
  onMouseDown: focusInStandalone,
  onFocus: focusInStandalone,
}

/** 가로 스크롤 없이 카드 화면 안에서 세로로 스크롤할 수 있게 한다. 화면을 떠나면 되돌린다. */
export const useAuthPageScroll = () => {
  useEffect(() => {
    const body = document.body
    const root = document.getElementById('root')
    const prevBodyOverflow = body.style.overflow
    const prevRootOverflow = root?.style.overflow
    body.style.overflowX = 'hidden'
    body.style.overflowY = 'auto'
    if (root) {
      root.style.overflowX = 'hidden'
      root.style.overflowY = 'auto'
    }
    return () => {
      body.style.overflow = prevBodyOverflow
      if (root && prevRootOverflow !== undefined) root.style.overflow = prevRootOverflow
    }
  }, [])
}
