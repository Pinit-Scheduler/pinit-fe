export const SAVE_DEBOUNCE_MS = 1000
export const CURSOR_DEBOUNCE_MS = 800
export const SAVE_TIMEOUT_MS = 15000
export const KEEPALIVE_LIMIT_BYTES = 65536

export type SaveStatus = 'saved' | 'saving' | 'failed'

export const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: '저장됨',
  saving: '저장 중…',
  failed: '저장하지 못함',
}

export type InFlight = { saveId: string; json: string; expectedVersion: number }
/**
 * `serverJson`은 `version`의 서버 나무로 아는 것이다. `unanswered`는 응답을 받지 못한 저장(번호, 나무)이고
 * (응답을 잃은 저장과 탭을 닫을 때 응답을 기다리지 않고 보낸 저장), 모두 같은 `version`을 기대했으므로
 * 서버에 들어간 것은 많아야 하나다.
 */
export type SaveState = {
  version: number
  serverJson: string
  inFlight: InFlight | null
  unanswered: [saveId: string, json: string][]
  queued: boolean
  failure: string | null
  reloading: boolean
}
export type SaveEvent =
  | { type: 'changed'; when: 'now' | 'later' }
  | { type: 'timer' }
  | { type: 'retry' }
  | { type: 'leave' }
  | { type: 'hidden' }
  | { type: 'succeeded'; saveId: string; version: number }
  | { type: 'conflicted'; saveId: string; latestVersion: number; lastSaveId: string | null; message: string }
  | { type: 'rejected'; saveId: string; message: string }
  | { type: 'lost'; saveId: string; message: string }
  | { type: 'reloaded'; version: number; json: string }
export type SaveEffect =
  | { type: 'send'; saveId: string; expectedVersion: number; json: string; keepalive: boolean }
  | { type: 'schedule'; ms: number }
  | { type: 'cancelSchedule' }
  | { type: 'reload'; message: string }
export type SaveContext = { confirmedJson: string; newSaveId: () => string }
type Step = { state: SaveState; effects: SaveEffect[] }

export const initialSave = (version: number, json: string): SaveState => ({
  version,
  serverJson: json,
  inFlight: null,
  unanswered: [],
  queued: false,
  failure: null,
  reloading: false,
})

/** `json`은 `treeJson`의 결과다. `JSON.stringify({ expectedVersion, saveId, root })`와 같은 바이트다. */
export const requestBody = (saveId: string, expectedVersion: number, json: string): string =>
  '{"expectedVersion":' + expectedVersion + ',"saveId":"' + saveId + '","root":' + json + '}'

/**
 * 보내는 중인 저장 말고 더 보낼 것이 있는가. 응답을 잃은 저장이 있으면 서버의 나무를 모르므로,
 * 화면을 `serverJson`으로 되돌렸어도 아직 저장된 것이 아니다.
 */
export const isDirty = (state: SaveState, confirmedJson: string): boolean =>
  state.inFlight
    ? confirmedJson !== state.inFlight.json
    : confirmedJson !== state.serverJson || state.unanswered.length > 0

export const saveStatus = (state: SaveState, confirmedJson: string): SaveStatus => {
  if (state.inFlight) return 'saving'
  if (state.failure !== null) return 'failed'
  return isDirty(state, confirmedJson) ? 'saving' : 'saved'
}

export const focusAction = (input: {
  editing: boolean
  dirty: boolean
  inFlight: boolean
}): 'none' | 'save' | 'refetch' => {
  if (input.editing) return 'none'
  if (input.dirty) return 'save'
  if (input.inFlight) return 'none'
  return 'refetch'
}

const utf8Length = (text: string): number => new TextEncoder().encode(text).length

/** 탭을 닫는 순간에도 끝까지 보내 주는 전송(keepalive)에 실을 수 있는 본문인가. */
const fitsKeepalive = (saveId: string, expectedVersion: number, json: string): boolean =>
  utf8Length(requestBody(saveId, expectedVersion, json)) <= KEEPALIVE_LIMIT_BYTES

/**
 * 한 번에 하나만 보낸다. 보내는 중이면 응답 뒤로 미룬다. `keepalive`이면 본문이 한도 안일 때
 * 탭이 닫혀도 끝까지 가는 전송으로 보낸다(응답은 그대로 받는다).
 */
