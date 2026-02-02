import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
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
  const navigate = useNavigate()

  useEffect(() => {
    const token = getAccessToken()
    if (token) {
      navigate('/app/schedules', { replace: true })
    }
  }, [navigate])
  const goToSlide = (index: number) => setCurrentSlide(index)
  const goPrev = () => setCurrentSlide((prev) => Math.max(prev - 1, 0))
  const goNext = () => setCurrentSlide((prev) => Math.min(prev + 1, slides.length - 1))

  return (
    <div className="landing">
      <header className="landing__hero">
        <div className="landing__badge">
          <img src="/icons/icon.svg" alt="Pinit 아이콘" className="landing__logo-mark" />
          Pinit · 모바일 우선 플래너
        </div>
        <h1>
          Pinit으로
          <br />
          오늘의 집중 포인트를 고정하세요.
        </h1>
        <p>
          중요도와 난이도로 우선순위를 세우고, 의존 일정까지 한 번에 연결하는 모바일 최적화
          일정 관리 서비스입니다.
        </p>
        <div className="landing__actions">
          <Link to="/login" className="landing__action landing__action--primary">
            로그인하고 시작하기
          </Link>
          <p className="landing__hint">사용 중 불편한 점이 있다면, 언제든 chkun3109@gmail.com으로 문의해주세요.</p>
        </div>
        <div className="landing__glow landing__glow--one" />
        <div className="landing__glow landing__glow--two" />
      </header>

      <section className="landing__slider">
        <div className="landing__slide">
          <p className="landing__eyebrow">
            <img src="/icons/icon.svg" alt="" className="landing__logo-chip" />
            Pinit 소개
          </p>
          <div className="landing__slide-header">
            <h2>{slides[currentSlide].title}</h2>
            <p>{slides[currentSlide].description}</p>
          </div>
          <ul className="landing__bullets">
            {slides[currentSlide].bullets.map((bullet) => (
              <li key={bullet}>
                <span className="landing__dot" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
          {slides[currentSlide].ctaHref && slides[currentSlide].ctaLabel && (
            <Link to={slides[currentSlide].ctaHref} className="landing__cta">
              {slides[currentSlide].ctaLabel}
            </Link>
          )}
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
