import { usePresence } from '@shared/motion/usePresence'

type AuthMessageProps = {
  message?: string | null
  as?: 'small' | 'p'
  className?: string
}

/**
 * A field or form message that drops in when it appears and fades out when it is cleared,
 * instead of popping. The text is passed through unchanged (server messages are BE-owned).
 * A new message while one is showing replaces the text in place without replaying the entrance.
 */
const AuthMessage = ({ message, as: Tag = 'small', className }: AuthMessageProps) => {
  const presence = usePresence(message || null)
  if (!presence.mounted) return null
  return (
    <Tag
      className={className ? `auth-message ${className}` : 'auth-message'}
      data-state={presence.closing ? 'closing' : 'open'}
      aria-hidden={presence.closing || undefined}
    >
      {presence.value}
    </Tag>
  )
}

export default AuthMessage
