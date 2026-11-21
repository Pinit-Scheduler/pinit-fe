import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readFailureMessage } from '@shared/api/errorMessage'
import { useToast } from '@shared/contexts/ToastContext'
import { fetchMindMap } from '../api/mindMapApi'
import type { MindMapResponse } from '../api/mindMapApi'
import { mindMapAccount, rememberMindMap } from '../api/mindMapQuery'
import { confirmedTree, initialEditor, leaveTree, reduce, replaceFromServer } from '../model/editor'
import type { Box, EditorCommand, EditorState } from '../model/editor'
import { saveStatus as statusOf } from '../model/saveMachine'
import type { SaveStatus } from '../model/saveMachine'
import { countBranches, treeJson } from '../model/tree'
import type { MapCounts } from '../model/tree'
import { useCursorSaver } from './useCursorSaver'
import { afterLeavingSaves, resumeLeftChange, useMindMapSaver } from './useMindMapSaver'

export const LOAD_FAILED = '마인드맵을 불러오지 못했어요.'

/**
 * 복사한 가지를 들여 쓴 목록 글로 시스템 클립보드에도 쓴다(다른 앱·다른 탭에 붙일 수 있게).
 * 쓰지 못해도(권한·안전하지 않은 주소) 화면 안의 붙여넣기는 화면의 클립보드로 된다.
 */
const writeSystemClipboard = (text: string) => {
  navigator.clipboard?.writeText(text).catch(() => {})
}

type Load = { status: 'loading' | 'error' | 'ready'; error: string | null }

/**
 * 마인드맵 페이지의 편집 상태. 불러오기, 명령(`reduce`), 저장기와 기억한 가지 저장을 잇는다.
 * 편집 상태는 ref에도 두어 한 이벤트 안의 여러 명령과 저장기가 늘 마지막 값을 읽는다.
 */
export function useMindMapEditor() {
  const { addToast } = useToast()
  const [load, setLoad] = useState<Load>({ status: 'loading', error: null })
  const [state, setState] = useState<EditorState | null>(null)
  const stateRef = useRef<EditorState | null>(null)
  const geometry = useRef<ReadonlyMap<string, Box> | undefined>(undefined)
  /** 늦게 온 응답을 버리는 번호. 요청을 끊지 않는다(끊으면 HTTP 도우미가 오류로 남긴다). */
  const generation = useRef(0)

  const show = useCallback((next: EditorState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const confirmedJson = () => (stateRef.current ? treeJson(confirmedTree(stateRef.current)) : '')

  /** 받은 맵을 화면과 저장기의 기준으로 삼는다. 이미 편집 중이던 맵이면 고르던 가지를 지키고 기록을 비운다. */
  const adoptRef = useRef<(map: MindMapResponse) => void>(() => {})

  const fetchLatest = useCallback((onFailure: (error: unknown) => void) => {
    const ticket = ++generation.current
    fetchMindMap().then(
      (map) => {
        if (ticket !== generation.current) return
        rememberMindMap(() => map)
        adoptRef.current(map)
      },
      (error) => {
        if (ticket === generation.current) onFailure(error)
      },
    )
  }, [])

  /** 보낸 불러오기의 응답을 버린다. */
  const forgetPending = useCallback(() => {
    generation.current++
  }, [])

  const failLoad = useCallback((error: unknown) => {
    const message = readFailureMessage(error)
    setLoad({ status: 'error', error: message && message !== LOAD_FAILED ? message : null })
  }, [])

  const reload = useCallback(() => {
    setLoad({ status: stateRef.current ? 'ready' : 'loading', error: null })
    fetchLatest(failLoad)
  }, [fetchLatest, failLoad])

  const { saver, state: saveState } = useMindMapSaver(confirmedJson, {
    leaveJson: () => (stateRef.current ? treeJson(leaveTree(stateRef.current)) : ''),
    isEditing: () => stateRef.current?.editing != null,
    reload: (message) => {
      addToast(message, 'info')
      fetchLatest(failLoad)
    },
    // 다시 읽는 사이에 고쳤거나 보내기 시작했으면, 또는 그사이 저장이 성공해 답이 낡았으면 받은 맵을 버린다.
    refetch: () =>
      fetchMindMap().then(
        (map) => {
          const editing = stateRef.current?.editing != null
          if (editing || !saver.acceptsRefetched(map.version)) return
          rememberMindMap(() => map)
          adoptRef.current(map)
        },
        () => {},
      ),
  })

  useEffect(() => {
    adoptRef.current = (map) => {
      const current = stateRef.current
      if (current) {
        show(replaceFromServer(current, map))
        saver.adopt(map)
      } else {
        // 처음 불러오기: 떠난 페이지가 저장하지 못한 변경이 있으면 서버가 그대로일 때만 이어받아 바로 저장한다.
        const left = resumeLeftChange(map, mindMapAccount())
        show(initialEditor(left.root ? { ...map, root: left.root } : map))
        saver.adopt(map)
        if (left.root) saver.changed('now')
        if (left.notice) addToast(left.notice, 'error')
      }
      setLoad({ status: 'ready', error: null })
    }
  }, [saver, show, addToast])

  // 방금 떠난 페이지의 저장이 끝난 뒤에 읽는다. 기다림은 비동기라 개발 모드의 두 번 붙이기에서도 한 번만 읽는다.
  useEffect(() => {
    let live = true
    afterLeavingSaves().then(() => {
      if (live) fetchLatest(failLoad)
    })
    return () => {
      live = false
      forgetPending()
    }
  }, [fetchLatest, failLoad, forgetPending])

  const dispatch = useCallback(
    (command: EditorCommand) => {
      const current = stateRef.current
      if (!current || saver.isBlocked()) return
      const result = reduce(current, command, { newId: () => crypto.randomUUID(), geo: geometry.current })
      if (result.state !== current) show(result.state)
      if (result.state.clipboard && result.state.clipboard !== current.clipboard)
        writeSystemClipboard(result.state.clipboard.text)
      if (result.notice) addToast(result.notice, 'info')
      if (result.save) saver.changed(result.save)
    },
    [saver, show, addToast],
  )

  const setGeometry = useCallback((boxes: ReadonlyMap<string, Box>) => {
    geometry.current = boxes
  }, [])

  const retrySave = useCallback(() => saver.retry(), [saver])

  // 처음 쓰는 새 가지는 서버에 없으므로 그 앞의 선택을 기억시킨다.
  useCursorSaver(state ? (state.editing?.isNew ? state.editing.from : state.selectedId) : null)

  const confirmed = useMemo(() => (state ? treeJson(confirmedTree(state)) : ''), [state])
  const counts: MapCounts | null = useMemo(() => (state ? countBranches(state.tree) : null), [state])
  const saveStatus: SaveStatus = saveState ? statusOf(saveState, confirmed) : 'saved'

  return {
    status: load.status,
    error: load.error,
    reload,
    state,
    dispatch,
    saveStatus,
    saveFailure: saveState?.failure ?? null,
    retrySave,
    counts,
    /** 보이는 가지의 상자. `↑` `↓` `→`가 화면상 위치로 고른다. */
    setGeometry,
    /** 충돌로 다시 불러오는 중이라 편집 명령을 받지 않는다. */
    blocked: saveState?.reloading === true,
  }
}
