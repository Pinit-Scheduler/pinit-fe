import { Link } from 'react-router-dom'
import { useSpaces } from '@features/spaces/store'
import WorkspaceIcon from '@shared/components/common/WorkspaceIcon'
import { useEffect, useId, useState } from 'react'
import Modal from '@shared/components/common/Modal'
import { useCategories, type Category, type CategoryFilterValue } from './store'
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
          : (value?.name ??
            ((kind === 'task'
              ? store.taskAssignments[itemId]
              : store.scheduleAssignments[itemId]) !== undefined
              ? '프로젝트 정보 없음'
              : '프로젝트 없음'))}
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
  const store = useCategories()
  const { selectedSpaceId } = useSpaces()
  const { isLoading, error } = store
  const categories = store.categories.filter(
    (item) => item.spaceId === selectedSpaceId,
  )
  return (
    <label className="category-filter">
      <span className="sr-only">프로젝트</span>
      <select
        aria-label="프로젝트 필터"
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
        <option value="all">모든 프로젝트</option>
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
  const store = useCategories()
  const { selectedSpaceId } = useSpaces()
  const { isLoading, error, reload } = store
  const categories = store.categories.filter(
    (item) => item.spaceId === selectedSpaceId,
  )
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
      <legend>프로젝트</legend>
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
            프로젝트 관리
          </button>
        </>
      )}
      {managing && <CategoryManager onClose={() => setManaging(false)} />}
    </fieldset>
  )
}
export function CategoryManager({ onClose }: { onClose: () => void }) {
  const title = useId()
  return (
    <Modal
      labelledBy={title}
      backdropClassName="category-manager-backdrop"
      className="category-manager"
      onClose={onClose}
    >
      <header>
        <h2 id={title}>프로젝트 관리</h2>
        <button type="button" aria-label="닫기" onClick={onClose}>
          <WorkspaceIcon name="close" />
        </button>
      </header>
      <p>
        프로젝트 이름과 목적에 기여할 성과, 완료 상태는 공간 관리에서 바꿀 수
        있어요.
      </p>
      <Link
        className="workspace-button workspace-button--primary"
        to="/app/spaces?tab=projects"
        onClick={onClose}
      >
        공간·프로젝트 관리
      </Link>
    </Modal>
  )
}
