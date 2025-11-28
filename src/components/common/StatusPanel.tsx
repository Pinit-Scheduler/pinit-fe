import './StatusPanel.css'

type StatusPanelProps = {
  variant: 'loading' | 'error' | 'empty'
  title: string
  description?: string
  action?: React.ReactNode
}

const variantEmojis: Record<StatusPanelProps['variant'], string> = {
  loading: '⏳',
  error: '⚠️',
  empty: '📭',
}

const StatusPanel = ({ variant, title, description, action }: StatusPanelProps) => {
  return (
    <div className={`status-panel status-panel--${variant}`}>
      <span className="status-panel__icon" aria-hidden>
        {variantEmojis[variant]}
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

