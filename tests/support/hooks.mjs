/**
 * Runs one hook instance without a renderer. Slots persist across `render` calls like a mounted
 * component's; a state update during render re-runs the hook at once, as React does, and effects
 * whose deps changed run after each render. Other updates do not re-render on their own: call
 * `render` again to read the next snapshot.
 */
export const hookRunner = () => {
  const slots = []
  let cursor = 0
  let pending = []
  let dirty = false
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const memo = (compute, deps) => {
    const i = cursor++
    const old = slots[i]
    if (!old || !same(old.deps, deps)) slots[i] = { deps, value: compute() }
    return slots[i].value
  }
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) {
        const slot = { value: typeof initial === 'function' ? initial() : initial }
        slot.set = (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next
          if (!Object.is(value, slot.value)) dirty = true
          slot.value = value
        }
        slots[i] = slot
      }
      return [slots[i].value, slots[i].set]
    },
    useRef(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i]
    },
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(effect, deps) {
      const i = cursor++
      const old = slots[i]
      if (old && deps && same(old.deps, deps)) return
      const slot = { deps, cleanup: undefined }
      slots[i] = slot
      pending.push(() => {
        old?.cleanup?.()
        slot.cleanup = effect()
      })
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const i = cursor++
      const old = slots[i]
      if (!old || old.subscribe !== subscribe) {
        old?.unsubscribe?.()
        slots[i] = { subscribe, unsubscribe: subscribe(() => {}) }
      }
      return getSnapshot()
    },
  }
  const render = (hook) => {
    let result
    for (let pass = 0; ; pass++) {
      if (pass === 25) throw new Error('render loop')
      cursor = 0
      dirty = false
      result = hook()
      if (!dirty) break
    }
    const effects = pending
    pending = []
    effects.forEach((run) => run())
    return result
  }
  const unmount = () => {
    for (const slot of slots) {
      slot?.cleanup?.()
      slot?.unsubscribe?.()
    }
  }
  return { react, render, unmount }
}

/** Resolves after queued microtasks and promise callbacks have run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A promise with its resolve and reject exposed. */
export const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}
