import { Link, useLocation } from 'react-router-dom'
import { formatMinutesLabel } from '@shared/utils/isoDuration'
import type { DeadlineRiskItem as RiskItem } from '../types/deadlineRisk'
import { forecastTimeLabel, riskExplanation, riskStatusLabel } from '../utils/deadlineRiskView'

export default function DeadlineRiskItem({ item, zoneId, canOpenPlan, onOpenPlan }: {
  item: RiskItem
  zoneId: string
  canOpenPlan: boolean
  onOpenPlan: () => void
}) {
  const location = useLocation()
  const taskLinkState = { backgroundLocation: location }
  const unknown = item.status === 'UNKNOWN'
  return (
    <li className={`deadline-risk__item deadline-risk__item--${item.status.toLowerCase()}`}>
      <div className="deadline-risk__item-heading">
        <h2><Link to={`/app/tasks/${item.taskId}`} state={taskLinkState}>{item.title}</Link></h2>
        <span className="deadline-risk__status">{riskStatusLabel(item.status)}</span>
      </div>
      <p className="deadline-risk__deadline">
        마감 기준 <time dateTime={item.deadline}>{forecastTimeLabel(item.deadline, zoneId)}</time> 전
        {item.recurrenceSeriesId !== null ? ' · 반복 회차' : ''}
      </p>
      {unknown ? (
        <p className="deadline-risk__hint">필요 시간과 확보 시간은 확인이 끝날 때까지 표시하지 않아요.</p>
      ) : (
        <dl className="deadline-risk__minutes">
          <div><dt>필요한 시간</dt><dd>{formatMinutesLabel(item.requiredMinutes)}</dd></div>
          <div><dt>사용 가능 시간(상한)</dt><dd>{formatMinutesLabel(item.availableMinutes)}</dd></div>
          <div><dt>부족한 시간</dt><dd>{formatMinutesLabel(item.shortageMinutes)}</dd></div>
        </dl>
      )}
      {!unknown ? <p className="deadline-risk__hint">사용 가능 시간은 상한이에요. 합계가 충분해도 연속 시간이나 선행 순서를 맞추지 못할 수 있어요.</p> : null}
      <p>{riskExplanation(item.status)}</p>
      {item.reasons.length > 0 ? <ul className="deadline-risk__reasons">{item.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul> : null}
      {item.predecessorTaskIds.length > 0 ? (
        <div className="deadline-risk__predecessors">
          <p>미완료 선행 작업 {item.predecessorTaskIds.length}개가 필요한 시간에 포함돼요.</p>
          <ul aria-label={`${item.title}의 미완료 선행 작업`}>
            {item.predecessorTaskIds.map((id) => <li key={id}><Link to={`/app/tasks/${id}`} state={taskLinkState}>선행 작업 #{id} 확인</Link></li>)}
          </ul>
        </div>
      ) : null}
      {item.suggestedFinish && item.status === 'FEASIBLE' ? (
        <p className="deadline-risk__hint">찾은 배치의 예상 종료 <time dateTime={item.suggestedFinish}>{forecastTimeLabel(item.suggestedFinish, zoneId)}</time></p>
      ) : null}
      <div className="deadline-risk__actions">
        <Link to={`/app/tasks/${item.taskId}`} state={taskLinkState}>작업 상세 확인</Link>
        <button type="button" className="deadline-risk__personal-action" disabled={!canOpenPlan} onClick={onOpenPlan}>개인 스페이스에서 배치 검토</button>
      </div>
    </li>
  )
}
