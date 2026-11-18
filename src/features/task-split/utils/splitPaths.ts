export const SPLIT_INBOX_PATH = '/app/tasks/splits'
export const splitProposalPath = (requestId: number): string => `${SPLIT_INBOX_PATH}/${requestId}`
/** 제안 화면(B단계)이 들어왔다. "제안 보기"가 보관함·작업 상세에 보인다. */
export const PROPOSAL_SCREEN_READY = true
