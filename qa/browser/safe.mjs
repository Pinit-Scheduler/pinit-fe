import { appendFile, mkdir } from 'node:fs/promises'
import { RUNTIME } from './constants.mjs'

const STAGES = new Set(['preflight', 'fixtures', 'scenario', 'cleanup', 'result', 'screenshots', 'transport'])
// Add only literal, reviewed scenario codes here. Unknown strings never reach a log.
const SAFE_CODES = new Set([
  'QA_FAILURE', 'BROWSER_ASSERTION_FAILED', 'RUNNER_ERROR',
  'PUBLIC_READ_FAILED', 'PUBLIC_READ_UNAVAILABLE', 'ROOT_BACKEND_GATE_REQUIRED',
  'BACKEND_NOT_READY', 'FOUR_SCOPES_REQUIRED', 'WORKSPACE_SCHEMA_REQUIRED', 'PREFLIGHT_FAILED',
  'STATIC_FILE_MISSING', 'STATIC_PATH_ESCAPE', 'UNEXPECTED_CANONICAL_REQUEST',
  'SCREENSHOT_CAPTURE_FAILED', 'SCREENSHOT_EXPORT_FAILED', 'SCREENSHOT_NAME_REQUIRED',
  'SCREENSHOT_FINAL_SPACE_REQUIRED', 'SCREENSHOT_DIALOG_PRESENT', 'SCREENSHOT_VIEWPORT_REQUIRED',
  'SCREENSHOT_TOO_LARGE', 'SCREENSHOT_EXPORT_OPT_IN_REQUIRED', 'SCREENSHOT_SUCCESS_REQUIRED',
  'SCREENSHOT_MANIFEST_INVALID', 'SCREENSHOT_FILE_INVALID', 'SCREENSHOT_COUNT_REQUIRED',
  'ADMIN_DELEGATE_REMOVE_LAST_ADMIN',
  'ADMIN_TRASH_SPACE_PROJECT_RESTORE',
  'API_PATH_REQUIRED',
  'ASSIGNEE_NULL_TODAY_ALL_SPACES',
  'ATOMIC_MOVE_DETACH_REQUIRED',
  'AUTOMATIC_CONFLICT_RESAVE_FORBIDDEN',
  'COOKIE_CONTEXT_ISOLATION_REQUIRED',
  'CREATED_PROJECT_ID_REQUIRED',
  'CREATED_SCHEDULE_ID_REQUIRED',
  'CREATED_SPACE_ID_REQUIRED',
  'CREATED_TASK_ID_REQUIRED',
  'CREATOR_DEFAULT_ASSIGNEE_REQUIRED',
  'DARK_SCHEME_REQUIRED',
  'DUPLICATE_CLIENT_TASK_STATE_WRITE',
  'ERROR_FIELD_DESCRIPTION_REQUIRED',
  'ERROR_FIELD_FOCUS_REQUIRED',
  'EXPLICIT_NULL_ASSIGNEE_REQUIRED',
  'FIXTURE_CLEANUP_FAILED',
  'FIXTURE_RUN_ALREADY_STARTED',
  'HORIZONTAL_OVERFLOW',
  'INVITATION_DUPLICATE_MEMBERSHIP',
  'INVITATION_DUPLICATE_REQUIRED',
  'INVITATION_JOIN_REQUIRED',
  'INVITATION_JOIN_REUSE_REVOKE',
  'INVITATION_ORIGIN_REQUIRED',
  'INVITATION_TOKEN_REQUIRED',
  'LEGACY_SCOPES_NOT_EXPANDED',
  'LINKED_SCHEDULE_409_SSE_DRAFT_PRESERVED',
  'LINKED_SERVER_AFFILIATION_REQUIRED',
  'LINKED_TASK_COMPLETION_REQUIRED',
  'LOGIN_ISOLATED_CONTEXTS',
  'LOGIN_TOKEN_REQUIRED',
  'MEMBERSHIP_REMOVAL_REQUIRED',
  'MEMBER_PROJECTION_NOT_READY',
  'MOBILE_KEYBOARD_DARK_FINAL_EVIDENCE',
  'MOBILE_MODAL_FOOTER_REQUIRED',
  'NULL_ASSIGNEE_EDIT_PRESERVED',
  'OAUTH_CALLBACK_FAILED',
  'OAUTH_CALLBACK_STATE_REQUIRED',
  'OAUTH_CLIENT_REQUIRED',
  'OAUTH_CONSENT_ORIGIN_REQUIRED',
  'OAUTH_EXPLICIT_SCOPE_REQUIRED',
  'OAUTH_EXPLICIT_SPACES_OPT_IN',
  'OAUTH_FOUR_EXPLICIT_SCOPES',
  'OAUTH_OLD_THREE_SCOPES',
  'OAUTH_RESOURCE_REQUIRED',
  'OAUTH_REVOKE_FAILED',
  'OAUTH_TOKEN_REQUIRED',
  'ONBOARDING_READ_REQUIRED',
  'ORIGINAL_EDIT_VERSION_REQUIRED',
  'PERSONAL_INVITATION_FORBIDDEN',
  'PREFLIGHT_REQUIRED',
  'PROJECT_CHILDREN_MOVE_REQUIRED',
  'PROJECT_MOVE_CHILDREN_AND_OLD_MEMBER',
  'PROJECT_RESTORE_REQUIRED',
  'PURPOSE_CLEAR_PRESERVES_RESOURCES',
  'REAL_API_JSON_FAILED',
  'REAL_API_NETWORK_FAILED',
  'REAL_API_ORIGIN_REQUIRED',
  'REAL_API_STATUS_UNEXPECTED',
  'RESOURCE_EVICT_WITH_MEMBERSHIP_REQUIRED',
  'RUNNING_LINKED_MOVE_REQUIRED',
  'RUNNING_MOVE_DETACH_CACHE_EVICTION',
  'SCHEDULE_CONFLICT_DETAILS',
  'SCHEDULE_RESTORE_REQUIRED',
  'SHARED_COMPLETION_REQUIRED',
  'SHARED_RUNNING_REQUIRED',
  'SHARED_SCHEDULE_COMMON_STATE',
  'SPACE_EDIT_NOT_PERSISTED',
  'SPACE_PROJECT_UI_CRUD',
  'SPACE_RESTORE_REQUIRED',
  'SSE_EDIT_EVENT_REQUIRED',
  'SUSPENDED_COMPLETE_FORBIDDEN',
  'TASK_409_SSE_DRAFT_PRESERVED',
  'TASK_CONFLICT_DETAILS',
  'TASK_RESTORE_REQUIRED',
  'TRUSTED_PR_REQUIRED',
  'UI_API_JSON_FAILED',
  'UI_API_STATUS_UNEXPECTED',
  'CANONICAL_ASSET_SET_REQUIRED',
  'CANONICAL_POSTDEPLOY',
  'CANONICAL_PUBLIC_READ_FAILED',
  'CANONICAL_RELEASE_NOT_READY',
  'CANONICAL_SW_VERSION_REQUIRED',
  'TRUSTED_MASTER_REQUIRED',
  'SOURCE_UI_LINE',
  'SOURCE_SCENARIO_LINE',
  'SOURCE_OAUTH_LINE',
  'TASK_FIXTURE_TITLE_INVALID',
  'MOVE_RUNNER_POINTER_REQUIRED',
])
const BOOLEAN_KEYS = new Set(['ready', 'ok', 'sse', 'ui'])
const COUNT_KEYS = new Set(['passed', 'failed', 'skipped', 'count', 'requests', 'spaces', 'tasks', 'schedules', 'version', 'expectedVersion', 'serverVersion', 'scopes', 'contexts', 'remainingAccounts', 'remainingClients', 'cleanupFailures', 'acknowledgements', 'writes'])
const HASH_LENGTHS = { sourceHead: 40, backendGate: 40, sha256: 64 }

