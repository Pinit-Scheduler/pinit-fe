import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useEffect, useId, useState } from 'react'
import Modal from '@shared/components/common/Modal'
import {
  useCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  type Category,
  type CategoryFilterValue,
} from './store'
import './categories.css'

function ConnectedCategoryBadge({
  kind,
  itemId,
}: {
  kind: 'task' | 'schedule'
  itemId: number
}) {
  const store = useCategories()
  const value =
    kind === 'task'
      ? store.taskCategory(itemId)
      : store.scheduleCategory(itemId)
  return (
    <span className="category-badge" title={store.error ?? undefined}>
      {store.isLoading
        ? '분류 확인 중'
        : store.error
          ? '분류 확인 실패'
          : (value?.name ?? '없음')}
    </span>
  )
}
export function CategoryBadge({
  category,
  kind,
  itemId,
}: {
  category?: Category | null
  kind?: 'task' | 'schedule'
  itemId?: number
}) {
  return kind && itemId !== undefined ? (
    <ConnectedCategoryBadge kind={kind} itemId={itemId} />
  ) : (
    <span className="category-badge">{category?.name ?? '없음'}</span>
  )
}
export function CategoryFilter({
  value,
  onChange,
}: {
  value: CategoryFilterValue
  onChange: (value: CategoryFilterValue) => void
}) {
  const { categories, isLoading, error } = useCategories()
  return (
    <label className="category-filter">
      <span className="sr-only">카테고리</span>
      <select
        aria-label="카테고리 필터"
        value={String(value)}
        disabled={isLoading || Boolean(error)}
        onChange={(event) =>
          onChange(
            event.target.value === 'all'
              ? 'all'
              : event.target.value === 'none'
                ? 'none'
                : Number(event.target.value),
          )
        }
      >
        <option value="all">모든 카테고리</option>
        <option value="none">없음</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </label>
  )
}
export function CategoryPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
}) {
  const { categories, isLoading, error, reload } = useCategories()
  const id = useId()
  const [managing, setManaging] = useState(false)
  useEffect(() => {
    if (
      !isLoading &&
      !error &&
      value !== null &&
      !categories.some((category) => category.id === value)
    )
      onChange(null)
  }, [categories, isLoading, error, value, onChange])
  return (
    <fieldset className="category-picker" disabled={disabled || isLoading}>
      <legend>카테고리</legend>
      {error ? (
        <div role="alert">
          {error}
          <button type="button" onClick={() => void reload().catch(() => {})}>
            다시 시도
          </button>
        </div>
      ) : (
        <>
          <div className="category-picker__choices">
            <label className={value === null ? 'is-selected' : ''}>
              <input
                type="radio"
                name={id}
                checked={value === null}
                onChange={() => onChange(null)}
              />
              <span>없음</span>
            </label>
            {categories.map((category) => (
              <label
                key={category.id}
                className={value === category.id ? 'is-selected' : ''}
              >
                <input
                  type="radio"
                  name={id}
                  checked={value === category.id}
                  onChange={() => onChange(category.id)}
                />
                <span>{category.name}</span>
              </label>
            ))}
          </div>
          <button
            className="category-manage-link"
            type="button"
            onClick={() => setManaging(true)}
          >
            카테고리 관리
          </button>
        </>
      )}
      {managing && <CategoryManager onClose={() => setManaging(false)} />}
    </fieldset>
  )
}
export function CategoryManager({ onClose }: { onClose: () => void }) {
  const { categories } = useCategories()
  const title = useId()
  const [name, setName] = useState('')
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '카테고리를 저장하지 못했어요.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      labelledBy={title}
      backdropClassName="category-manager-backdrop"
      className="category-manager"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <header>
        <h2 id={title}>카테고리 관리</h2>
        <button
          type="button"
          aria-label="닫기"
          disabled={busy}
          onClick={onClose}
        >
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <p>기본 카테고리 6개와 나만의 카테고리를 사용해요.</p>
      <div className="category-manager__defaults">
        {categories
          .filter((c) => c.builtIn)
          .map((c) => (
            <CategoryBadge key={c.id} category={c} />
          ))}
      </div>
      {categories
        .filter((c) => !c.builtIn)
        .map((c) => (
          <div className="category-manager__row" key={c.id}>
            <input
              aria-label={c.name + ' 이름'}
              value={drafts[c.id] ?? c.name}
              maxLength={30}
              disabled={busy}
              onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() => renameCategory(c.id, drafts[c.id] ?? c.name))
              }
            >
              저장
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDeleting(c.id)}
            >
              삭제
            </button>
            {deleting === c.id && (
              <div className="category-manager__confirm">
                <p>
                  이 카테고리를 삭제하면 연결된 작업·일정의 카테고리가 없음으로
                  바뀝니다.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleting(null)}
                >
                  유지
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await deleteCategory(c.id)
                      setDeleting(null)
                    })
                  }
                >
                  삭제 확인
                </button>
              </div>
            )}
          </div>
        ))}
      <div className="category-manager__row">
        <input
          aria-label="새 카테고리 이름"
          placeholder="새 카테고리 이름"
          value={name}
          maxLength={30}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() =>
            void run(async () => {
              await createCategory(name.trim())
              setName('')
            })
          }
        >
          추가
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </Modal>
  )
}
