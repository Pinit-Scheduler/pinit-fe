/** 휴지통 문구(ADR-0024 §13). 화면과 되돌리기 토스트가 같이 쓴다. */

export const restoreTaskMessage = (skippedDependencies: number) =>
  skippedDependencies > 0
    ? `작업을 되돌렸어요. 선후관계 ${skippedDependencies}개는 복구하지 못했어요.`
    : '작업을 되돌렸어요.'

/** 자동 삭제까지 남은 온전한 날 수로 "n일 뒤 삭제". 하루가 안 남았으면 "곧 삭제". */
export const purgeDaysLabel = (daysLeft: number) => (daysLeft >= 1 ? `${Math.floor(daysLeft)}일 뒤 삭제` : '곧 삭제')
