import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { RUNTIME } from './constants.mjs'
import { api, approveFixtureRun, projectionReady } from './http.mjs'
import { check, evidence } from './safe.mjs'

export async function createFixtures(owners = []) {
  await approveFixtureRun()
  await mkdir(RUNTIME, { recursive: true, mode: 0o700 })
  // A restarted worker must never create another pair after ambiguous failures.
  try { await writeFile(new URL('signup-started', RUNTIME), '', { flag: 'wx', mode: 0o600 }) }
  catch { check(false, 'FIXTURE_RUN_ALREADY_STARTED') }
  const suffix = randomBytes(5).toString('hex')
  // Exactly two signup POSTs maximum per run. An ambiguous failure is never retried.
  for (const [role, nickname] of [['a', 'QA 관리자'], ['b', 'QA 참여자']]) {
    const username = `qa${role}${suffix}`
    const password = 'Qa' + randomBytes(18).toString('hex') + '9'
    await api('/v0/signup', { method: 'POST', json: { username, password, nickname }, expected: [200, 201, 204] })
    const owner = { role, username, password, nickname, token: null,
      memberId: null, defaultSpaceId: null, spaces: new Set(), tasks: new Set(), schedules: new Set(), clients: new Set(), invitations: [], page: null }
    owners.push(owner)
    const login = await api('/v0/login', { method: 'POST', json: { username, password } })
    check(typeof login.data?.token === 'string', 'LOGIN_TOKEN_REQUIRED')
    const index = await projectionReady(login.data.token)
    Object.assign(owner, { token: login.data.token, memberId: index.currentMember.memberId, defaultSpaceId: index.defaultSpaceId })
  }
  evidence('fixtures', { contexts: owners.length, remainingAccounts: owners.length })
  return { owners, suffix }
}

export async function tokenFor(owner) {
  // Use only the fresh fixture's own page; credentials/storage are never serialized.
  if (owner.page && !owner.page.isClosed()) {
    try {
      const token = await owner.page.evaluate(() => localStorage.getItem('pinit.accessToken'))
      if (token) owner.token = token
    } catch { /* keep the last fixture token */ }
  }
  return owner.token
}
export async function ownedApi(owner, path, options = {}) {
  return api(path, { ...options, token: await tokenFor(owner) })
}
export async function cleanupFixtures(owners) {
  let cleanupFailures = 0
  // Revoke while the owned space is still active. No broad revoke/delete call.
  for (const owner of owners) {
    if (!owner.token) continue
    for (const invitation of owner.invitations) {
      let revoked = false
      for (const actor of owners) {
        if (!actor.token) continue
        try {
          const result = await ownedApi(actor, `/v2/spaces/${invitation.spaceId}/invitations/${encodeURIComponent(invitation.token)}`, { method: 'DELETE', expected: [200, 204, 403, 404, 410] })
          if (result.status !== 403) { revoked = true; break }
        } catch { /* try the other known fixture administrator */ }
      }
      if (!revoked) cleanupFailures++
    }
  }
  // In particular, individually archive IDs created in or moved to the default
  // personal space; deleting team spaces alone would leave those live rows.
  for (const [kind, key] of [['schedules', 'schedule'], ['tasks', 'task']]) {
    const ids = new Set(owners.flatMap((owner) => [...owner[kind]]))
    for (const id of ids) {
      let done = false
      for (const owner of owners) {
        if (!owner.token) continue
        try {
          let result = await ownedApi(owner, `/v2/workspace/${kind}/${id}`, { expected: [200, 403, 404, 410] })
          if (result.status !== 200) continue
          if (kind === 'schedules' && ['IN_PROGRESS', 'SUSPENDED'].includes(result.data[key].state)) {
            if (!result.data.allowedActions.cancel) continue
            result = await ownedApi(owner, `/v2/workspace/schedules/${id}/state`, { method: 'POST', json: { expectedVersion: result.data.version, action: 'CANCEL' } })
          }
          if (!result.data.allowedActions.delete) continue
          await ownedApi(owner, `/v2/workspace/${kind}/${id}?expectedVersion=${result.data.version}`, { method: 'DELETE', expected: [200, 204] })
          done = true; break
        } catch { /* try the other known fixture administrator */ }
      }
      if (!done) {
        // An interrupted scenario may already have archived the owned ID.
        for (const owner of owners) {
          if (!owner.token) continue
          try {
            const trash = (await ownedApi(owner, '/v2/trash')).data
            const rows = kind === 'tasks' ? trash.tasks : trash.schedules
            if (rows.some((row) => (kind === 'tasks' ? row.taskId : row.scheduleId) === id)) { done = true; break }
          } catch { /* only inspect known fixture actors */ }
        }
      }
      if (!done) cleanupFailures++
    }
  }
  const allSpaces = new Set(owners.flatMap((owner) => [...owner.spaces]))
  for (const id of allSpaces) {
    let done = false
    for (const owner of owners) {
      try {
        const result = await ownedApi(owner, `/v2/spaces/${id}/snapshot?includeDeleted=true`, { expected: [200, 403, 404, 410] })
        if (result.status !== 200) continue
        const space = result.data.space
        if (space.deletedAt) { done = true; break }
        if (!space.allowedActions.delete) continue
        await ownedApi(owner, `/v2/spaces/${id}?expectedVersion=${space.version}`, { method: 'DELETE', expected: [200, 204] })
        done = true; break
      } catch { /* try the other fixture administrator */ }
    }
    if (!done) cleanupFailures++
  }
  for (const owner of owners) {
    if (!owner.token) continue
    try {
      const grants = (await ownedApi(owner, '/v2/oauth/grants')).data
      for (const grant of grants ?? []) {
        if (!owner.clients.has(grant.clientId)) continue
        await ownedApi(owner, `/v2/oauth/grants/${encodeURIComponent(String(grant.grantId))}`, { method: 'DELETE', expected: [200, 204] })
      }
    } catch { if (owner.clients.size) cleanupFailures++ }
  }
  evidence('cleanup', { spaces: allSpaces.size, cleanupFailures, remainingAccounts: owners.length, remainingClients: owners.reduce((sum, owner) => sum + owner.clients.size, 0) })
  return cleanupFailures
}
