import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useToast } from '@shared/contexts/ToastContext'
import { classifySaveError, saveMindMap } from '../api/mindMapApi'
import type { MindMapResponse, MindMapSaveRequest } from '../api/mindMapApi'
import { mindMapAccount, refreshMindMap, rememberMindMap } from '../api/mindMapQuery'
import { focusAction, initialSave, isDirty, SAVE_TIMEOUT_MS, stepSave } from '../model/saveMachine'
import type { SaveEffect, SaveEvent, SaveState } from '../model/saveMachine'
import { treeJson } from '../model/tree'
import type { MindMapNode } from '../model/tree'

/** 페이지가 저장기에 알려 주는 것. 늘 지금의 편집 상태를 읽는다. */
export type SaverView = {
  /** 서버에 보낼 확정된 나무(`treeJson`). */
  confirmedJson: () => string
  /** 쓰던 글을 확정한 것으로 친 나무(`treeJson`). 떠날 때 보낸다. */
  leaveJson: () => string
  isEditing: () => boolean
  /** 충돌: 안내하고 최신 맵을 다시 읽어 `adopt`로 넘긴다. */
  reload: (message: string) => void
  /** 창이 다시 활성화됐고 보낼 것이 없다: 다시 읽는다. 돌려준 약속이 끝날 때까지 다시 부르지 않는다. */
  refetch: () => Promise<unknown> | void
}

