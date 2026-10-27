import { THEME_OPTIONS } from '@shared/theme/theme'
import { useThemePreference } from '@shared/theme/useThemePreference'
import './ThemeSection.css'

/** 설정 > 화면 테마. 기기 설정(prefers-color-scheme)·밝게·어둡게 중에서 고른다. */
const ThemeSection = () => {
  const { preference, setPreference } = useThemePreference()

  return (
    <section className="settings__card" aria-labelledby="settings-theme-title">
      <h2 id="settings-theme-title">화면 테마</h2>
      <div className="theme-section__options" role="radiogroup" aria-labelledby="settings-theme-title">
        {THEME_OPTIONS.map((option) => (
          <label key={option.value} className={['theme-section__option', preference === option.value && 'is-active'].filter(Boolean).join(' ')}>
            <input
              type="radio"
              name="theme-preference"
              value={option.value}
              checked={preference === option.value}
              onChange={() => setPreference(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="theme-section__hint">이 기기에만 저장돼요. 기기 설정을 고르면 휴대폰·PC의 다크 모드를 따라가요.</p>
    </section>
  )
}

export default ThemeSection
