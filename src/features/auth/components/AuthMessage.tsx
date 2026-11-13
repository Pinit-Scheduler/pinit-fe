import { usePresence } from '@shared/motion/usePresence'

type AuthMessageProps = {
  message?: string | null
  as?: 'small' | 'p'
  className?: string
  /** 입력란의 aria-describedby가 가리킬 id. */
  id?: string
  /** 폼 전체 오류처럼 바로 읽어 줘야 하는 문구는 'alert'. */
  role?: 'alert'
}

/**
 * A field or form message that drops in when it appears and fades out when it is cleared,
 * instead of popping. The text is passed through unchanged (server messages are BE-owned).
 * A new message while one is showing replaces the text in place without replaying the entrance.
 */
const AuthMessage = ({ message, as: Tag = 'small', className, id, role }: AuthMessageProps) => {
  const presence = usePresence(message || null)
  if (!presence.mounted) return null
  return (
    <Tag
      id={id}
      role={role}
      className={className ? `auth-message ${className}` : 'auth-message'}
      data-state={presence.closing ? 'closing' : 'open'}
      aria-hidden={presence.closing || undefined}
    >
      {presence.value}
    </Tag>
  )
}

export default AuthMessage
