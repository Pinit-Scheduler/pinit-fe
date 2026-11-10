import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { safeBackground } from '@shared/routing/routeSurfaceState'
import { createAffiliationFor, type CreateAffiliation } from './scope'
import { useSpaces } from './store'

/** 만들기 화면이 열릴 때 한 번 정한 스페이스·프로젝트. 화면 뒤의 목록이 바뀌어도 입력 중인 값은 그대로 둔다. */
export function useCreateAffiliation(): CreateAffiliation {
  const location = useLocation()
  const workspace = useSpaces()
  const [affiliation] = useState(() =>
    createAffiliationFor(
      safeBackground(location.state),
      location.search,
      workspace,
    ),
  )
  return affiliation
}
