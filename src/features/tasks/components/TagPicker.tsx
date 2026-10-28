import { useEffect, useState } from 'react'
import { ApiError } from '@shared/api/httpClient'
import { useToast } from '@contexts/ToastContext'
import { createTag, fetchTags, tagErrorMessage, TAG_NAME_MAX_LENGTH, TAGS_PER_TASK } from '../api/tags'
import type { TaskTag } from '../types/task'

type TagPickerProps = {
  selectedIds: number[]
  onChange: (ids: number[]) => void
}

/** 작업 폼의 태그 선택(ADR-0023 §4). 내 태그를 토글하고, 새 이름을 적어 바로 만들 수 있다. */
const TagPicker = ({ selectedIds, onChange }: TagPickerProps) => {
  const { addToast } = useToast()
  const [tags, setTags] = useState<TaskTag[]>([])
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let mounted = true
    fetchTags()
      .then((list) => mounted && setTags(list))
      .catch(() => mounted && setLoadError(true))
    return () => {
      mounted = false
    }
  }, [])

  const full = selectedIds.length >= TAGS_PER_TASK

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((value) => value !== id))
      return
    }
    if (full) {
      addToast(`태그는 작업마다 ${TAGS_PER_TASK}개까지 붙일 수 있어요.`, 'error')
      return
    }
    onChange([...selectedIds, id])
  }

  const create = async () => {
    const name = draft.trim()
    if (!name || creating) return
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      if (!selectedIds.includes(existing.id)) toggle(existing.id)
      setDraft('')
      return
    }
    if (full) {
      addToast(`태그는 작업마다 ${TAGS_PER_TASK}개까지 붙일 수 있어요.`, 'error')
      return
    }
    setCreating(true)
    try {
      const created = await createTag(name)
      setTags((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      onChange([...selectedIds, created.id])
      setDraft('')
    } catch (error) {
      addToast(error instanceof ApiError ? tagErrorMessage(error.data, '태그를 만들지 못했어요.') : '태그를 만들지 못했어요.', 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="task-form__field">
      <span>태그 (선택, {TAGS_PER_TASK}개까지)</span>
      {loadError && <p className="task-form__note">태그 목록을 불러오지 못했어요.</p>}
      {tags.length > 0 && (
        <div className="tag-picker__chips" role="group" aria-label="태그 선택">
          {tags.map((tag) => {
            const active = selectedIds.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                className={['tag-chip', active ? 'is-active' : ''].filter(Boolean).join(' ')}
                aria-pressed={active}
                disabled={creating}
                onClick={() => toggle(tag.id)}
              >
                #{tag.name}
              </button>
            )
          })}
        </div>
      )}
      <div className="tag-picker__new">
        <input
          value={draft}
          maxLength={TAG_NAME_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              create().catch(() => {})
            }
          }}
          placeholder="새 태그 이름"
          aria-label="새 태그 이름"
        />
        <button type="button" onClick={() => create().catch(() => {})} disabled={!draft.trim() || creating}>
          {creating ? '만드는 중…' : '추가'}
        </button>
      </div>
    </div>
  )
}

export default TagPicker