const trySend = (state: SaveState, ctx: SaveContext, keepalive = false): Step => {
  if (state.reloading) return { state, effects: [] }
  if (state.inFlight) return { state: { ...state, queued: true }, effects: [] }
  if (!isDirty(state, ctx.confirmedJson)) return { state: { ...state, failure: null }, effects: [] }
  const inFlight = { saveId: ctx.newSaveId(), json: ctx.confirmedJson, expectedVersion: state.version }
  return {
    state: { ...state, inFlight },
    effects: [
      { type: 'send', ...inFlight, keepalive: keepalive && fitsKeepalive(inFlight.saveId, state.version, inFlight.json) },
    ],
  }
}

/** 묶여 있던 변경이 있으면 풀고 보낸다. */
const flushQueued = (state: SaveState, ctx: SaveContext): Step =>
  state.queued ? trySend({ ...state, queued: false }, ctx) : { state, effects: [] }

/**
 * 탭을 닫을 때. 보내는 중인 저장이 있으면 보내지 않는다. 그 저장이 성공했다고 짐작한 version은
 * 그사이 다른 곳이 만든 version과 같을 수 있어 말없이 덮는다. 남은 변경은 64KB 한도처럼 잃는다.
 * 보낸 저장의 응답은 기다리지 않으므로 응답을 받지 못한 저장으로 둔다. 페이지가 살아 돌아오면(bfcache)
 * 다음 저장이 받은 충돌의 저장 번호로 이 저장이 들어갔는지 안다.
 */
const leave = (state: SaveState, ctx: SaveContext): Step => {
  if (state.reloading || state.inFlight || !isDirty(state, ctx.confirmedJson)) return { state, effects: [] }
  const saveId = ctx.newSaveId()
  if (!fitsKeepalive(saveId, state.version, ctx.confirmedJson)) return { state, effects: [] }
  return {
    state: { ...state, unanswered: [...state.unanswered, [saveId, ctx.confirmedJson]] },
    effects: [{ type: 'send', saveId, expectedVersion: state.version, json: ctx.confirmedJson, keepalive: true }],
  }
}

export const stepSave = (state: SaveState, event: SaveEvent, ctx: SaveContext): Step => {
  switch (event.type) {
    case 'changed':
      if (event.when === 'now') {
        const sent = trySend(state, ctx)
        return { state: sent.state, effects: [{ type: 'cancelSchedule' }, ...sent.effects] }
      }
      if (state.inFlight) return { state: { ...state, queued: true }, effects: [] }
      return { state, effects: [{ type: 'schedule', ms: SAVE_DEBOUNCE_MS }] }
    case 'timer':
    case 'retry':
      return trySend(state, ctx)
    case 'hidden': {
      // 창이 숨으면(탭 바꾸기, 폰에서 앱 나가기) 기다리던 변경을 바로 보낸다. 숨은 채로 닫히거나 끝날 수 있다.
      const sent = trySend(state, ctx, true)
      return { state: sent.state, effects: [{ type: 'cancelSchedule' }, ...sent.effects] }
    }
    case 'leave':
      return leave(state, ctx)
    case 'reloaded':
      return { state: initialSave(event.version, event.json), effects: [] }
  }
  // 응답은 지금 보내는 중인 저장의 것만 받는다. 늦게 온 다른 저장의 응답은 버린다.
  const inFlight = state.inFlight
  if (!inFlight || inFlight.saveId !== event.saveId) return { state, effects: [] }
  switch (event.type) {
    case 'succeeded':
      return flushQueued(
        { ...state, version: event.version, serverJson: inFlight.json, unanswered: [], failure: null, inFlight: null },
        ctx,
      )
    case 'conflicted': {
      const mine = state.unanswered.find(([saveId]) => saveId === event.lastSaveId)
      if (!mine) {
        return {
          state: { ...state, reloading: true, inFlight: null },
          effects: [{ type: 'reload', message: event.message }],
        }
      }
      // 응답을 잃은 내 저장이 들어갔고 그 뒤로 아무도 고치지 않았다.
      return trySend(
        {
          ...state,
          version: event.latestVersion,
          serverJson: mine[1],
          unanswered: [],
          failure: null,
          inFlight: null,
          queued: false,
        },
        ctx,
      )
    }
    case 'rejected':
      return flushQueued({ ...state, inFlight: null, failure: event.message }, ctx)
    case 'lost':
      return {
        state: {
          ...state,
          unanswered: [...state.unanswered, [event.saveId, inFlight.json]],
          inFlight: null,
          failure: event.message,
          queued: false,
        },
        effects: [],
      }
  }
}
