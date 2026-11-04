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

const StatusPanel = ({ variant, title, description, action }: StatusPanelProps) => {
  return (
    <div className={`status-panel status-panel--${variant}`}>
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

