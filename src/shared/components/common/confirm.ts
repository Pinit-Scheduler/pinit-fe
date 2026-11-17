// 비용이 걸린 동작을 한 번 확인받는 공용 확인 창의 저장소. 창은 ConfirmHost가 그린다.

export type ConfirmAsk = { title: string; body: string; confirmLabel: string; cancelLabel: string }

let current: (ConfirmAsk & { resolve: (ok: boolean) => void }) | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export const subscribeConfirm = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const currentConfirm = () => current
export const answerConfirm = (ok: boolean) => {
  current?.resolve(ok)
  current = null
  emit()
}

/** 확인 창을 띄우고 답을 기다린다. 이미 떠 있는 창이 있으면 그 창은 "아니오"로 닫는다. */
export const askConfirm = (ask: ConfirmAsk) =>
  new Promise<boolean>((resolve) => {
    current?.resolve(false)
    current = { ...ask, resolve }
    emit()
  })
