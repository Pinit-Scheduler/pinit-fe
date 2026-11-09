import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { useSpaces } from '@features/spaces/store'
import DeadlineRiskItem from '../components/DeadlineRiskItem'
import useDeadlineRisk from '../hooks/useDeadlineRisk'
import type { DeadlineRiskDays } from '../types/deadlineRisk'
import { forecastCounts, forecastTimeLabel } from '../utils/deadlineRiskView'
import './DeadlineRiskPage.css'

export default function DeadlineRiskPage() {
  const { zoneId } = useTimePreferences()
  const navigate = useNavigate()
  const spaces = useSpaces()
  const personalSpace = spaces.spaces.find((space) => space.id === spaces.defaultSpaceId && space.personal && !space.deleted)
  const openPersonal = (path: '/app/plan' | '/app/tasks') => {
    if (!personalSpace) return
    // A local view preference only; clear a selected team/project before navigation.
    spaces.selectSpace(personalSpace.id)
    navigate(path)
  }
  const [days, setDays] = useState<DeadlineRiskDays>(7)
  const { forecast, error, isLoading, refresh } = useDeadlineRisk(days, zoneId)
  const counts = forecast ? forecastCounts(forecast.items) : null

  return (
    <section className="deadline-risk" aria-labelledby="deadline-risk-title">
      <header className="deadline-risk__header">
        <h1 id="deadline-risk-title">마감 위험 예보</h1>
        <p>개인 공간의 작업과 일정만 반영해요. 팀이나 다른 공간의 작업·일정은 포함하지 않아요.</p>
        <p>마감 전에 끝낼 시간이 충분할까요? 선행 작업과 이미 잡힌 일정, 생활 시간을 함께 살펴봐요.</p>
        <p className="deadline-risk__hint">조회 시점의 가정에 따른 시간 예보예요. 일정이나 작업을 자동으로 바꾸지 않아요.</p>
      </header>
      <div className="deadline-risk__toolbar">
        <label>살펴볼 기간
          <select value={days} onChange={(event) => setDays(event.target.value === '14' ? 14 : 7)}>
            <option value={7}>오늘부터 7일</option>
            <option value={14}>오늘부터 14일</option>
          </select>
        </label>
        <button type="button" onClick={refresh} disabled={isLoading}>다시 조회</button>
        <button type="button" disabled={!personalSpace} onClick={() => openPersonal('/app/plan')}>개인 공간에서 하루 계획 열기</button>
      </div>
      {!personalSpace ? <p className="deadline-risk__hint" role="status">개인 공간을 불러온 뒤 작업과 계획 화면을 열 수 있어요. {spaces.error ? <button type="button" onClick={() => void spaces.reload().catch(() => {})}>공간 다시 조회</button> : null}</p> : null}
      {isLoading ? <p role="status">마감과 남은 시간을 계산하고 있어요.</p> : null}
      {error ? <p className="deadline-risk__error" role="alert">{error}</p> : null}
      {forecast && counts ? (
        <>
          <div className="deadline-risk__basis">
            <p><time dateTime={forecast.generatedAt}>{forecastTimeLabel(forecast.generatedAt, forecast.zoneId)}</time> 조회 기준</p>
            <p>시간대 {forecast.zoneId} · <time dateTime={forecast.horizonEnd}>{forecastTimeLabel(forecast.horizonEnd, forecast.zoneId)}</time> 전까지</p>
            <p>기록 기반 시간 보정 {forecast.calibrationApplied ? '적용' : '꺼짐'}</p>
          </div>
          {forecast.items.length === 0 ? (
            <div className="deadline-risk__empty">
              <h2>기간 안에 확인할 마감 작업이 없어요</h2>
              <p>완료한 작업은 예보에서 제외돼요. 아직 생성되지 않은 반복 회차는 포함하지 않아요.</p>
              <button type="button" className="deadline-risk__personal-action" disabled={!personalSpace} onClick={() => openPersonal('/app/tasks')}>개인 공간의 작업과 마감 확인하기</button>
            </div>
          ) : (
            <>
              <p className="deadline-risk__summary" role="status">
                {forecast.items.length}개 작업 중 시간 부족 {counts.shortage}개, 배치·계산 확인 {counts.review}개, 마감 지남 {counts.overdue}개
              </p>
              <p className="deadline-risk__hint">필요 시간은 미완료 선행 작업까지 포함해요. 같은 선행 작업이 여러 예보에 나올 수 있어 항목별 시간을 합산하지 마세요.</p>
              <ul className="deadline-risk__list" aria-label="작업별 마감 위험">
                {forecast.items.map((item) => <DeadlineRiskItem key={item.taskId} item={item} zoneId={forecast.zoneId} canOpenPlan={Boolean(personalSpace)} onOpenPlan={() => openPersonal('/app/plan')} />)}
              </ul>
            </>
          )}
          <details className="deadline-risk__assumptions">
            <summary>계산에 사용한 가정과 한계</summary>
            <p>성공 확률을 계산하지 않아요. 연속 작업 시간과 선행 순서를 지키는 한 가지 배치를 검토해요. 다른 순서에서는 결과가 달라질 수 있어요.</p>
            <h2>가정</h2>
            <ul>{forecast.assumptions.map((text, index) => <li key={`assumption-${index}`}>{text}</li>)}</ul>
            <h2>한계</h2>
            <ul>{forecast.limitations.map((text, index) => <li key={`limit-${index}`}>{text}</li>)}</ul>
            <p>조회 이후 바뀐 내용이나 실행 시간은 다시 조회하면 반영돼요.</p>
          </details>
        </>
      ) : null}
    </section>
  )
}
