import WorkspaceIcon, { type WorkspaceIconName } from '@shared/components/common/WorkspaceIcon'
import './StatusPanel.css'

type StatusPanelProps = {
  variant: 'loading' | 'error' | 'empty'
  title: string
  description?: string
  action?: React.ReactNode
}

const variantIcons: Record<StatusPanelProps['variant'], WorkspaceIconName> = {
  loading: 'clock',
  error: 'warning',
  empty: 'inbox',
}

/**
 * Loading, error and empty states. The loading variant stays invisible for the first 150ms and
 * then fades in, so a quick load shows nothing. Render it only for a first load
 * (isInitialLoading); during a refresh keep the content on screen instead.
 */
const StatusPanel = ({ variant, title, description, action }: StatusPanelProps) => {
  return (
    <div
      className={`status-panel status-panel--${variant}`}
      role={variant === 'loading' ? 'status' : undefined}
    >
      <span className="status-panel__icon" aria-hidden>
        <WorkspaceIcon name={variantIcons[variant]} width={24} height={24} />
      </span>
      <div className="status-panel__content">
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="status-panel__action">{action}</div>}
    </div>
  )
}

export default StatusPanel

