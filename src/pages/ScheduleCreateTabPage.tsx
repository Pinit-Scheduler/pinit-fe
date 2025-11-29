import { useContext, useEffect } from 'react'
import { ScheduleModalContext } from '../context/ScheduleModalContext'

const ScheduleCreateTabPage = () => {
  const modal = useContext(ScheduleModalContext)

  useEffect(() => {
    modal?.openCreate()
    return () => modal?.closeCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // modal을 의존성에서 제거 - 컴포넌트 마운트 시에만 실행

  return null
}

export default ScheduleCreateTabPage
