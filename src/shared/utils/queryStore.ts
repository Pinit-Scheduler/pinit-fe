/**
 * A small stale-while-revalidate cache, shared by every useRevalidatingQuery caller.
 *
 * Rules:
 * - An entry belongs to exactly one key. Reading a key never returns another key's data.
 * - A refetch keeps the entry's data visible and only flips `fetching`.
 * - Invalidation marks entries stale and refetches the ones somebody is looking at.
 *   Stale data stays readable (it is still this key's data) until the new response arrives.
 * - A response that started before a newer request or an invalidation is dropped.
 */

export type QueryEntry<T = unknown> = {
  /** Data for this key, or undefined before the first success. */
  data: T | undefined
  hasData: boolean
  /** Message of the last failure for this key, cleared by the next success. */
  error: string | null
  /** A request for this key is in flight. */
  fetching: boolean
  /** Data is known to be older than the last invalidation. */
  stale: boolean
  updatedAt: number
}

export type Fetcher<T> = (signal: AbortSignal) => Promise<T>

/** A local patch. An updater that returns undefined leaves the entry as it is. */
export type DataUpdate<T> = T | ((previous: T | undefined) => T | undefined)

type Internal = {
  entry: QueryEntry
  listeners: Set<() => void>
  source: { fetcher: Fetcher<unknown>; errorMessage: (error: unknown) => string } | null
  controller: AbortController | null
  request: number
  scheduled: boolean
}

const EMPTY: QueryEntry = Object.freeze({
  data: undefined,
  hasData: false,
  error: null,
  fetching: false,
  stale: true,
  updatedAt: 0,
}) as QueryEntry

const isAbort = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error as { name?: unknown }).name === 'AbortError'

export function createQueryStore({ maxEntries = 200 }: { maxEntries?: number } = {}) {
  const entries = new Map<string, Internal>()

  const internal = (key: string): Internal => {
    let item = entries.get(key)
    if (!item) {
      item = {
        entry: EMPTY,
        listeners: new Set(),
        source: null,
        controller: null,
        request: 0,
        scheduled: false,
      }
      entries.set(key, item)
      prune()
    }
    return item
  }

  // Drop the oldest entries nobody watches once the cache grows past its cap.
  const prune = () => {
    if (entries.size <= maxEntries) return
    for (const [key, item] of entries) {
      if (entries.size <= maxEntries) break
      if (item.listeners.size === 0 && !item.entry.fetching) entries.delete(key)
    }
  }

  const write = (item: Internal, patch: Partial<QueryEntry>) => {
    item.entry = { ...item.entry, ...patch }
    item.listeners.forEach((listener) => listener())
  }

  const run = (key: string) => {
    const item = internal(key)
    item.scheduled = false
    const source = item.source
    if (!source) return
    item.controller?.abort()
    const controller = new AbortController()
    item.controller = controller
    const request = ++item.request
    write(item, { fetching: true })
    let promise: Promise<unknown>
    try {
      promise = source.fetcher(controller.signal)
    } catch (error) {
      promise = Promise.reject(error)
    }
    promise.then(
      (data) => {
        if (request !== item.request) return
        item.controller = null
        write(item, {
          data,
          hasData: true,
          error: null,
          fetching: false,
          stale: false,
          updatedAt: Date.now(),
        })
      },
      (error: unknown) => {
        if (request !== item.request) return
        item.controller = null
        if (isAbort(error) && controller.signal.aborted) {
          write(item, { fetching: false })
          return
        }
        // Keep this key's data. The caller decides how to show a failed refresh.
        write(item, { fetching: false, error: source.errorMessage(error) })
      },
    )
  }

  /** Queue one request for the key in this microtask, however many callers ask. */
  const schedule = (key: string) => {
    const item = internal(key)
    if (item.scheduled) return
    item.scheduled = true
    queueMicrotask(() => run(key))
  }

  return {
    get: <T>(key: string): QueryEntry<T> =>
      (entries.get(key)?.entry ?? EMPTY) as QueryEntry<T>,

    subscribe(key: string, listener: () => void) {
      const item = internal(key)
      item.listeners.add(listener)
      return () => {
        item.listeners.delete(listener)
        if (item.listeners.size === 0 && item.entry.fetching && !item.entry.hasData) {
          // Nobody waits for a first load any more. Stop it; a later visit starts over.
          item.request++
          item.controller?.abort()
          item.controller = null
          item.entry = { ...item.entry, fetching: false }
        }
      }
    },

    /** Register the latest fetcher for a key. The most recent caller's fetcher and failure message win. */
    register<T>(key: string, fetcher: Fetcher<T>, errorMessage: (error: unknown) => string) {
      internal(key).source = { fetcher: fetcher as Fetcher<unknown>, errorMessage }
    },

    /** Fetch now (coalesced per microtask). Data already shown stays shown. */
    revalidate(key: string) {
      schedule(key)
    },

    /**
     * Mark matching entries stale. Entries someone watches refetch right away;
     * the others refetch when they are next read through the hook.
     */
    invalidate(match: (key: string) => boolean = () => true) {
      for (const [key, item] of entries) {
        if (!match(key)) continue
        // A response already in flight started before this change. Do not let it land.
        if (item.entry.fetching) item.request++
        item.controller?.abort()
        item.controller = null
        item.entry = { ...item.entry, stale: true, fetching: false }
        if (item.listeners.size > 0) schedule(key)
      }
    },

    /** Replace a key's data locally (optimistic update or a saved response). */
    setData<T>(key: string, update: DataUpdate<T>) {
      const item = internal(key)
      const next =
        typeof update === 'function'
          ? (update as (previous: T | undefined) => T | undefined)(item.entry.data as T | undefined)
          : update
      if (next === undefined) return
      write(item, { data: next, hasData: true, error: null })
    },

    /** Forget everything, e.g. on sign-out, so another account never sees this data. */
    clear() {
      for (const item of entries.values()) {
        item.request++
        item.controller?.abort()
      }
      entries.clear()
    },
  }
}

export type QueryStore = ReturnType<typeof createQueryStore>

/** The app-wide store. It lives for the page session, so revisiting a screen shows its last data. */
export const queryStore = createQueryStore()
