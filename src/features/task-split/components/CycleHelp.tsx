import TermHelp from '@shared/components/common/TermHelp'
import { CYCLE } from '../utils/splitProposalLabels'

/** 순환(사이클)이 무엇이고 왜 막는지. 쪼개기 화면 어디서든 같은 설명을 쓴다. */
export default function CycleHelp() {
  return (
    <TermHelp label={CYCLE}>
      <strong>{CYCLE}이란?</strong>
      선후관계가 한 바퀴 돌아 처음으로 돌아오는 것이에요.
      <span className="term-help__example">A → B → C → A</span>
      이러면 서로 앞 작업이 끝나기를 기다리기만 해서 어느 것도 시작할 수 없어요. 그래서{' '}
      {CYCLE}이 생기는 연결은 고를 수 없어요.
    </TermHelp>
  )
}
