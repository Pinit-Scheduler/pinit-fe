import './TopBar.css'

type TopBarProps = {
  title: string
  showBackButton?: boolean
  onBack?: () => void
  showSettingsButton?: boolean
  onSettings?: () => void
}

/**
 * 상단 바 컴포넌트
 * @param title - 제목
 * @param showBackButton - 뒤로가기 버튼 표시 여부
 * @param onBack - 뒤로가기 버튼 클릭 핸들러
 * @param showSettingsButton - 설정 버튼 표시 여부
 * @param onSettings - 설정 버튼 클릭 핸들러
 * @constructor
 */
const TopBar = ({
  title,
  showBackButton,
  onBack,
  showSettingsButton = true,
  onSettings,
}: TopBarProps) => {
  return (
    <header className="top-bar">
      <div className="top-bar__section">
        {showBackButton ? (
          <button className="top-bar__icon-button" onClick={onBack} aria-label="뒤로가기">
            ←
          </button>
        ) : (
          <span className="top-bar__placeholder"><img src="/icons/icon.svg" alt="Pinit 아이콘" className="top-bar-logo"/></span>
        )}
      </div>
      <div className="top-bar__title" aria-live="polite">
        {title}
      </div>
      <div className="top-bar__section">
        {showSettingsButton ? (
          <button
            className="top-bar__icon-button"
            onClick={onSettings}
            aria-label="설정"
          >
            ⚙️
          </button>
        ) : (
          <span className="top-bar__placeholder" />
        )}
      </div>
    </header>
  )
}

export default TopBar