export class QaFailure extends Error {
  constructor(code, status) {
    super(SAFE_CODES.has(code) ? code : 'QA_FAILURE')
    this.name = 'QaFailure'
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
  }
}
export function check(value, code) {
  if (!value) throw new QaFailure(code)
}
export function evidence(step, details = {}) {
  const record = publicRecord({ ...details, step })
  process.stdout.write(`QA ${JSON.stringify(record)}\n`)
  return record
}
export function publicRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { step: 'result', code: 'QA_FAILURE' }
  const record = { step: STAGES.has(input.step) ? input.step : 'result' }
  for (const [key, value] of Object.entries(input)) {
    if (BOOLEAN_KEYS.has(key) && typeof value === 'boolean') record[key] = value
    if (COUNT_KEYS.has(key) && Number.isSafeInteger(value) && value >= 0) record[key] = value
    if (['status', 'apiStatus'].includes(key) && Number.isInteger(value) && value >= 100 && value <= 599) record[key] = value
    if (Object.hasOwn(HASH_LENGTHS, key) && typeof value === 'string' && value.length === HASH_LENGTHS[key] && /^[a-f0-9]+$/.test(value)) record[key] = value
    if (key === 'code') record[key] = SAFE_CODES.has(value) ? value : 'QA_FAILURE'
  }
  return record
}
// Worker stdout is untrusted. Forward complete allowlisted records, never a
// truncated/sanitized fragment of arbitrary console output or an exception.
export function validatedPublicRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !STAGES.has(input.step)) return null
  const record = publicRecord(input)
  const keys = Object.keys(input)
  if (keys.length !== Object.keys(record).length || keys.some((key) => !Object.hasOwn(record, key) || record[key] !== input[key])) return null
  return record
}
export async function saveEvidence(step, details = {}) {
  await mkdir(RUNTIME, { recursive: true })
  await appendFile(new URL('evidence.jsonl', RUNTIME), JSON.stringify(publicRecord({ ...details, step })) + '\n')
}
export function failureCode(error) {
  return error instanceof QaFailure && SAFE_CODES.has(error.message) ? error.message : 'BROWSER_ASSERTION_FAILED'
}
export function failureLocation(error) {
  // A fixed source-file enum plus a bounded line number helps diagnose selectors
  // without emitting Playwright's message, locator, request or call log.
  const location = typeof error?.stack === 'string' ? /qa[\\/]browser[\\/](ui\.mjs|workspace\.pw\.mjs|oauth\.mjs):(\d+):\d+/.exec(error.stack) : null
  if (!location) return
  const count = Number(location[2])
  if (!Number.isSafeInteger(count) || count < 1 || count > 2000) return
  const code = { 'ui.mjs': 'SOURCE_UI_LINE', 'workspace.pw.mjs': 'SOURCE_SCENARIO_LINE', 'oauth.mjs': 'SOURCE_OAUTH_LINE' }[location[1]]
  evidence('result', { code, count, ok: false })
}
