import { Link } from 'react-router-dom'
import StatusPanel from '@shared/components/common/StatusPanel'
import MindMapCanvas from '../components/MindMapCanvas'
import MindMapSaveStatus from '../components/MindMapSaveStatus'
import { LOAD_FAILED, useMindMapEditor } from '../hooks/useMindMapEditor'
import { TODAY_PATH } from '../paths'
import '../mind-map.css'

/** Mac에서는 단축키를 `⌘`로 적는다. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** `/app/mind-map`: 위 막대(숫자·저장 상태)와 남은 높이를 모두 쓰는 편집 화면. */
export default function MindMapPage() {
  const editor = useMindMapEditor()
  const { state, counts } = editor

  let body
  if (editor.status === 'error') {
    body = (
      <div className="mind-map-page__status">
        <StatusPanel
          variant="error"
          title={LOAD_FAILED}
          description={editor.error ?? undefined}
          action={
            <button type="button" className="workspace-button" onClick={editor.reload}>
              다시 시도
            </button>
          }
        />
      </div>
    )
  } else if (!state) {
    body = (
      <div className="mind-map-page__status">
        <StatusPanel variant="loading" title="마인드맵을 불러오는 중…" />
      </div>
    )
  } else {
    body = (
      <MindMapCanvas state={state} dispatch={editor.dispatch} setGeometry={editor.setGeometry} isMac={IS_MAC} />
    )
  }

  return (
    <section className="mind-map-page">
      <header className="mind-map-page__bar">
        <Link to={TODAY_PATH} className="mind-map-page__home">
          ← 홈
        </Link>
        <h1>마인드맵</h1>
        {counts && (
          <p className="mind-map-page__counts">
            가지 <strong>{counts.branches}</strong>개 · 맨 끝 가지 <strong>{counts.leaves}</strong>개
            {counts.todoTotal > 0 && (
              <>
                {' '}
                · 할 일{' '}
                <strong>
                  {counts.todoDone}/{counts.todoTotal}
                </strong>
              </>
            )}
          </p>
        )}
        {state && editor.status === 'ready' && (
          <MindMapSaveStatus status={editor.saveStatus} failure={editor.saveFailure} onRetry={editor.retrySave} />
        )}
      </header>
      {body}
    </section>
  )
}
