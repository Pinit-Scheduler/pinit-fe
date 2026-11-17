import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import StatusPanel from '@shared/components/common/StatusPanel'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { toDisplayDayjs } from '@shared/utils/datetime'
import { fetchSplitInbox } from '../api/splitRequests'
import SplitInboxRow from '../components/SplitInboxRow'
import { useSplitCommands } from '../hooks/useSplitCommands'
import { quotaLine } from '../utils/splitLabels'
import { PROPOSAL_SCREEN_READY, splitProposalPath } from '../utils/splitPaths'
import '../task-split.css'

export const SPLIT_INBOX_KEY = 'task-split/inbox'

const formatDay = (iso: string) => toDisplayDayjs(iso).format('M/D')

/** 쪼개기 보관함. 요청을 취소하고 제안을 버리는(B단계부터는 여는) 곳이다. */
export default function SplitInboxPage() {
  const navigate = useNavigate()
  const commands = useSplitCommands()
  // "N분 전 요청"이 낡지 않게 1분마다 다시 잰다.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const { data, error, isRefreshing, refetch } = useRevalidatingQuery(
    SPLIT_INBOX_KEY,
    fetchSplitInbox,
    {
      invalidateOn: ['task'],
      refetchOnFocus: true,
      errorMessage: '보관함을 불러오지 못했어요.',
    },
  )

  const header = (
    <header className="split-page__header">
      <div>
        <p className="task-page__eyebrow">작업</p>
        <h1 className="task-page__title">쪼개기 보관함</h1>
      </div>
      {data && <p className="split-page__quota">{quotaLine(data.quota)}</p>}
    </header>
  )

  if (!data)
    return (
      <section className="split-page">
        {header}
        {error ? (
          <StatusPanel
            variant="error"
            title={error}
            action={
              <button type="button" className="workspace-button" onClick={refetch}>
                다시 시도
              </button>
            }
          />
        ) : (
          <StatusPanel variant="loading" title="보관함을 불러오는 중이에요." />
        )}
      </section>
    )

  return (
    <section className="split-page" aria-busy={isRefreshing || undefined}>
      {header}
      {data.items.length === 0 ? (
        <div className="split-empty">
          <p>보관함이 비어 있어요.</p>
          <p>4시간이 넘는 큰 작업을 열고 "쪼개기"를 눌러 보세요.</p>
          <Link className="workspace-button" to="/app/tasks">
            작업 목록으로
          </Link>
        </div>
      ) : (
        <ul className="split-list">
          {data.items.map((item) => (
            <SplitInboxRow
              key={item.requestId}
              item={item}
              now={now}
              formatDay={formatDay}
              proposalScreen={PROPOSAL_SCREEN_READY}
              onOpen={() => navigate(splitProposalPath(item.requestId))}
              onCancel={() => void commands.cancel(item.requestId)}
              onDiscard={() =>
                void commands.discard({
                  requestId: item.requestId,
                  status: item.status === 'FAILED' ? 'FAILED' : 'READY',
                  violationRemaining: item.violationRemaining,
                })
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}
