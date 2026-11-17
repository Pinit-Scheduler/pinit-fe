export const SPLIT_INBOX_PATH = '/app/tasks/splits'
export const splitProposalPath = (requestId: number): string => `${SPLIT_INBOX_PATH}/${requestId}`
/** 제안 화면(B단계)이 들어오면 true로 바꾼다. */
export const PROPOSAL_SCREEN_READY = false
