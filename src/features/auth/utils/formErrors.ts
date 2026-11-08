/** 입력 순서상 처음으로 오류가 있는 입력란. 제출이 막히면 그 입력란으로 포커스를 옮긴다. */
export const firstErrorField = <K extends string>(
  order: readonly K[],
  errors: Partial<Record<K, string>>,
): K | null => order.find((key) => Boolean(errors[key])) ?? null
