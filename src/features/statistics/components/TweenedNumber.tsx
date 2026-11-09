import { useTweenedNumber } from '@shared/motion'

type Props = {
  value: number
  /** 소수 중간값을 받아 글자로 만든다. 끝값에서는 원래 표시와 같아야 한다. */
  format: (value: number) => string
}

/** 바뀐 숫자가 이전 값에서 새 값으로 240ms 동안 이어지게 보인다. */
const TweenedNumber = ({ value, format }: Props) => <>{format(useTweenedNumber(value))}</>

export default TweenedNumber
