/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Location, NavigateFunction } from 'react-router-dom'
import { useToast } from '@contexts/ToastContext'
import { acknowledgeOnboarding, fetchOnboarding } from '../api/onboarding'
import SpotlightTour from '../components/SpotlightTour'
import type { OnboardingResponse } from '../types/onboarding'
import { buildTourSteps, shouldEndTour } from '../utils/tour'
import type { TourStep } from '../utils/tour'

type OnboardingContextValue = {
  response: OnboardingResponse | null
  isLoading: boolean
  error: string | null
  reload: () => void
  /** keys 순서대로 투어를 시작한다. 응답이 없거나 보여 줄 단계가 없으면 아무것도 하지 않는다. */
  startTour: (keys: readonly string[]) => void
}

type ActiveTour = {
  steps: TourStep[]
  index: number
  /** 투어를 시작한 위치(pathname + search). 끝나면 여기로 돌아간다. */
  origin: string
  /** 확인으로 보낼 개정판. 투어를 만든 응답의 revision이다. */
  revision: number
}

const ACK_FAILED_MESSAGE = '온보딩 확인을 저장하지 못했어요. 다음에 다시 안내할게요.'
const LOAD_FAILED_MESSAGE = '온보딩 안내를 불러오지 못했어요.'

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

/**
 * 앱에 들어올 때 GET /v2/onboarding을 한 번 불러와 공유하고, 서버가 준 pendingTour가 있으면 투어를 띄운다.
 * FE는 어떤 기능이 있는지, 언제 다시 보여 줄지 모른다. 응답을 그대로 따른다(ADR-0017 §7).
 */
export const OnboardingTourProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const { addToast } = useToast()
  const [response, setResponse] = useState<OnboardingResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tour, setTour] = useState<ActiveTour | null>(null)

  // 이벤트 처리기와 비동기 콜백이 최신 값을 쓰도록 ref로 들고 있는다. 렌더링 중에는 읽지 않는다.
  const tourRef = useRef<ActiveTour | null>(null)
  const expectedPathRef = useRef<string | null>(null)
  const locationRef = useRef<Location>(location)
  const navigateRef = useRef<NavigateFunction>(navigate)
  const lastPathnameRef = useRef(location.pathname)
  const mountedRef = useRef(false)
  const didFetchRef = useRef(false)

  useLayoutEffect(() => {
    locationRef.current = location
    navigateRef.current = navigate
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // 뒤로 가기 등으로 투어 도중 앱 화면을 떠났으면 건너뛴 것으로 보고 확인을 보낸다.
      const active = tourRef.current
      if (!active) return
      tourRef.current = null
      acknowledgeOnboarding(active.revision).catch(() => undefined)
    }
  }, [])

  const commitTour = useCallback((next: ActiveTour | null) => {
    tourRef.current = next
    setTour(next)
  }, [])

  /** 단계에 들어간다. 그 단계의 route가 지금 경로와 다르면 history를 늘리지 않고 이동한다. */
  const enterStep = useCallback(
    (next: ActiveTour) => {
      const step = next.steps[next.index]
      expectedPathRef.current = step.route
      commitTour(next)
      if (locationRef.current.pathname !== step.route) {
        navigateRef.current(step.route, { replace: true })
      }
    },
    [commitTour],
  )

  /** 완료와 건너뛰기 모두 이 개정판을 확인 처리한다. restore면 시작 위치로 돌아간다. */
  const finishTour = useCallback(
    ({ restore }: { restore: boolean }) => {
      const active = tourRef.current
      if (!active) return
      expectedPathRef.current = null
      commitTour(null)

      acknowledgeOnboarding(active.revision)
        .then(() => {
          if (!mountedRef.current) return
          setResponse((prev) =>
            prev
              ? {
                  ...prev,
                  acknowledgedRevision: Math.max(prev.acknowledgedRevision, active.revision),
                  pendingTour: [],
                }
              : prev,
          )
        })
        .catch((err) => {
          console.warn('[onboarding] 확인 저장 실패:', err)
          addToast(ACK_FAILED_MESSAGE, 'error')
        })

      if (restore) {
        const current = locationRef.current
        if (`${current.pathname}${current.search}` !== active.origin) {
          navigateRef.current(active.origin, { replace: true })
        }
      }
    },
    [addToast, commitTour],
  )

  const beginTour = useCallback(
    (source: OnboardingResponse, keys: readonly string[]) => {
      if (tourRef.current) return
      const steps = buildTourSteps(source, keys)
      if (steps.length === 0) return
      const current = locationRef.current
      enterStep({ steps, index: 0, origin: `${current.pathname}${current.search}`, revision: source.revision })
    },
    [enterStep],
  )

  const loadResponse = useCallback(async (): Promise<OnboardingResponse | null> => {
    try {
      const data = await fetchOnboarding()
      if (!mountedRef.current) return null
      setResponse(data)
      setError(null)
      return data
    } catch (err) {
      // 백엔드보다 FE가 먼저 배포돼도 앱이 깨지지 않게, 실패하면 투어를 띄우지 않고 오류만 기록한다.
      if (mountedRef.current) setError(err instanceof Error && err.message ? err.message : LOAD_FAILED_MESSAGE)
      return null
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (didFetchRef.current) return
    didFetchRef.current = true
    loadResponse().then((data) => {
      if (data && data.pendingTour.length > 0) beginTour(data, data.pendingTour)
    })
  }, [loadResponse, beginTour])

  // 투어가 기대하지 않은 경로로 바뀌면(브라우저 뒤로 가기 등) 건너뛰기로 끝낸다. 경로는 되돌리지 않는다.
  useEffect(() => {
    const previous = lastPathnameRef.current
    lastPathnameRef.current = location.pathname
    if (previous === location.pathname || !tourRef.current) return
    if (shouldEndTour(expectedPathRef.current, location.pathname)) finishTour({ restore: false })
  }, [location.pathname, finishTour])

  const reload = useCallback(() => {
    setIsLoading(true)
    setError(null)
    void loadResponse()
  }, [loadResponse])

  const startTour = useCallback(
    (keys: readonly string[]) => {
      if (response) beginTour(response, keys)
    },
    [response, beginTour],
  )

  const handlePrev = useCallback(() => {
    const active = tourRef.current
    if (active && active.index > 0) enterStep({ ...active, index: active.index - 1 })
  }, [enterStep])

  const handleNext = useCallback(() => {
    const active = tourRef.current
    if (!active) return
    if (active.index >= active.steps.length - 1) {
      finishTour({ restore: true })
      return
    }
    enterStep({ ...active, index: active.index + 1 })
  }, [enterStep, finishTour])

  const handleSkip = useCallback(() => finishTour({ restore: true }), [finishTour])

  const value = useMemo(
    () => ({ response, isLoading, error, reload, startTour }),
    [response, isLoading, error, reload, startTour],
  )

  const step = tour ? tour.steps[tour.index] : null

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {tour && step && (
        <SpotlightTour
          step={step}
          index={tour.index}
          total={tour.steps.length}
          onPrev={handlePrev}
          onNext={handleNext}
          onSkip={handleSkip}
        />
      )}
    </OnboardingContext.Provider>
  )
}

export const useOnboarding = () => {
  const ctx = useContext(OnboardingContext)
  if (!ctx) {
    throw new Error('OnboardingContext not found')
  }
  return ctx
}
