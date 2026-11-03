const isDebug = import.meta.env.DEV

export const debugLog = (...args: unknown[]) => {
  if (!isDebug) return
  console.log(...args)
}