export type SaverDeps = {
  save: (
    request: MindMapSaveRequest,
    options: { signal: AbortSignal; keepalive: boolean },
  ) => Promise<{ version: number }>
  remember: (update: (previous: MindMapResponse | undefined) => MindMapResponse | undefined) => void
  /** 페이지가 사라진 뒤에 온 충돌: 안내하고 카드가 다시 읽게 한다. */
  orphanConflict: (message: string) => void
  /** 페이지가 사라진 뒤의 저장이 실패했다(응답을 잃었거나 거부됐다): 마지막 변경을 저장하지 못했다고 안내한다. */
  orphanFailure: (message: string) => void
  newSaveId: () => string
  setTimer: (run: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

/** 떠난 페이지의 저장이 실패했을 때의 안내. 같은 계정으로 페이지를 다시 열면 `resumeLeftChange`가 이어받는다. */
export const LEFT_SAVE_FAILED = '마인드맵의 마지막 변경을 저장하지 못했어요. 마인드맵을 다시 열면 이어서 저장해요.'
/** 떠난 페이지가 보내지 못한 변경을, 그사이 서버가 바뀌어 이어받지 못할 때의 안내. */
export const LEFT_CHANGE_LOST = '마인드맵의 마지막 변경을 저장하지 못했어요. 그사이 다른 곳에서 바뀌어 최신 내용을 불러왔어요.'

/** 떠난 페이지가 보내지 못한 확정된 나무(`treeJson`)와 그 나무가 기준으로 삼은 version. */
export type LeftChange = { version: number; json: string }

/**
 * `stepSave`의 효과를 실행하는 저장기. 페이지 밖의 일반 객체라 페이지가 사라진 뒤에도 보낸 저장의 응답을 마친다.
 * 페이지가 붙어 있는 동안은 `view`로 지금의 나무를 읽고, 떠날 때 마지막 나무를 붙잡아 둔다.
 */
export const createMindMapSaver = (deps: SaverDeps) => {
  let state: SaveState | null = null
  let base: MindMapResponse | null = null
  let view: SaverView | null = null
  let finalJson: string | null = null
  let timer: unknown = null
  let refetching = false
  const listeners = new Set<() => void>()
  const idleWaiters = new Set<() => void>()

  const emit = () => {
    listeners.forEach((listener) => listener())
    if (!state?.inFlight) idleWaiters.forEach((resolve) => resolve())
  }
  const confirmed = (): string | null => (view ? view.confirmedJson() : finalJson)
  const isIdle = (): boolean => {
    const json = confirmed()
    return !!state && json !== null && !state.reloading && !state.inFlight && !isDirty(state, json)
  }
  const clearSchedule = () => {
    if (timer !== null) deps.clearTimer(timer)
    timer = null
  }

  const step = (event: SaveEvent, json: string | null = confirmed()) => {
    if (!state || json === null) return
    const before = state
    const result = stepSave(state, event, { confirmedJson: json, newSaveId: deps.newSaveId })
    if (result.state !== state) {
      state = result.state
      emit()
    }
    // 페이지가 없으니 저장 상태로 보일 곳이 없다. 저장이 실패로 끝났으면(다시 보내는 중이 아니면) 따로 알린다.
    if (!view && before.inFlight && !state.inFlight && !state.reloading && state.failure !== null) {
      deps.orphanFailure(LEFT_SAVE_FAILED)
    }
    result.effects.forEach(run)
  }

  const remember = (json: string, version: number) => {
    const root = JSON.parse(json) as MindMapNode
    deps.remember((previous) => {
      const known = previous ?? base
      return known ? { ...known, version, root } : undefined
    })
  }

  const send = async (effect: Extract<SaveEffect, { type: 'send' }>) => {
    const { saveId, expectedVersion, json, keepalive } = effect
    const controller = new AbortController()
    const timeout = deps.setTimer(() => controller.abort(), SAVE_TIMEOUT_MS)
    const request = { expectedVersion, saveId, root: JSON.parse(json) as MindMapNode }
    try {
      const { version } = await deps.save(request, { signal: controller.signal, keepalive })
      // 응답은 보내는 중인 저장의 것만 받는다(탭을 닫을 때 보낸 저장은 응답을 받지 못한 저장으로 남는다).
      if (state?.inFlight?.saveId !== saveId) return
      remember(json, version)
      step({ type: 'succeeded', saveId, version })
    } catch (error) {
      const failure = classifySaveError(error)
      if (failure.kind === 'conflict') {
        const { latestVersion, lastSaveId, message } = failure
        step({ type: 'conflicted', saveId, latestVersion, lastSaveId, message })
      } else if (failure.kind === 'rejected') step({ type: 'rejected', saveId, message: failure.message })
      else step({ type: 'lost', saveId, message: failure.message })
    } finally {
      deps.clearTimer(timeout)
    }
  }

  const run = (effect: SaveEffect) => {
    switch (effect.type) {
      case 'schedule':
        clearSchedule()
        timer = deps.setTimer(() => {
          timer = null
          step({ type: 'timer' })
        }, effect.ms)
        return
      case 'cancelSchedule':
        clearSchedule()
        return
      case 'send':
        void send(effect)
        return
      case 'reload':
        if (view) view.reload(effect.message)
        else deps.orphanConflict(effect.message)
        return
    }
  }

  return {
    getState: (): SaveState | null => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** 서버에서 읽은 맵을 지금의 저장 기준으로 삼는다(처음 불러오기, 충돌 뒤 다시 불러오기, 다시 읽기). */
    adopt(map: MindMapResponse) {
      base = map
      clearSchedule()
      const json = treeJson(map.root)
      state = state ? stepSave(state, { type: 'reloaded', version: map.version, json }, {
        confirmedJson: json,
        newSaveId: deps.newSaveId,
      }).state : initialSave(map.version, json)
      emit()
    },
    changed: (when: 'now' | 'later') => step({ type: 'changed', when }),
    retry: () => step({ type: 'retry' }),
    /** 탭을 닫을 때. */
    leave: () => step({ type: 'leave' }, view ? view.leaveJson() : finalJson),
    /**
     * 창이 숨을 때(`visibilitychange`가 `hidden`): 기다리던 변경을 바로 보낸다. 글을 쓰는 중이면 보내지 않는다.
     * 보내면 쓰던 글이 빠진 나무가 가는 중이라, 이어 탭이 닫힐 때 `leave`가 쓰던 글까지 보내지 못한다.
     */
    hide: () => {
      if (view?.isEditing()) return
      step({ type: 'hidden' })
    },
    /** 충돌로 다시 불러오는 중이면 편집 명령을 받지 않는다. */
    isBlocked: () => state?.reloading === true,
    /** 보낼 것도 보내는 중인 것도 없다. */
    isIdle,
    /** 다시 읽은 맵을 받아들여도 되는가: 보낼 것이 없고, 아는 것보다 새 version이다(서버의 version은 오르기만 한다). */
    acceptsRefetched: (version: number) => isIdle() && !!state && version > state.version,
    /** 창이 다시 활성화될 때(`focusAction`). */
    activate() {
      const json = confirmed()
      if (!view || !state || state.reloading || json === null) return
      const action = focusAction({
        editing: view.isEditing(),
        dirty: isDirty(state, json),
        inFlight: state.inFlight !== null,
      })
      if (action === 'save') step({ type: 'changed', when: 'now' })
      else if (action === 'refetch' && !refetching) {
        // visibilitychange와 focus가 함께 와도 한 번만 읽는다.
        refetching = true
        Promise.resolve(view.refetch()).finally(() => {
          refetching = false
        })
      }
    },
    /** 보내는 중인 저장이 없을 때(많아야 `limitMs` 뒤) 끝나는 약속. */
    settled(limitMs: number = SAVE_TIMEOUT_MS): Promise<void> {
      if (!state?.inFlight) return Promise.resolve()
      return new Promise((resolve) => {
        const done = () => {
          idleWaiters.delete(done)
          deps.clearTimer(limit)
          resolve()
        }
        const limit = deps.setTimer(done, limitMs)
        idleWaiters.add(done)
      })
    },
    attach(next: SaverView) {
      view = next
      finalJson = null
    },
    /** 페이지가 사라질 때: 쓰던 글을 확정한 나무를 붙잡아 두고 바로 저장을 건다. */
    detach() {
      if (!view) return
      finalJson = view.leaveJson()
      view = null
      step({ type: 'changed', when: 'now' })
    },
    /** 아직 응답을 기다리는 저장이 있다. */
    isSending: () => state?.inFlight != null,
    /** 떠난 뒤 저장이 끝났는데 보내지 못한 변경이 남았다(실패했다). 충돌로 안내한 뒤면 없다. */
    leftChange(): LeftChange | null {
      if (view || !state || finalJson === null || state.reloading || state.inFlight) return null
      return isDirty(state, finalJson) ? { version: state.version, json: finalJson } : null
    },
    /** 남은 변경을 새 페이지가 이어받았다(또는 버렸다). 이 저장기는 더 보내지 않는다. */
    retire() {
      clearSchedule()
      finalJson = null
    },
  }
}

export type MindMapSaver = ReturnType<typeof createMindMapSaver>

let leaving: Promise<void> = Promise.resolve()
/** 떠난 페이지의 저장기와 그 계정. 보내는 중이거나 보내지 못한 변경이 남은 것만 둔다. */
let left: { saver: MindMapSaver; account: string }[] = []

/**
 * 페이지가 사라질 때 저장기를 떼고, 그 저장의 응답을 새 페이지가 기다릴 수 있게 둔다.
 * 기다리지 않으면 새 페이지가 저장 전의 version을 읽고, 다음 저장이 모르는 저장 번호의 충돌로 끝난다.
 * 저장이 실패하면 남은 변경을 같은 계정의 다음 페이지가 이어받는다(`resumeLeftChange`).
 */
export const leaveSaver = (saver: MindMapSaver, account = '') => {
  saver.detach()
  left = [...left, { saver, account }].filter((entry) => entry.saver.isSending() || entry.saver.leftChange())
  // 앞서 떠난 페이지의 저장도 함께 기다린다(저장기마다 많아야 SAVE_TIMEOUT_MS).
  leaving = Promise.all([leaving, saver.settled()]).then(() => {})
}

/**
 * 페이지가 처음 읽은 맵에 떠난 페이지가 보내지 못한 변경(같은 계정의 가장 나중 것)을 잇는다. 한 번만 이어받는다.
 * 서버가 그 변경의 기준 version 그대로면 그 나무를 `root`로 돌려준다. 페이지는 그 나무로 시작해 바로 저장한다.
 * 서버가 그 뒤로 바뀌었으면 덮지 않고 `notice`로 안내한다. 서버의 나무가 바로 그 나무면(응답만 잃었다) 둘 다 없다.
 */
export const resumeLeftChange = (
  map: MindMapResponse,
  account = '',
): { root: MindMapNode | null; notice: string | null } => {
  const mine = left.filter((entry) => entry.account === account && !entry.saver.isSending())
  left = left.filter((entry) => !mine.includes(entry))
  const change = mine.map((entry) => entry.saver.leftChange()).filter((found) => found !== null).at(-1)
  mine.forEach((entry) => entry.saver.retire())
  if (!change) return { root: null, notice: null }
  if (change.version === map.version) return { root: JSON.parse(change.json) as MindMapNode, notice: null }
  if (change.json === treeJson(map.root)) return { root: null, notice: null }
  return { root: null, notice: LEFT_CHANGE_LOST }
}

/** 떠난 페이지의 저장이 끝날 때(많아야 `SAVE_TIMEOUT_MS`)까지 기다린다. 페이지는 그 뒤에 맵을 읽는다. */
export const afterLeavingSaves = (): Promise<void> => leaving

type SaverHandlers = Omit<SaverView, 'confirmedJson'>

/**
 * 페이지의 저장기. 저장기 상태는 컴포넌트 밖의 객체에 있어 페이지가 사라진 뒤에도 응답을 마친다.
 * 창이 다시 활성화될 때(`visibilitychange`가 `visible`, `focus`)마다 `focusAction`을 따르고, 창이 숨으면
 * 기다리던 변경을 바로 보낸다. 페이지가 사라질 때 쓰던 글을 확정한 나무로 저장을 걸며, `pagehide`에서 keepalive로 보낸다.
 */
export function useMindMapSaver(getConfirmedJson: () => string, handlers: SaverHandlers) {
  const { addToast } = useToast()
  const latest = useRef({ getConfirmedJson, handlers })
  useLayoutEffect(() => {
    latest.current = { getConfirmedJson, handlers }
  })
  // addToast는 알림 공급자가 있는 동안 늘 같은 함수다. 페이지가 사라진 뒤의 안내에도 쓴다.
  const [saver] = useState(() =>
    createMindMapSaver({
      save: (request, options) => saveMindMap(request, options),
      remember: rememberMindMap,
      orphanConflict: (message) => {
        addToast(message, 'info')
        refreshMindMap()
      },
      orphanFailure: (message) => addToast(message, 'error'),
      newSaveId: () => crypto.randomUUID(),
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
    }),
  )
  const state = useSyncExternalStore(saver.subscribe, saver.getState)

  useEffect(() => {
    saver.attach({
      confirmedJson: () => latest.current.getConfirmedJson(),
      leaveJson: () => latest.current.handlers.leaveJson(),
      isEditing: () => latest.current.handlers.isEditing(),
      reload: (message) => latest.current.handlers.reload(message),
      refetch: () => latest.current.handlers.refetch(),
    })
    const onVisible = () => {
      if (document.visibilityState === 'visible') saver.activate()
      else saver.hide()
    }
    const onFocus = () => saver.activate()
    const onHide = () => saver.leave()
    const account = mindMapAccount()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onHide)
      leaveSaver(saver, account)
    }
  }, [saver])

  return { saver, state }
}
