/** Errors persist until dismissed; undo controls get time to be discovered. */
export const toastDuration = (
  type: 'error' | 'info' | 'success' = 'info',
  options?: { durationMs?: number; action?: unknown },
) =>
  options?.durationMs ?? (type === 'error' ? 0 : options?.action ? 6000 : 1500)
