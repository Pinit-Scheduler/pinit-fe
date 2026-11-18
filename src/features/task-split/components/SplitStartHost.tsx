import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@contexts/ToastContext'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { askConfirm } from '@shared/components/common/confirm'
import { dispatchTaskChanged } from '@shared/utils/events'
import { fetchSplitSummary, saveSplitConsent, submitSplitRequest } from '../api/splitRequests'
import { useSplitSummary } from '../hooks/useSplitSummary'
import {
  clearSplitStart,
  currentSplitStart,
  subscribeSplitStart,
  type SplitStartTarget,
} from '../splitStartStore'
import { disclosureFor, SUBMITTED } from '../utils/splitLabels'
import { PROPOSAL_SCREEN_READY } from '../utils/splitPaths'
import { decideStart, submitFailureOf } from '../utils/splitStartFlow'
import SplitConsentDialog from './SplitConsentDialog'
import '../task-split.css'

const UNKNOWN_DISCLOSURE = '안내 내용이 바뀌었어요. 화면을 새로 고친 뒤 다시 시도해 주세요.'

/** 쪼개기 시작(동의 창, 확인 창, 접수)이 그려지고 처리되는 자리. 앱 셸에 한 번만 둔다. */
const SplitStartHost = () => {
  const { summary, refetch, setSummary } = useSplitSummary()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [consentFor, setConsentFor] = useState<SplitStartTarget | null>(null)
  const [busy, setBusy] = useState(false)

  const disclosure = summary
    ? disclosureFor(summary.consent.currentVersion, summary.consent.provider, summary.quota)
    : null

  const submitted = (task: SplitStartTarget) => {
    addToast(SUBMITTED, 'success')
    dispatchTaskChanged({ taskId: task.id, reason: 'split' })
  }

  const openConsent = (task: SplitStartTarget) => {
    if (!disclosure) {
      addToast(UNKNOWN_DISCLOSURE, 'error')
      return
    }
    setConsentFor(task)
  }

  /** 접수. 동의가 필요하다고 거부되어 동의 창을 다시 열었으면 true. */
  const submit = async (task: SplitStartTarget) => {
    try {
      await submitSplitRequest(task.id)
      submitted(task)
      return false
    } catch (error) {
      const failure = submitFailureOf(error)
      if (failure.kind === 'already-mine') {
        submitted(task)
        return false
      }
      if (failure.kind === 'consent') {
        refetch()
        openConsent(task)
        return true
      }
      console.error('쪼개기를 맡기지 못했어요.', error)
      addToast(failure.message, 'error')
      dispatchTaskChanged({ taskId: task.id, reason: 'split' })
      return false
    }
  }

  // 시작 하나가 요약을 다시 읽거나 확인 창을 띄우는 동안 들어온 시작은 버린다(두 번 눌러 알림이 둘 뜨지 않게).
  const startingRef = useRef(false)
  const start = async (task: SplitStartTarget) => {
    if (startingRef.current) return
    startingRef.current = true
    try {
      const { decision, fresh } = await decideStart(
        task,
        summary,
        PROPOSAL_SCREEN_READY,
        fetchSplitSummary,
      )
      // 다시 읽은 요약으로 입구와 보관함의 횟수도 맞춘다. 방금 읽었으니 한 번 더 읽지 않고 캐시에 넣는다.
      if (fresh) setSummary(fresh)
      switch (decision.kind) {
        case 'goto':
          navigate(decision.to)
          return
        case 'blocked':
          addToast(decision.message, 'error')
          return
        case 'consent':
          openConsent(task)
          return
        case 'confirm':
          if (await askConfirm(decision.ask)) await submit(task)
          return
        default:
          return
      }
    } finally {
      startingRef.current = false
    }
  }

  const agree = async () => {
    if (!consentFor || !summary || busy) return
    const task = consentFor
    setBusy(true)
    try {
      await saveSplitConsent(summary.consent.currentVersion)
    } catch (error) {
      console.error('동의를 저장하지 못했어요.', error)
      addToast(getRequestFailureMessage(error, '동의를 저장하지 못했어요.'), 'error')
      refetch()
      setConsentFor(null)
      setBusy(false)
      return
    }
    const reopened = await submit(task)
    if (!reopened) setConsentFor(null)
    setBusy(false)
  }

  // 저장소 알림은 렌더 밖에서 온다. 최신 요약을 쓰도록 처리 함수를 ref로 넘긴다.
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })
  useEffect(
    () =>
      subscribeSplitStart(() => {
        const task = currentSplitStart()
        if (!task) return
        clearSplitStart()
        void startRef.current(task)
      }),
    [],
  )

  // 동의가 필요하다는 거부 뒤 다시 읽은 안내 버전을 화면이 모르면 동의 창을 그릴 수 없다.
  // 아무것도 보이지 않은 채 남지 않게 닫고 알린다.
  const [unknownNotices, setUnknownNotices] = useState(0)
  if (consentFor && !disclosure) {
    setConsentFor(null)
    setUnknownNotices((count) => count + 1)
  }
  useEffect(() => {
    if (unknownNotices > 0) addToast(UNKNOWN_DISCLOSURE, 'error')
  }, [unknownNotices, addToast])

  if (!consentFor || !disclosure) return null
  return (
    <SplitConsentDialog
      disclosure={disclosure}
      busy={busy}
      onAgree={() => void agree()}
      onClose={() => setConsentFor(null)}
    />
  )
}

export default SplitStartHost
