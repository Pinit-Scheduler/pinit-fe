import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useEffect, useId, useState } from 'react'
import Modal from '@shared/components/common/Modal'
import { presenceProps, useListPresence, usePresence } from '@shared/motion'
import './TaskDependencyModal.css'
import { useToast } from '@contexts/ToastContext'
import { getRequestFailureMessage } from '@shared/api/errorMessage'
import { deleteTag, fetchTags, renameTag, TAG_NAME_MAX_LENGTH } from '../../api/tags'
import type { TaskTag } from '../../types/task'

type TagManagerModalProps = {
  /** Keep the modal rendered and toggle this, so it can fade out. Default true. */
  open?: boolean
  onClose: () => void
  /** 이름을 바꾸거나 지운 뒤 목록을 다시 불러오게 한다 */
  onChanged: (tags: TaskTag[]) => void
}

/** 태그 이름 바꾸기와 지우기(ADR-0023 §2). 지우면 붙어 있던 작업에서 떨어진다. */
const TagManagerModal = ({ open = true, ...props }: TagManagerModalProps) => {
  const presence = usePresence(open)
  return presence.mounted ? (
    <TagManagerDialog {...props} closing={presence.closing} />
  ) : null
}

const TagManagerDialog = ({
  onClose,
  onChanged,
  closing,
}: Omit<TagManagerModalProps, 'open'> & { closing: boolean }) => {
  const titleId = useId()
  const { addToast } = useToast()
  const [tags, setTags] = useState<TaskTag[]>([])
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    let mounted = true
    fetchTags()
      .then((list) => {
        if (!mounted) return
        setTags(list)
        setDrafts(Object.fromEntries(list.map((tag) => [tag.id, tag.name])))
      })
      .catch((error) => mounted && addToast(getRequestFailureMessage(error, '태그를 불러오지 못했어요.'), 'error'))
      .finally(() => mounted && setLoading(false))
    return () => {
      mounted = false
    }
  }, [addToast])

  const busy = busyId !== null
  // A deleted tag fades out in place before its row is removed.
  const rows = useListPresence(loading ? undefined : tags, (tag) => tag.id)

  const update = (next: TaskTag[]) => {
    setTags(next)
    onChanged(next)
  }

  const save = async (tag: TaskTag) => {
    const name = (drafts[tag.id] ?? '').trim()
    if (!name || name === tag.name) return
    setBusyId(tag.id)
    try {
      const renamed = await renameTag(tag.id, name)
      update(tags.map((item) => (item.id === tag.id ? renamed : item)).sort((a, b) => a.name.localeCompare(b.name)))
      addToast('태그 이름을 바꿨어요.', 'success')
    } catch (error) {
      addToast(getRequestFailureMessage(error, '이름을 바꾸지 못했어요.'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (tag: TaskTag) => {
    if (!window.confirm(`"${tag.name}" 태그를 지울까요? 붙어 있던 작업에서도 떨어져요. 작업은 지워지지 않아요.`)) return
    setBusyId(tag.id)
    try {
      await deleteTag(tag.id)
      update(tags.filter((item) => item.id !== tag.id))
      addToast('태그를 지웠어요.', 'success')
    } catch (error) {
      addToast(getRequestFailureMessage(error, '태그를 지우지 못했어요.'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal
      backdropClassName="task-dep-modal__backdrop"
      className="task-dep-modal__content"
      onClose={onClose}
      labelledBy={titleId}
      closing={closing}
    >
        <header className="task-dep-modal__header">
          <h1 id={titleId}>태그 관리</h1>
          <button type="button" onClick={onClose} aria-label="닫기"><WorkspaceIcon name="close" /></button>
        </header>
        <div className="task-dep-modal__body">
          {loading ? (
            <p className="task-dep-modal__loading" role="status">
              불러오는 중...
            </p>
          ) : rows.length === 0 ? (
            <p>아직 태그가 없어요. 작업 폼에서 태그를 만들 수 있어요.</p>
          ) : (
            <ul className="task-dep-modal__list">
              {rows.map(({ key, item: tag, phase }) => (
                <li key={key} className="tag-manager__row" {...presenceProps(phase)}>
                  <input
                    value={drafts[tag.id] ?? ''}
                    maxLength={TAG_NAME_MAX_LENGTH}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [tag.id]: event.target.value }))}
                    aria-label={`${tag.name} 새 이름`}
                  />
                  <button
                    type="button"
                    onClick={() => save(tag).catch(() => {})}
                    disabled={busy || !(drafts[tag.id] ?? '').trim() || drafts[tag.id]?.trim() === tag.name}
                  >
                    저장
                  </button>
                  <button type="button" className="tag-manager__delete" onClick={() => remove(tag).catch(() => {})} disabled={busy}>
                    지우기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="task-dep-modal__footer">
          <button type="button" onClick={onClose}>닫기</button>
        </footer>
    </Modal>
  )
}

export default TagManagerModal
