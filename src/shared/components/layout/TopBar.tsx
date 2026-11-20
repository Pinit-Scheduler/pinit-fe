import type { ReactNode } from 'react'
import WorkspaceIcon from '../common/WorkspaceIcon'
import './TopBar.css'
type Props = {
  title: string
  /** 범위 표시. `null`이면 범위 칸을 그리지 않는다. */
  scopeLabel: string | null
  leading?: ReactNode
  /** 설정 버튼 왼쪽에 놓는 도구(알림 종 등). */
  tools?: ReactNode
  showBackButton?: boolean
  onBack?: () => void
  showSettingsButton?: boolean
  onSettings?: () => void
}
export default function TopBar({
  title,
  scopeLabel,
  leading,
  tools,
  showBackButton,
  onBack,
  showSettingsButton = true,
  onSettings,
}: Props) {
  return (
    <header className="top-bar">
      <div className="top-bar__breadcrumb">
        {leading && <div className="top-bar__space">{leading}</div>}
        {showBackButton && (
          <button
            className="top-bar__icon-button"
            onClick={onBack}
            aria-label="뒤로가기"
          >
            <WorkspaceIcon name="back" />
          </button>
        )}
        {scopeLabel !== null && (
          <span className="top-bar__workspace">
            <span className="top-bar__scope" title={scopeLabel}>
              {scopeLabel}
            </span>{' '}
            <span aria-hidden="true">/</span>
          </span>
        )}
        <span className="top-bar__title" aria-live="polite">
          {title}
        </span>
      </div>
      <div className="top-bar__tools">
        {tools}
        {showSettingsButton && (
          <button
            className="top-bar__icon-button"
            onClick={onSettings}
            aria-label="설정"
          >
            <WorkspaceIcon name="settings" />
          </button>
        )}
      </div>
    </header>
  )
}
