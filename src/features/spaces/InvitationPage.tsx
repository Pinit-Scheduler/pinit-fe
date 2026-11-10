import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '@shared/api/httpClient'
import { acceptInvitation, previewInvitation } from './api'
import { reloadSpaces, selectSpace } from './store'
import type { Invitation } from './types'
import './spaces.css'

export default function InvitationPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mutation = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setUnavailable(false)
    if (!token) {
      setError('초대 링크를 확인할 수 없어요.')
      setLoading(false)
      return
    }
    void previewInvitation(token, controller.signal)
      .then(setInvitation)
      .catch((failure) => {
        if (controller.signal.aborted) return
        setUnavailable(
          failure instanceof ApiError && [404, 410].includes(failure.status),
        )
        setError(
          failure instanceof ApiError && [404, 410].includes(failure.status)
            ? '유효하지 않거나 만료된 초대 링크예요. 관리자에게 새 링크를 요청해 주세요.'
            : failure instanceof Error && failure.message
              ? failure.message
              : '초대 정보를 불러오지 못했어요.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [token, attempt])
  const enter = async () => {
    if (!token || mutation.current) return
    mutation.current = true
    setBusy(true)
    setError(null)
    try {
      const accepted = await acceptInvitation(token)
      selectSpace(accepted.spaceId)
      // Membership is already committed; a later list refresh must never resubmit acceptance.
      void reloadSpaces().catch(() => {})
      navigate('/app/tasks', { replace: true })
    } catch (failure) {
      setUnavailable(
        failure instanceof ApiError && [404, 410].includes(failure.status),
      )
      setError(
        failure instanceof ApiError && [404, 410].includes(failure.status)
          ? '초대 링크가 만료되었거나 사용할 수 없어요. 관리자에게 새 링크를 요청해 주세요.'
          : failure instanceof Error && failure.message
            ? failure.message
            : '참여를 완료하지 못했어요. 다시 시도해 주세요.',
      )
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }
  return (
    <main className="workspace-theme space-invite-page">
      <section className="space-invite-card" aria-busy={loading || busy}>
        <Link to="/app/today" className="workspace-brand">
          pinit.
        </Link>
        {loading ? (
          <p role="status" className="space-invite-card__loading">
            초대 정보를 확인하고 있어요…
          </p>
        ) : (
          <>
            <h1>
              {invitation
                ? `${invitation.spaceName}에 초대받았어요`
                : '초대 링크 확인'}
            </h1>
            {invitation?.purpose && <p>{invitation.purpose}</p>}
            {invitation && (
              <>
                <p className="space-notice">
                  참여하면 이 스페이스의 공유 내용과 이동 전 기록을 함께 보고 수정할
                  수 있어요.
                </p>
                <p>
                  {invitation.nickname} 님의 회원 프로필로 참여합니다. 이름을
                  다시 입력하지 않아도 돼요.
                </p>
                <p className="space-help">
                  링크 만료:{' '}
                  {new Date(invitation.expiresAt).toLocaleString('ko-KR')}
                </p>
              </>
            )}
            {error && (
              <p className="space-error" role="alert">
                {error}
              </p>
            )}
            {invitation && !unavailable && (
              <button
                className="workspace-button workspace-button--primary"
                disabled={busy}
                onClick={() => void enter()}
              >
                {busy
                  ? '참여 중…'
                  : invitation.status === 'ALREADY_MEMBER'
                    ? '참여 중인 스페이스로 이동'
                    : '스페이스 참여'}
              </button>
            )}
            {!unavailable && error && (
              <button
                className="workspace-button"
                disabled={busy}
                onClick={() => setAttempt((value) => value + 1)}
              >
                초대 다시 확인
              </button>
            )}
            <div>
              <Link to="/app/today">나의 작업으로 돌아가기</Link>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
