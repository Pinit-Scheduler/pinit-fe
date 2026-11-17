// 딥링크로 열 수 있는 화면과, 앱 안에 돌아갈 history가 없을 때 갈 상위 화면.
// /app/tasks/splits/:id는 쪼개기 제안 화면(splitProposalPath)이다.
const FALLBACKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/app\/settings\/onboarding$/, '/app/settings'],
  [/^\/app\/tasks\/splits$/, '/app/tasks'],
  [/^\/app\/tasks\/splits\/\d+$/, '/app/tasks/splits'],
]

/**
 * 상단 뒤로 가기의 행선지. null이면 앱 안의 이전 화면으로(navigate(-1)) 가고, 경로면 그리로 바꿔(replace) 간다.
 * historyIdx는 react-router가 history.state에 두는 idx다. 없거나 0 이하이면 이 탭에서 앱 안에 쌓인 항목이 없다.
 */
export const backTarget = (pathname: string, historyIdx: number | undefined): string | null => {
  if (historyIdx !== undefined && historyIdx > 0) return null
  return FALLBACKS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null
}
