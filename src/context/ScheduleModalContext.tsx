import { createContext } from 'react'
import type useScheduleModal from '../hooks/useScheduleModal'

export const ScheduleModalContext = createContext<ReturnType<typeof useScheduleModal> | null>(null)

