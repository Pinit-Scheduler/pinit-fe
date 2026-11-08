import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import useDayReplan from '../hooks/useDayReplan'
import { isReplanExpired, replanReasonLabel, validateReplanDelay } from '../utils/replanning'
import './DayReplanningPanel.css'

type Props = { date: string; zoneId: string; onApplied: (ids: number[]) => void; disabled?: boolean }

const DayReplanningPanel = ({ date, zoneId, onApplied, disabled = false }: Props) => {
  const replan = useDayReplan(date, zoneId, onApplied)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const isToday = dayjs(now).tz(zoneId).format('YYYY-MM-DD') === date
  const expired = replan.preview ? isReplanExpired(replan.preview.plannedAt, now) : false
  const busy = replan.phase !== 'idle'
  const delayError = validateReplanDelay(replan.delay)
  const selectedCount = replan.selectedIds.length
  const format = (instant: string) => dayjs(instant).tz(replan.preview?.zoneId ?? zoneId).format('HH:mm')
  const range = (start: string, end: string) => `${format(start)}–${format(end)}`

  return (
    <section className="day-replan" aria-labelledby="day-replan-title" aria-busy={busy}>
      <div className="day-replan__heading">
        <div>
          <h2 id="day-replan-title">오늘 남은 일정 다시 짜기</h2>
          <p>늦어진 만큼, 아직 시작하지 않은 작업 일정을 다시 배치해요.</p>
        </div>
        <span className="day-replan__date">{dayjs(`${date}T12:00`).format('M월 D일')}</span>
      </div>

      <form className="day-replan__controls" onSubmit={(event) => { event.preventDefault(); void replan.loadPreview() }}>
        <label htmlFor="day-replan-delay">늦어진 시간</label>
        <div className="day-replan__delay">
          <input id="day-replan-delay" type="number" min="0" max="240" step="1" inputMode="numeric"
            value={replan.delay} onChange={(event) => replan.changeDelay(event.target.value)}
            disabled={replan.phase === 'apply' || disabled || !isToday}
            aria-invalid={Boolean(delayError)} aria-describedby={delayError ? 'day-replan-delay-error' : undefined} />
          <span>분</span>
        </div>
        <button className="day-replan__primary" type="submit" disabled={busy || disabled || Boolean(delayError) || !isToday}>
          {replan.phase === 'preview' ? '다시 배치하는 중…' : '변경 미리보기'}
        </button>
        {delayError && <p id="day-replan-delay-error" className="day-replan__error">{delayError}</p>}
      </form>

      <p className="day-replan__policy">약속·반복·진행 중·일시정지·완료 일정은 그대로 두고, 생활 시간과 마감·선행 작업을 지켜 배치해요. 일정 사이에는 10분을 비워요.</p>
      {!isToday && <p className="day-replan__error" role="status">날짜가 바뀌었어요. 오늘 계획을 다시 열어 주세요.</p>}
      {replan.error && <p className="day-replan__error" role="alert">{replan.error}</p>}
      {replan.appliedCount !== null && <p className="day-replan__success" role="status">{replan.appliedCount}개 일정의 시간을 변경했어요. 일정 목록에서 확인할 수 있어요.</p>}

      {replan.preview && (
        <div className="day-replan__preview">
          <div className="day-replan__summary">
            <h3>변경 전후</h3>
            <span>{replan.preview.changes.length}개 이동 제안</span>
          </div>
          <p className="day-replan__hint">체크한 일정만 옮겨요. 선택하지 않은 일정은 원래 시간에 남아서 충돌하거나 선행 순서가 맞지 않으면 전체 적용이 거절될 수 있어요.</p>
          {replan.preview.changes.length === 0 ? <p className="day-replan__empty">지금 옮길 수 있는 일정이 없어요. 아래 유지·배치 불가 사유를 확인해 주세요.</p> : (
            <ul className="day-replan__changes">
              {replan.preview.changes.map((change) => (
                <li key={change.scheduleId}>
                  <label className="day-replan__change">
                    <input type="checkbox" checked={replan.selectedIds.includes(change.scheduleId)}
                      onChange={(event) => replan.toggle(change.scheduleId, event.target.checked)} disabled={busy || disabled} />
                    <div className="day-replan__change-content">
                      <span className="day-replan__title">{change.title}</span>
                      <div className="day-replan__times">
                        <span><small>변경 전</small><time dateTime={change.beforeStart}>{range(change.beforeStart, change.beforeEnd)}</time></span>
                        <span aria-hidden="true">→</span>
                        <span><small>변경 후</small><time dateTime={change.afterStart}>{range(change.afterStart, change.afterEnd)}</time></span>
                      </div>
                      {change.calibrationApplied && <small className="day-replan__hint">시간 보정 설정 반영</small>}
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {replan.preview.unplaced.length > 0 && (
            <div className="day-replan__reasons">
              <h3>배치하지 못한 일정 · {replan.preview.unplaced.length}개</h3>
              <p className="day-replan__hint">적용해도 이 일정은 원래 시간에 남아요.</p>
              <ul>{replan.preview.unplaced.map((item) => <li key={item.scheduleId}><strong>{item.title}</strong><span>{replanReasonLabel(item.reason)}</span></li>)}</ul>
            </div>
          )}
          {replan.preview.protectedSchedules.length > 0 && (
            <details className="day-replan__reasons">
              <summary>유지하는 일정 · {replan.preview.protectedSchedules.length}개</summary>
              <ul>{replan.preview.protectedSchedules.map((item) => <li key={item.scheduleId}><strong>{item.title}</strong><span>{range(item.start, item.end)} · {replanReasonLabel(item.reason)}</span></li>)}</ul>
            </details>
          )}
          {expired && <p className="day-replan__error" role="status">미리보기가 15분 지나 만료됐어요. 새 미리보기를 받아 주세요.</p>}
          {replan.preview.changes.length > 0 && (
            <div className="day-replan__apply">
              <span aria-live="polite">{selectedCount}개 선택</span>
              <button type="button" className="day-replan__primary"
                disabled={selectedCount === 0 || busy || disabled || expired || !isToday || replan.requiresPreview}
                onClick={() => void replan.applySelection()}>{replan.phase === 'apply' ? '변경 적용 중…' : '선택한 변경 적용'}</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default DayReplanningPanel
