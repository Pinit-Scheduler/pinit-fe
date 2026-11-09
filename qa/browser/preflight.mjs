import { readFile } from 'node:fs/promises'
import { API, SCOPES, EXPECTED_BACKEND, TRUSTED_BRANCH } from './constants.mjs'
import { check, QaFailure, evidence } from './safe.mjs'

export async function readPublic(path) {
  try {
    const response = await fetch(API + path, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new QaFailure('PUBLIC_READ_FAILED', response.status)
    return await response.json()
  } catch (error) {
    if (error instanceof QaFailure) throw error
    throw new QaFailure('PUBLIC_READ_UNAVAILABLE')
  }
}
export async function preflight() {
  check(process.env.GITHUB_EVENT_NAME === 'pull_request' && process.env.GITHUB_REPOSITORY === 'Pinit-Scheduler/pinit-fe' && process.env.GITHUB_HEAD_REF === TRUSTED_BRANCH, 'TRUSTED_PR_REQUIRED')
  let event
  try { event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) } catch { throw new QaFailure('TRUSTED_PR_REQUIRED') }
  check(event.pull_request?.head?.repo?.full_name === 'Pinit-Scheduler/pinit-fe' && event.pull_request?.head?.ref === TRUSTED_BRANCH && event.pull_request?.head?.sha === process.env.QA_SOURCE_HEAD && /^[a-f0-9]{40}$/.test(process.env.QA_SOURCE_HEAD ?? ''), 'TRUSTED_PR_REQUIRED')
  check(process.env.QA_ROOT_RELEASE_APPROVED === EXPECTED_BACKEND, 'ROOT_BACKEND_GATE_REQUIRED')
  const health = await readPublic('/actuator/health/readiness')
  check(health.status === 'UP', 'BACKEND_NOT_READY')
  const oauth = await readPublic('/.well-known/oauth-authorization-server')
  check(SCOPES.every((scope) => oauth.scopes_supported?.includes(scope)), 'FOUR_SCOPES_REQUIRED')
  const schema = await readPublic('/v3/api-docs')
  for (const prefix of ['/v2/spaces', '/v2/projects', '/v2/workspace/tasks', '/v2/workspace/schedules'])
    check(Object.keys(schema.paths ?? {}).some((path) => path.startsWith(prefix)), 'WORKSPACE_SCHEMA_REQUIRED')
  evidence('preflight', { ready: true, scopes: SCOPES.length, backendGate: EXPECTED_BACKEND, sourceHead: process.env.QA_SOURCE_HEAD })
}
if (process.argv[1]?.endsWith('preflight.mjs')) {
  preflight().catch((error) => {
    evidence('preflight', { ready: false, code: error instanceof QaFailure ? error.message : 'PREFLIGHT_FAILED', status: error instanceof QaFailure ? error.status : undefined })
    process.exitCode = 1
  })
}
