import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { expect } from '@playwright/test'
import { API, CANONICAL, SCOPES } from './constants.mjs'
import { api } from './http.mjs'
import { readPublic } from './preflight.mjs'
import { check, QaFailure, evidence } from './safe.mjs'
import { mutation, route } from './ui.mjs'

// A genuine loopback OAuth client receives the real redirect. No API request is
// intercepted and callback/code/token values never enter logs or screenshots.
export async function oauthUi(owner) {
  let pending = null
  const tokens = []
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (request.method !== 'GET' || url.pathname !== '/callback' || !pending) { response.writeHead(404).end(); return }
      const next = pending
      pending = null
      next({ code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.has('error') })
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end('<!doctype html><title>QA OAuth callback</title><p>OAuth callback received.</p>')
    } catch { response.writeHead(400).end() }
  })
  await new Promise((resolve, reject) => { server.once('error', () => reject(new QaFailure('OAUTH_CALLBACK_FAILED'))); server.listen(0, '127.0.0.1', resolve) })
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`
  let clientId
  try {
    const resourceMetadata = await readPublic('/.well-known/oauth-protected-resource/mcp')
    check(typeof resourceMetadata.resource === 'string' && new URL(resourceMetadata.resource).origin === API, 'OAUTH_RESOURCE_REQUIRED')
    const registered = await api('/oauth/register', { method: 'POST', json: { client_name: 'Pinit browser QA', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }, expected: [201] })
    clientId = registered.data?.client_id
    check(typeof clientId === 'string', 'OAUTH_CLIENT_REQUIRED')
    owner.clients.add(clientId)
    for (const spaces of [false, true]) {
      const requested = spaces ? SCOPES : SCOPES.filter((scope) => scope !== 'mcp:spaces')
      const verifier = randomBytes(48).toString('base64url')
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      const state = randomBytes(16).toString('base64url')
      const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', resource: resourceMetadata.resource, scope: requested.join(' '), state })
      const authorization = await api('/oauth/authorize?' + query, { expected: [302], redirect: 'manual' })
      const consent = new URL(authorization.location)
      check(consent.origin === CANONICAL && consent.pathname === '/oauth/consent' && consent.searchParams.has('request'), 'OAUTH_CONSENT_ORIGIN_REQUIRED')
      await route(owner.page, consent.pathname + consent.search)
      const read = owner.page.getByRole('checkbox', { name: /일정·작업 보기/ })
      await expect(read).toBeChecked()
      await expect(read).toBeDisabled()
      await expect(owner.page.getByRole('checkbox', { name: /일정·작업 만들기·수정·상태 변경/ })).toBeChecked()
      const destructive = owner.page.getByRole('checkbox', { name: /일정·작업 삭제/ })
      await expect(destructive).not.toBeChecked()
      await destructive.check()
      const optIn = owner.page.getByRole('checkbox', { name: /공간·프로젝트 및 공유 업무 도구 사용/ })
      if (spaces) { await expect(optIn).not.toBeChecked(); await optIn.check() }
      else await expect(optIn).toHaveCount(0)
      let timer
      const callback = new Promise((resolve, reject) => {
        pending = resolve
        timer = setTimeout(() => { pending = null; reject(new QaFailure('OAUTH_CALLBACK_FAILED')) }, 20_000)
      })
      let decision, returned
      try {
        ;[decision, returned] = await Promise.all([
          // The app consumes redirectUri and performs a full navigation. Retain
          // the real HTTP status, then verify the actual callback and token
          // scopes; the old renderer may no longer expose response body bytes.
          mutation(owner.page, '/oauth/authorize/decision', 'POST', () => owner.page.getByRole('button', { name: '허용', exact: true }).click(), [200], { readBody: false }),
          callback,
        ])
      } finally { clearTimeout(timer) }
      check(decision.response.status() === 200 && returned.state === state && returned.code && !returned.error, 'OAUTH_CALLBACK_STATE_REQUIRED')
      const issued = await api('/oauth/token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: clientId, code: returned.code, code_verifier: verifier, redirect_uri: redirectUri, resource: resourceMetadata.resource } })
      check(typeof issued.data?.access_token === 'string' && typeof issued.data?.refresh_token === 'string', 'OAUTH_TOKEN_REQUIRED')
      tokens.push(issued.data.refresh_token)
      const granted = new Set(String(issued.data.scope).split(' '))
      check(requested.every((scope) => granted.has(scope)) && granted.size === requested.length, 'OAUTH_EXPLICIT_SCOPE_REQUIRED')
      if (!spaces) check(!granted.has('mcp:spaces'), 'LEGACY_SCOPES_NOT_EXPANDED')
      evidence('scenario', { code: spaces ? 'OAUTH_FOUR_EXPLICIT_SCOPES' : 'OAUTH_OLD_THREE_SCOPES', ok: true, scopes: granted.size })
    }
  } finally {
    let revokeFailed = false
    for (const token of tokens) {
      try { await api('/oauth/revoke', { method: 'POST', form: { client_id: clientId, token } }) }
      catch { revokeFailed = true; evidence('cleanup', { code: 'OAUTH_REVOKE_FAILED', ok: false }) }
    }
    await new Promise((resolve) => server.close(resolve))
    check(!revokeFailed, 'OAUTH_REVOKE_FAILED')
  }
}
