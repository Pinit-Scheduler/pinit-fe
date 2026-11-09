export type ToastItem = {
  id: number
  message: string
  /** Playing its exit animation; removed once it finishes. */
  leaving?: boolean
}

/**
 * Add a toast, or refresh the visible one with the same message in place (same id, so it does not
 * remount and pop again). At most `limit` toasts stay visible; the oldest beyond that are dropped.
 */
export function upsertToast<T extends ToastItem>(
  list: readonly T[],
  toast: Omit<T, 'id' | 'leaving'>,
  newId: () => number,
  limit = 3,
): { list: T[]; id: number; dropped: number[] } {
  const existing = list.find((item) => item.message === toast.message)
  if (existing) {
    const updated = { ...existing, ...toast, leaving: false } as T
    return {
      list: list.map((item) => (item === existing ? updated : item)),
      id: existing.id,
      dropped: [],
    }
  }
  const id = newId()
  const next = [...list, { ...toast, id } as T]
  const active = next.filter((item) => !item.leaving)
  const dropped =
    active.length > limit ? active.slice(0, active.length - limit).map((item) => item.id) : []
  return {
    list: dropped.length ? next.filter((item) => !dropped.includes(item.id)) : next,
    id,
    dropped,
  }
}
