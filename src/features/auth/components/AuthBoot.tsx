import './AuthBoot.css'

type AuthBootProps = {
  /**
   * The session check keeps failing without an answer (no connection, server unavailable) and is
   * being retried. The screen then says so and offers to try again now.
   */
  retrying?: boolean
  /** A message from the server's response, shown instead of the fixed sentence. */
  message?: string
  onRetry?: () => void
}

/**
 * Shown while AuthGuard refreshes the session. It paints the workspace background at once,
 * so there is no blank or off-color frame, and the mark only fades in if the check is slow.
 */
const AuthBoot = ({ retrying = false, message, onRetry }: AuthBootProps) => (
  <div className="workspace-theme auth-boot" role="status" aria-live="polite">
    <div className="auth-boot__mark" aria-hidden>
      <img src="/icons/icon.svg" alt="" className="auth-boot__logo" width={40} height={40} />
      <span className="auth-boot__name">Pinit</span>
    </div>
    <span className="auth-boot__line" aria-hidden />
    {retrying ? (
      <div className="auth-boot__retry">
        <p className="auth-boot__message">
          {message || '로그인 상태를 확인하지 못해 다시 연결하고 있어요.'}
        </p>
        {onRetry && (
          <button type="button" className="auth-boot__button" onClick={onRetry}>
            다시 시도
          </button>
        )}
      </div>
    ) : (
      <span className="sr-only">로그인 상태를 확인하는 중이에요</span>
    )}
  </div>
)

export default AuthBoot
