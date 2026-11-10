import { useTweenedNumber } from '@shared/motion'

const rounded = (value: number) => String(Math.round(value))

type Props = {
  value: number
  /** Turns an in-between value into text; at the end value it must match the plain display. Rounds by default. */
  format?: (value: number) => string
}

/** A number that glides from its previous value to the new one when it changes while the person watches. */
const TweenedNumber = ({ value, format = rounded }: Props) => <>{format(useTweenedNumber(value))}</>

export default TweenedNumber
