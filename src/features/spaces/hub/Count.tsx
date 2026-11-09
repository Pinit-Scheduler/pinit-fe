import { useTweenedNumber } from '@shared/motion'

/**
 * A server count that glides to its new value when it changes while the person watches
 * (a task completed elsewhere, an assignment). The first value shows as is.
 */
export default function Count({ value }: { value: number }) {
  return <>{Math.round(useTweenedNumber(value))}</>
}
