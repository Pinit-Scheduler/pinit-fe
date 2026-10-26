import { useId, useState } from 'react'
import StatusPanel from '@shared/components/common/StatusPanel'
import { useOnboarding } from '../context/OnboardingTourContext'
import type { GuideGroup, OnboardingFeature, OnboardingGuide } from '../types/onboarding'
import { allTourKeys, isFeatureNew } from '../utils/tour'
import './OnboardingGuidePage.css'

type GuideCardProps = {
  feature: OnboardingFeature & { guide: OnboardingGuide }
  isNew: boolean
  isOpen: boolean
  onToggle: () => void
  onShowTour: () => void
}

const GroupHeading = ({ group }: { group: GuideGroup }) =>
  group.heading ? <h4 className="onboarding-guide__group-heading">{group.heading}</h4> : null

const GuideCard = ({ feature, isNew, isOpen, onToggle, onShowTour }: GuideCardProps) => {
  const panelId = useId()
  const { guide, tour } = feature

  return (
    <article className={['onboarding-guide__card', isOpen && 'is-open'].filter(Boolean).join(' ')}>
      <h2 className="onboarding-guide__card-heading">
        <button
          type="button"
          className="onboarding-guide__toggle"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="onboarding-guide__card-title">
            {feature.title}
            {isNew && <span className="onboarding-guide__new">NEW</span>}
          </span>
          {tour?.purpose && <span className="onboarding-guide__purpose">{tour.purpose}</span>}
          <span className="onboarding-guide__caret" aria-hidden>
            ›
          </span>
        </button>
      </h2>
      <div id={panelId} className="onboarding-guide__panel" hidden={!isOpen}>
        <section className="onboarding-guide__section">
          <h3>동작 방식</h3>
          {guide.behavior.map((group, index) => (
            <div key={index} className="onboarding-guide__group">
              <GroupHeading group={group} />
              {group.items.map((item, itemIndex) => (
                <p key={itemIndex}>{item}</p>
              ))}
            </div>
          ))}
        </section>
        <section className="onboarding-guide__section">
          <h3>동작 원리</h3>
          {guide.principle.map((group, index) => (
            <div key={index} className="onboarding-guide__group">
              <GroupHeading group={group} />
              <ul>
                {group.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        <section className="onboarding-guide__section">
          <h3>사용 방법</h3>
          {guide.usage.map((group, index) => (
            <div key={index} className="onboarding-guide__group">
              <GroupHeading group={group} />
              <ol>
                {group.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ol>
            </div>
          ))}
        </section>
        {tour && (
          <button type="button" className="onboarding-guide__show" onClick={onShowTour}>
            화면에서 보기
          </button>
        )}
      </div>
    </article>
  )
}

const hasGuide = (feature: OnboardingFeature): feature is OnboardingFeature & { guide: OnboardingGuide } =>
  feature.guide !== null

/** 설정 → 온보딩. 백엔드가 준 기능마다 동작 방식·원리·사용 방법을 펼쳐 볼 수 있다(ADR-0017 §7). */
const OnboardingGuidePage = () => {
  const { response, isLoading, error, reload, startTour } = useOnboarding()
  const [openKeys, setOpenKeys] = useState<string[]>([])

  if (isLoading) {
    return <StatusPanel variant="loading" title="온보딩 안내를 불러오는 중" />
  }

  if (error || !response) {
    return (
      <StatusPanel
        variant="error"
        title="온보딩 안내를 불러오지 못했어요"
        description={error ?? undefined}
        action={
          <button type="button" className="onboarding-guide__retry" onClick={reload}>
            다시 시도
          </button>
        }
      />
    )
  }

  const tourKeys = allTourKeys(response)
  const features = response.features.filter(hasGuide)

  const toggle = (key: string) =>
    setOpenKeys((prev) => (prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key]))

  return (
    <section className="onboarding-guide">
      <header className="onboarding-guide__header">
        <p className="onboarding-guide__eyebrow">도움말</p>
        <h1 className="onboarding-guide__title">핀잇 사용 안내</h1>
        <p className="onboarding-guide__description">
          기능마다 무엇을 하는지, 어떤 원리로 동작하는지, 어떻게 쓰는지 정리했어요.
        </p>
        {tourKeys.length > 0 && (
          <button type="button" className="onboarding-guide__replay" onClick={() => startTour(tourKeys)}>
            투어 다시 보기
          </button>
        )}
      </header>

      <div className="onboarding-guide__list">
        {features.map((feature) => (
          <GuideCard
            key={feature.key}
            feature={feature}
            isNew={isFeatureNew(response, feature)}
            isOpen={openKeys.includes(feature.key)}
            onToggle={() => toggle(feature.key)}
            onShowTour={() => startTour([feature.key])}
          />
        ))}
      </div>
    </section>
  )
}

export default OnboardingGuidePage
