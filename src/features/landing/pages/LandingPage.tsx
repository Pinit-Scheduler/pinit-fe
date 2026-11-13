import { Link, Navigate } from 'react-router-dom'
import { useState } from 'react'
import { getAccessToken } from '@shared/api/authTokens'
import './LandingPage.css'

const slides = [
  {
    title: '모바일에 최적화된 Pinit',
    description:
      '한 손 조작으로 중요도·난이도를 바로 조정하고, 카드형 보드로 오늘의 흐름을 확인하세요.',
    bullets: ['드래그 없이 슬라이더로 우선순위 설정', '주간 스트립과 카드 뷰로 빠른 스캔', '작은 화면에서도 읽기 쉬운 정보 구조'],
    ctaLabel: '지금 로그인하기',
    ctaHref: '/login',
  },
  {
    title: '핵심 기능 한눈에',
    description: '중요도·난이도 기반 우선순위, 의존 일정 관리, 실시간 진행률을 지원해요.',
    bullets: ['중요도 슬라이더·피보나치 난이도 조절', '이전·이후 일정 연결로 병목 방지', '주간 통계와 미완료 알림 배너'],
  },
  {
    title: '팀 협업을 위한 흐름',
    description: '미완료 일정 배너와 토스트 알림으로 팀원과 동일한 상태를 공유합니다.',
    bullets: ['주간 성과 패널로 정체 구간 파악', '토스트 알림으로 상태 공유', '오버듀 일정 배너로 놓침 방지'],
  },
  {
    title: '1분 로그인',
    description: '네이버 SSO만으로 Pinit을 바로 시작하세요.',
    bullets: ['비밀번호 없이 빠른 접속', '세션 유지로 재로그인 최소화', '모바일 브라우저/앱 모두 지원'],
    ctaLabel: '네이버로 로그인',
    ctaHref: '/login',
  },
]

const LandingPage = () => {
  const [currentSlide, setCurrentSlide] = useState(0)
  // 로그인한 사용자는 소개 화면을 한 프레임도 그리지 않고 바로 앱으로 보낸다.
  const [hasToken] = useState(() => !!getAccessToken())
  const goToSlide = (index: number) => setCurrentSlide(index)
  const goPrev = () => setCurrentSlide((prev) => Math.max(prev - 1, 0))
  const goNext = () => setCurrentSlide((prev) => Math.min(prev + 1, slides.length - 1))

  if (hasToken) return <Navigate to="/app/schedules" replace />

  return (
    <div className="landing">
      <header className="landing__hero">
        <div className="landing__badge" data-reveal="0">
          <img src="/icons/icon.svg" alt="Pinit 아이콘" className="landing__logo-mark" />
          Pinit · 모바일 우선 플래너
        </div>
        <h1 data-reveal="1">
          Pinit으로
          <br />
          오늘의 집중 포인트를 고정하세요.
        </h1>
        <p data-reveal="2">
          중요도와 난이도로 우선순위를 세우고, 의존 일정까지 한 번에 연결하는 모바일 최적화
          일정 관리 서비스입니다.
        </p>
        <div className="landing__actions" data-reveal="3">
          <Link to="/login" className="landing__action landing__action--primary">
            로그인하고 시작하기
          </Link>
          <p className="landing__hint">사용 중 불편한 점이 있다면, 언제든 chkun3109@gmail.com으로 문의해주세요.</p>
        </div>
        <div className="landing__glow landing__glow--one" />
        <div className="landing__glow landing__glow--two" />
      </header>

      <section className="landing__slider" data-reveal="4">
        <div className="landing__slide">
          <p className="landing__eyebrow">
            <img src="/icons/icon.svg" alt="" className="landing__logo-chip" />
            Pinit 소개
          </p>
          {/* 모든 슬라이드를 한 칸에 겹쳐 두고 보이는 것만 바꾼다. 가장 긴 슬라이드에 높이를 맞춰 넘길 때 아래 버튼이 튀지 않는다. */}
          <div className="landing__slide-stack">
            {slides.map((slide, index) => {
              const isActive = index === currentSlide
              return (
                <div
                  key={slide.title}
                  className="landing__slide-panel"
                  data-position={isActive ? 'current' : index < currentSlide ? 'before' : 'after'}
                  aria-hidden={!isActive || undefined}
                  inert={!isActive || undefined}
                >
                  <div className="landing__slide-header">
                    <h2>{slide.title}</h2>
                    <p>{slide.description}</p>
                  </div>
                  <ul className="landing__bullets">
                    {slide.bullets.map((bullet) => (
                      <li key={bullet}>
                        <span className="landing__dot" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                  {slide.ctaHref && slide.ctaLabel && (
                    <Link to={slide.ctaHref} className="landing__cta">
                      {slide.ctaLabel}
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="landing__pagination">
          <button type="button" onClick={goPrev} disabled={currentSlide === 0}>
            이전
          </button>
          <div className="landing__dots">
            {slides.map((slide, index) => (
              <button
                key={slide.title}
                type="button"
                className={currentSlide === index ? 'is-active' : ''}
                aria-current={currentSlide === index || undefined}
                onClick={() => goToSlide(index)}
              >
                <span className="sr-only">{index + 1}번째 슬라이드</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={goNext} disabled={currentSlide === slides.length - 1}>
            다음
          </button>
        </div>
      </section>
    </div>
  )
}

export default LandingPage
