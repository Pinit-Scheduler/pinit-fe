import { useEffect, useState } from 'react'
import { useToast } from '@contexts/ToastContext'
import { formatIsoDurationLabel } from '@shared/utils/isoDuration'
import { onScheduleChanged } from '@shared/utils/events'
import { fetchWeeklyReview, updateTimeCalibration } from '../api/calibration'
import type { WeeklyReviewItem, WeeklyReviewResponse } from '../types/calibration'
import { factorRow, formatAccuracy, formatFactor, ratioSentence, unmeasuredLines } from '../utils/calibrationView'
import './WeeklyReviewSection.css'

type Props = {
  /** 리뷰할 주의 월요일 YYYY-MM-DD */
  weekStart: string
}

const ItemList = ({ title, items }: { title: string; items: WeeklyReviewItem[] }) => (
  <div className="weekly-review__list">
    <h3>{title}</h3>
    <ul>
      {items.map((item) => (
        <li key={item.scheduleId}>
          <span className="weekly-review__item-title">{item.title}</span>
          <span className="weekly-review__item-meta">
            난이도 {item.difficulty} · 예상 {formatIsoDurationLabel(item.baseDuration) ?? '-'} → 실제{' '}
            {formatIsoDurationLabel(item.actualDuration) ?? '-'} ({formatFactor(item.ratio)})
          </span>
        </li>
      ))}
    </ul>
  </div>
)

/**
 * ADR-0018 §8 통계 탭 "주간 리뷰". 서버가 계산한 예상 대비 실제와 현재 보정 계수를 보여 주고,
 * 플래너 보정을 켜고 끄는 토글을 둔다.
 */
const WeeklyReviewSection = ({ weekStart }: Props) => {
  const { addToast } = useToast()
  const [review, setReview] = useState<WeeklyReviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    fetchWeeklyReview(weekStart)
      .then((response) => {
        if (!cancelled) setReview(response)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '주간 리뷰를 불러오지 못했어요.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [weekStart, refreshKey])

  useEffect(() => onScheduleChanged(() => setRefreshKey((key) => key + 1)), [])

  const toggleCalibration = async (enabled: boolean) => {
    if (!review) return
    setIsSaving(true)
    try {
      const calibration = await updateTimeCalibration(enabled)
      setReview({ ...review, calibration })
      addToast(enabled ? '이제 하루 계획에 보정을 적용해요.' : '하루 계획 보정을 껐어요.', 'success')
    } catch (err) {
      addToast(err instanceof Error ? `보정 설정을 바꾸지 못했어요. ${err.message}` : '보정 설정을 바꾸지 못했어요.', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading && !review) {
    return (
      <section className="weekly-review" aria-busy="true">
        <h2>주간 리뷰</h2>
        <p className="weekly-review__hint">예상과 실제를 비교하는 중...</p>
      </section>
    )
  }

  if (error || !review) {
    return (
      <section className="weekly-review">
        <h2>주간 리뷰</h2>
        <p className="weekly-review__hint" role="alert">
          주간 리뷰를 불러오지 못했어요. {error}
        </p>
        <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>
          다시 시도
        </button>
      </section>
    )
  }

  const { summary, calibration } = review
  const unmeasured = unmeasuredLines(review.unmeasured)

  return (
    <section className="weekly-review">
      <div className="weekly-review__head">
        <h2>주간 리뷰</h2>
        <p className="weekly-review__hint">예상 소요시간과 실제 실행 시간을 비교해요.</p>
      </div>

      <p className="weekly-review__sentence">{ratioSentence(summary.medianRatio)}</p>
      <dl className="weekly-review__summary">
        <div>
          <dt>측정된 일정</dt>
          <dd>{summary.measuredCount}건</dd>
        </div>
        <div>
          <dt>예상 / 실제</dt>
          <dd>
            {formatIsoDurationLabel(summary.totalBase) ?? '-'} / {formatIsoDurationLabel(summary.totalActual) ?? '-'}
          </dd>
        </div>
        <div>
          <dt>예상 ±25% 적중</dt>
          <dd>{formatAccuracy(summary.accuracy)}</dd>
        </div>
        <div>
          <dt>지난주 비율</dt>
          <dd>{formatFactor(summary.previousWeekMedianRatio)}</dd>
        </div>
      </dl>

      {review.byDifficulty.length > 0 && (
        <div className="weekly-review__list">
          <h3>이번 주 난이도별</h3>
          <ul>
            {review.byDifficulty.map((week) => (
              <li key={week.difficulty}>
                <span className="weekly-review__item-title">난이도 {week.difficulty}</span>
                <span className="weekly-review__item-meta">
                  {week.count}건 · {formatFactor(week.medianRatio)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.overruns.length > 0 && <ItemList title="예상보다 오래 걸린 일" items={review.overruns} />}
      {review.underruns.length > 0 && <ItemList title="예상보다 빨리 끝난 일" items={review.underruns} />}

      {unmeasured.length > 0 && (
        <div className="weekly-review__list weekly-review__list--muted">
          <h3>측정하지 못한 일정</h3>
          <ul>
            {unmeasured.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="weekly-review__calibration">
        <h3>내 보정 계수 (최근 {calibration.windowDays}일)</h3>
        <p className="weekly-review__hint">
          난이도마다 기록 {calibration.minSamples}건 이상이면 그 난이도 기록을, 모자라면 전체 기록을 써요.
        </p>
        <table>
          <tbody>
            {calibration.byDifficulty.map((factor) => {
              const row = factorRow(factor)
              return (
                <tr key={factor.difficulty} className={factor.source === 'NONE' ? 'is-muted' : undefined}>
                  <th scope="row">{row.difficulty}</th>
                  <td>{row.factor}</td>
                  <td>{row.detail}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <label className="weekly-review__toggle">
          <input
            type="checkbox"
            aria-label="플래너에 보정 적용"
            checked={calibration.enabled}
            disabled={isSaving}
            onChange={(event) => toggleCalibration(event.target.checked)}
          />
          <span>
            플래너에 보정 적용
            <small>켜면 하루 계획 블록 길이에 이 계수를 곱해요. 직접 만드는 일정에는 영향이 없어요.</small>
          </span>
        </label>
      </div>
    </section>
  )
}

export default WeeklyReviewSection
