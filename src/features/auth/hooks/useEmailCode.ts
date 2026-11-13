import { useCallback, useEffect, useState } from 'react'
import { normalizeEmail } from '../utils/accountRules'
import { describeEmailAuthError, type EmailAuthFailure } from '../utils/emailAuthErrors'
import {
  INITIAL_EMAIL_CODE_FLOW,
  markEmailCodeSent,
  requireNewEmailCode,
  resendWaitSeconds,
  type EmailCodeFlow,
} from '../utils/emailCode'

type UseEmailCodeReturn = {
  flow: EmailCodeFlow
  /** 다시 받기까지 남은 초 */
  waitSeconds: number
  isSending: boolean
  /** 코드를 보낸다. 실패하면 화면에 보여 줄 이유를, 성공하면 null을 돌려준다. */
  request: (email: string) => Promise<EmailAuthFailure | null>
  /** 받은 코드를 더 쓸 수 없을 때 부른다. 다시 받기 대기 시간은 유지한다. */
  requireNewCode: () => void
}

/** 코드 받기와 60초 재전송 대기. `send`는 정규화한 이메일을 받는다. */
const useEmailCode = (send: (email: string) => Promise<void>): UseEmailCodeReturn => {
  const [flow, setFlow] = useState<EmailCodeFlow>(INITIAL_EMAIL_CODE_FLOW)
  const [isSending, setIsSending] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const waitSeconds = resendWaitSeconds(flow, now)

  useEffect(() => {
    if (waitSeconds === 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), 1000)
    return () => window.clearTimeout(timer)
  }, [waitSeconds, now])

  const request = useCallback(
    async (email: string) => {
      setIsSending(true)
      try {
        await send(normalizeEmail(email))
        const sentAt = Date.now()
        setNow(sentAt)
        setFlow(markEmailCodeSent(email, sentAt))
        return null
      } catch (error) {
        return describeEmailAuthError(error, 'send')
      } finally {
        setIsSending(false)
      }
    },
    [send],
  )

  const requireNewCode = useCallback(() => setFlow(requireNewEmailCode), [])

  return { flow, waitSeconds, isSending, request, requireNewCode }
}

export default useEmailCode
