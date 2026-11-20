import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModules } from './support/mocks.mjs'

const load = loadModules()
const save = load('src/features/mind-map/model/saveMachine.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))
const CONFLICT = '다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 고쳐 주세요.'

/** 한 테스트 안에서 같은 저장 번호 공급자를 이어 쓰는 문맥 도우미. */
const contexts = () => {
  let i = 0
  const newSaveId = () => 's' + ++i
  return (confirmedJson) => ({ confirmedJson, newSaveId })
}

/** 사건을 차례로 보내고 마지막 상태와 마지막 사건의 효과를 돌려준다. `[사건, 확정된 나무]` 짝을 받는다. */
const run = (state, steps, ctx) => {
  let result = { state, effects: [] }
  for (const [event, confirmed] of steps) result = save.stepSave(result.state, event, ctx(confirmed))
  return { state: result.state, effects: plain(result.effects) }
}
const sends = (effects) => effects.filter((effect) => effect.type === 'send')
const now = { type: 'changed', when: 'now' }
const later = { type: 'changed', when: 'later' }

test('바뀌지 않았으면 보내지 않는다', () => {
  const ctx = contexts()
  const { state, effects } = run(save.initialSave(3, 'A'), [[now, 'A']], ctx)
  assert.deepEqual(sends(effects), [])
  assert.equal(save.saveStatus(state, 'A'), 'saved')
})

test('바로 저장은 곧바로, 나중 저장은 1초 뒤', () => {
  const ctx = contexts()
  const scheduled = run(save.initialSave(3, 'A'), [[later, 'B']], ctx)
  assert.deepEqual(scheduled.effects, [{ type: 'schedule', ms: 1000 }])
  const fired = run(scheduled.state, [[{ type: 'timer' }, 'B']], ctx)
  assert.deepEqual(fired.effects, [
    { type: 'send', saveId: 's1', expectedVersion: 3, json: 'B', keepalive: false },
  ])
  const immediate = run(save.initialSave(3, 'A'), [[now, 'B']], contexts())
  assert.deepEqual(immediate.effects, [
    { type: 'cancelSchedule' },
    { type: 'send', saveId: 's1', expectedVersion: 3, json: 'B', keepalive: false },
  ])
})

test('보내는 동안 여러 번 바뀌어도 응답 뒤 한 번만 보낸다', () => {
  const ctx = contexts()
  const first = run(save.initialSave(3, 'A'), [[now, 'B']], ctx)
  assert.deepEqual(sends(first.effects).map((x) => x.saveId), ['s1'])
  let state = first.state
  for (const [event, confirmed] of [[now, 'C'], [later, 'D'], [now, 'E']]) {
    const step = run(state, [[event, confirmed]], ctx)
    assert.deepEqual(sends(step.effects), [])
    state = step.state
  }
  assert.equal(state.queued, true)
  assert.equal(save.saveStatus(state, 'E'), 'saving')
  const second = run(state, [[{ type: 'succeeded', saveId: 's1', version: 4 }, 'E']], ctx)
  assert.deepEqual(second.effects, [
    { type: 'send', saveId: 's2', expectedVersion: 4, json: 'E', keepalive: false },
  ])
  assert.equal(second.state.queued, false)
  const done = run(second.state, [[{ type: 'succeeded', saveId: 's2', version: 5 }, 'E']], ctx)
  assert.deepEqual(done.effects, [])
  assert.equal(save.saveStatus(done.state, 'E'), 'saved')
  assert.equal(done.state.serverJson, 'E')
  assert.equal(done.state.version, 5)
})

test('늦게 온 다른 저장의 응답은 버린다', () => {
  const ctx = contexts()
  const { state } = run(
    save.initialSave(3, 'A'),
    [
      [now, 'B'],
      [{ type: 'lost', saveId: 's1', message: '연결이 끊겼어요.' }, 'B'],
      [{ type: 'retry' }, 'B'],
    ],
    ctx,
  )
  assert.equal(state.inFlight.saveId, 's2')
  for (const event of [
    { type: 'succeeded', saveId: 's1', version: 4 },
    { type: 'conflicted', saveId: 's1', latestVersion: 4, lastSaveId: null, message: CONFLICT },
    { type: 'rejected', saveId: 's1', message: '가지 글을 적어 주세요.' },
    { type: 'lost', saveId: 's1', message: '연결이 끊겼어요.' },
  ]) {
    const late = save.stepSave(state, event, ctx('B'))
    assert.deepEqual(plain(late.state), plain(state), event.type)
    assert.deepEqual(plain(late.effects), [], event.type)
  }
})

test('응답을 잃은 내 저장의 409는 version만 맞추고 이어서 저장한다', () => {
  const ctx = contexts()
  const lost = run(
    save.initialSave(3, 'A'),
    [
      [now, 'B'],
      [{ type: 'lost', saveId: 's1', message: '연결이 끊겼어요.' }, 'B'],
    ],
    ctx,
  )
  assert.equal(lost.state.failure, '연결이 끊겼어요.')
  assert.equal(save.saveStatus(lost.state, 'B'), 'failed')
  assert.deepEqual(plain(lost.state.unanswered), [['s1', 'B']])
  assert.deepEqual(lost.effects, [], '스스로 다시 보내지 않는다')
  const retried = run(lost.state, [[{ type: 'retry' }, 'C']], ctx)
  assert.deepEqual(retried.effects, [
    { type: 'send', saveId: 's2', expectedVersion: 3, json: 'C', keepalive: false },
  ])
  const adopted = run(
    retried.state,
    [[{ type: 'conflicted', saveId: 's2', latestVersion: 4, lastSaveId: 's1', message: CONFLICT }, 'C']],
    ctx,
  )
  assert.deepEqual(adopted.effects, [
    { type: 'send', saveId: 's3', expectedVersion: 4, json: 'C', keepalive: false },
  ])
  assert.equal(adopted.state.reloading, false)
  assert.equal(adopted.state.failure, null)
  assert.deepEqual(plain(adopted.state.unanswered), [])
})

test('응답을 잃은 저장이 둘이고 409가 먼저 것을 가리키면 그 나무를 서버의 것으로 본다', () => {
  const ctx = contexts()
  const lost = { type: 'lost', message: '연결이 끊겼어요.' }
  const { state, effects } = run(
    save.initialSave(3, 'A'),
    [
      [now, 'B'],
      [{ ...lost, saveId: 's1' }, 'B'],
      [{ type: 'retry' }, 'C'],
      [{ ...lost, saveId: 's2' }, 'C'],
      [{ type: 'retry' }, 'D'],
      [{ type: 'conflicted', saveId: 's3', latestVersion: 4, lastSaveId: 's1', message: CONFLICT }, 'D'],
    ],
    ctx,
  )
  assert.equal(state.serverJson, 'B')
  assert.equal(state.version, 4)
  assert.deepEqual(plain(state.unanswered), [])
  assert.deepEqual(effects, [
    { type: 'send', saveId: 's4', expectedVersion: 4, json: 'D', keepalive: false },
  ])
})

test('그 번호의 나무가 지금 확정된 나무와 같으면 더 보내지 않는다', () => {
  const ctx = contexts()
  const { state, effects } = run(
    save.initialSave(3, 'A'),
    [
      [now, 'B'],
      [{ type: 'lost', saveId: 's1', message: '연결이 끊겼어요.' }, 'B'],
      [{ type: 'retry' }, 'B'],
      [{ type: 'conflicted', saveId: 's2', latestVersion: 4, lastSaveId: 's1', message: CONFLICT }, 'B'],
    ],
    ctx,
  )
  assert.deepEqual(effects, [])
  assert.equal(save.saveStatus(state, 'B'), 'saved')
  assert.equal(state.version, 4)
  assert.equal(state.serverJson, 'B')
})

test('응답을 잃은 저장이 있으면 서버의 나무로 되돌려도 보낸다', () => {
  const ctx = contexts()
  const lost = run(
    save.initialSave(3, 'A'),
    [
      [now, 'B'],
      [{ type: 'lost', saveId: 's1', message: '연결이 끊겼어요.' }, 'B'],
    ],
    ctx,
  )
  // B가 서버에 들어갔는지 모르므로 A로 되돌린 화면은 아직 저장된 것이 아니다.
  assert.equal(save.isDirty(lost.state, 'A'), true)
  assert.equal(save.saveStatus(lost.state, 'A'), 'failed')
  const retried = run(lost.state, [[{ type: 'retry' }, 'A']], ctx)
  assert.deepEqual(retried.effects, [
    { type: 'send', saveId: 's2', expectedVersion: 3, json: 'A', keepalive: false },
  ])
  const adopted = run(
    retried.state,
    [[{ type: 'conflicted', saveId: 's2', latestVersion: 4, lastSaveId: 's1', message: CONFLICT }, 'A']],
    ctx,
  )
  assert.deepEqual(adopted.effects, [
    { type: 'send', saveId: 's3', expectedVersion: 4, json: 'A', keepalive: false },
  ])
})

test('다른 번호의 409는 한 번 안내하고 다시 불러온다', () => {
  const ctx = contexts()
  const conflicted = run(
    save.initialSave(3, 'A'),
    [
      [now, 'B'],
      [{ type: 'conflicted', saveId: 's1', latestVersion: 7, lastSaveId: null, message: CONFLICT }, 'B'],
    ],
    ctx,
  )
  assert.deepEqual(conflicted.effects, [{ type: 'reload', message: CONFLICT }])
  assert.equal(conflicted.state.reloading, true)
  const changed = run(conflicted.state, [[now, 'C'], [{ type: 'timer' }, 'C'], [{ type: 'retry' }, 'C']], ctx)
  assert.deepEqual(sends(changed.effects), [])
  assert.deepEqual(run(conflicted.state, [[now, 'C']], ctx).effects.filter((x) => x.type !== 'cancelSchedule'), [])
  assert.deepEqual(run(conflicted.state, [[{ type: 'leave' }, 'C']], ctx).effects, [], '덮어쓰지 않는다')
  const reloaded = run(changed.state, [[{ type: 'reloaded', version: 7, json: 'R' }, 'R']], ctx)
  assert.deepEqual(plain(reloaded.state), plain(save.initialSave(7, 'R')))
  assert.equal(save.saveStatus(reloaded.state, 'R'), 'saved')
})

test('400은 저장하지 못함과 이유이고 응답을 잃은 저장이 아니다', () => {
  const ctx = contexts()
  const rejected = run(
    save.initialSave(3, 'A'),
    [
      [now, 'B'],
      [{ type: 'rejected', saveId: 's1', message: '가지 글을 적어 주세요.' }, 'B'],
    ],
    ctx,
  )
  assert.deepEqual(rejected.effects, [], '스스로 다시 보내지 않는다')
  assert.equal(rejected.state.failure, '가지 글을 적어 주세요.')
  assert.equal(rejected.state.inFlight, null)
  assert.deepEqual(plain(rejected.state.unanswered), [])
  assert.equal(save.saveStatus(rejected.state, 'B'), 'failed')

  const queued = run(
    save.initialSave(3, 'A'),
    [
      [now, 'B'],
      [later, 'C'],
      [{ type: 'rejected', saveId: 's1', message: '가지 글을 적어 주세요.' }, 'C'],
    ],
    contexts(),
  )
  assert.deepEqual(queued.effects, [
    { type: 'send', saveId: 's2', expectedVersion: 3, json: 'C', keepalive: false },
  ])
  assert.equal(queued.state.queued, false)
  assert.deepEqual(plain(queued.state.unanswered), [])
})

test('떠날 때: 바뀐 것이 있으면 keepalive로 보낸다', () => {
  const ctx = contexts()
  const { state, effects } = run(save.initialSave(3, 'A'), [[{ type: 'leave' }, 'B']], ctx)
  assert.deepEqual(effects, [
    { type: 'send', saveId: 's1', expectedVersion: 3, json: 'B', keepalive: true },
  ])
  // 응답을 받지 않는 저장이라 응답을 잃은 저장으로 둔다. 같은 version을 기대했다.
  assert.deepEqual(plain(state), { ...plain(save.initialSave(3, 'A')), unanswered: [['s1', 'B']] })
  assert.deepEqual(run(save.initialSave(3, 'A'), [[{ type: 'leave' }, 'A']], ctx).effects, [])
})

test('떠날 때 보낸 저장이 들어갔으면, 페이지가 돌아와 다음 저장이 받은 충돌은 내 것으로 알아본다', () => {
  const ctx = contexts()
  const left = run(save.initialSave(3, 'A'), [[{ type: 'leave' }, 'B']], ctx)
  // 돌아온 페이지(bfcache)에서 아직 저장된 것이 아니다.
  assert.equal(save.isDirty(left.state, 'B'), true)
  const next = run(left.state, [[now, 'C']], ctx)
  assert.deepEqual(sends(next.effects), [
    { type: 'send', saveId: 's2', expectedVersion: 3, json: 'C', keepalive: false },
  ])
  const resumed = run(
    next.state,
    [[{ type: 'conflicted', saveId: 's2', latestVersion: 4, lastSaveId: 's1', message: CONFLICT }, 'C']],
    ctx,
  )
  assert.deepEqual(resumed.effects, [
    { type: 'send', saveId: 's3', expectedVersion: 4, json: 'C', keepalive: false },
  ])
  assert.equal(resumed.state.reloading, false)
})

test('창이 숨으면 남은 변경을 바로 보내고(keepalive) 그 응답을 받는다', () => {
  const ctx = contexts()
  const scheduled = run(save.initialSave(3, 'A'), [[later, 'B']], ctx)
  const hidden = run(scheduled.state, [[{ type: 'hidden' }, 'B']], ctx)
  assert.deepEqual(hidden.effects, [
    { type: 'cancelSchedule' },
    { type: 'send', saveId: 's1', expectedVersion: 3, json: 'B', keepalive: true },
  ])
  assert.equal(save.saveStatus(hidden.state, 'B'), 'saving')
  const done = run(hidden.state, [[{ type: 'succeeded', saveId: 's1', version: 4 }, 'B']], ctx)
  assert.equal(save.saveStatus(done.state, 'B'), 'saved')
  assert.equal(done.state.version, 4)
  // 이어 탭이 닫혀도(pagehide) 보내는 중이라 또 보내지 않는다.
  assert.deepEqual(run(hidden.state, [[{ type: 'leave' }, 'B']], ctx).effects, [])
  // 바뀐 것이 없으면 보내지 않는다.
  assert.deepEqual(sends(run(save.initialSave(3, 'A'), [[{ type: 'hidden' }, 'A']], ctx).effects), [])
  // 보내는 중이면 응답 뒤로 미룬다.
  const busy = run(save.initialSave(3, 'A'), [[now, 'B'], [{ type: 'hidden' }, 'C']], contexts())
  assert.deepEqual(sends(busy.effects), [])
  assert.equal(busy.state.queued, true)
})

test('창이 숨을 때 64KB를 넘는 본문은 keepalive 없이 보낸다', () => {
  const huge = '{"x":"' + 'a'.repeat(65536) + '"}'
  const { effects } = run(save.initialSave(3, 'A'), [[{ type: 'hidden' }, huge]], contexts())
  assert.deepEqual(sends(effects).map((effect) => effect.keepalive), [false])
})

test('다른 저장이 가는 중에 떠나면 keepalive로 보내지 않는다', () => {
  // 가는 중인 저장이 성공했다고 짐작해 version+1로 보내면, 그사이 다른 곳이 그 version을 만들었을 때 말없이 덮는다.
  const ctx = contexts()
  const sending = run(save.initialSave(3, 'A'), [[now, 'B']], ctx)
  assert.deepEqual(run(sending.state, [[{ type: 'leave' }, 'C']], ctx).effects, [])
  assert.deepEqual(run(sending.state, [[{ type: 'leave' }, 'B']], ctx).effects, [])
})

test('떠날 때: 64KB를 넘는 본문은 보내지 않는다', () => {
  const huge = '{"x":"' + 'a'.repeat(65536) + '"}'
  assert.deepEqual(run(save.initialSave(3, 'A'), [[{ type: 'leave' }, huge]], contexts()).effects, [])
  // 바이트로 센다: 글자 수는 한도 안이어도 UTF-8로 넘으면 보내지 않는다.
  const korean = '{"x":"' + '가'.repeat(22000) + '"}'
  assert.deepEqual(run(save.initialSave(3, 'A'), [[{ type: 'leave' }, korean]], contexts()).effects, [])
  // 딱 한도인 본문은 보낸다.
  const overhead = save.requestBody('s1', 3, '{"x":""}').length
  const exact = '{"x":"' + 'a'.repeat(save.KEEPALIVE_LIMIT_BYTES - overhead) + '"}'
  assert.equal(new TextEncoder().encode(save.requestBody('s1', 3, exact)).length, 65536)
  assert.equal(sends(run(save.initialSave(3, 'A'), [[{ type: 'leave' }, exact]], contexts()).effects).length, 1)
})

test('본문은 JSON.stringify와 같은 바이트다', () => {
  assert.equal(
    save.requestBody('s1', 3, '{"id":"r"}'),
    JSON.stringify({ expectedVersion: 3, saveId: 's1', root: { id: 'r' } }),
  )
})

test('창이 다시 활성화될 때', () => {
  assert.equal(save.focusAction({ editing: true, dirty: true, inFlight: false }), 'none')
  assert.equal(save.focusAction({ editing: false, dirty: true, inFlight: false }), 'save')
  assert.equal(save.focusAction({ editing: false, dirty: false, inFlight: true }), 'none')
  assert.equal(save.focusAction({ editing: false, dirty: false, inFlight: false }), 'refetch')
})

test('상태 문구', () => {
  assert.deepEqual(plain(save.SAVE_LABELS), { saved: '저장됨', saving: '저장 중…', failed: '저장하지 못함' })
  assert.equal(save.SAVE_DEBOUNCE_MS, 1000)
  assert.equal(save.CURSOR_DEBOUNCE_MS, 800)
  assert.equal(save.SAVE_TIMEOUT_MS, 15000)
  assert.equal(save.KEEPALIVE_LIMIT_BYTES, 65536)
})
