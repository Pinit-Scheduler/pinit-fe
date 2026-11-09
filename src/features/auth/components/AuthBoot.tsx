import './AuthBoot.css'

/**
 * Shown while AuthGuard refreshes the session. It paints the workspace background at once,
 * so there is no blank or off-color frame, and the mark only fades in if the check is slow.
 */
const AuthBoot = () => (
  <div className="workspace-theme auth-boot" role="status" aria-live="polite">
    <div className="auth-boot__mark" aria-hidden>
      <img src="/icons/icon.svg" alt="" className="auth-boot__logo" width={40} height={40} />
      <span className="auth-boot__name">Pinit</span>
    </div>
    <span className="auth-boot__line" aria-hidden />
    <span className="auth-boot__label">로그인 상태를 확인하는 중이에요</span>
  </div>
)

export default AuthBoot
