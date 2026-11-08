import { API } from './constants.mjs'
import { check, QaFailure } from './safe.mjs'
import { preflight } from './preflight.mjs'

let writesAllowed = false
export async function approveFixtureRun() {
  await preflight()
  writesAllowed = true
}
export async function api(path, { method = 'GET', json, form, token, expected = [200], redirect = 'error' } = {}) {
  check(path.startsWith('/') && !path.startsWith('//'), 'API_PATH_REQUIRED')
  check(['GET', 'HEAD'].includes(method) || writesAllowed, 'PREFLIGHT_REQUIRED')
  const headers = { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  let response
  try {
    response = await fetch(API + path, { method, headers, body: form ? new URLSearchParams(form).toString() : json === undefined ? undefined : JSON.stringify(json), redirect, signal: AbortSignal.timeout(20_000) })
  } catch { throw new QaFailure('REAL_API_NETWORK_FAILED') }
  if (!expected.includes(response.status)) throw new QaFailure('REAL_API_STATUS_UNEXPECTED', response.status)
  let data = null
  try {
    const text = await response.text()
    if (text && response.headers.get('content-type')?.includes('json')) data = JSON.parse(text)
  } catch { throw new QaFailure('REAL_API_JSON_FAILED', response.status) }
  return { status: response.status, data, location: response.headers.get('location') }
}
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export async function projectionReady(token) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await api('/v2/spaces', { token, expected: [200, 404, 409, 503] })
    if (result.status === 200) return result.data
    await delay(500)
  }
  throw new QaFailure('MEMBER_PROJECTION_NOT_READY')
}
