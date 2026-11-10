import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { hookRunner } from './support/hooks.mjs'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

const load = (path, dependencies = {}, globals = {}) => {
  const { outputText } = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name.endsWith('.css')) return {}
      assert.ok(name in dependencies, 'Unexpected dependency ' + name)
      return dependencies[name]
    },
    ...globals,
  })
  return module.exports
}

const ui = { react: React, 'react/jsx-runtime': jsxRuntime }
const html = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props))

// ---------------------------------------------------------------------------
// AuthGuard entry (audit C7)
// ---------------------------------------------------------------------------

const authEntry = load('src/features/auth/utils/authEntry.ts')
const { resolveAuthEntry } = authEntry

test('a valid stored token is ready before the first paint, so AuthGuard never renders a blank frame', () => {
  assert.equal(resolveAuthEntry({ loggedOut: false, token: 'a.b.c', isExpired: () => false }), 'ready')
})

test('a missing or expired token waits for a refresh, and a logout marker goes to login first', () => {
  assert.equal(resolveAuthEntry({ loggedOut: false, token: null, isExpired: () => false }), 'refresh')
  assert.equal(resolveAuthEntry({ loggedOut: false, token: 'a.b.c', isExpired: () => true }), 'refresh')
  assert.equal(resolveAuthEntry({ loggedOut: true, token: 'a.b.c', isExpired: () => false }), 'logged-out')
})

const AuthBoot = load('src/features/auth/components/AuthBoot.tsx', ui).default

const authGuard = (token) =>
  load('src/features/auth/components/AuthGuard.tsx', {
    ...ui,
    'react-router-dom': { Outlet: () => React.createElement('main', null, 'page'), useNavigate: () => () => {} },
    '../api/auth': { refreshAccessToken: async () => {} },
    '@shared/api/authTokens': {
      clearAuthTokens() {},
      getAccessToken: () => token,
      isAccessTokenExpired: () => false,
      isLoggedOut: () => false,
    },
    '../utils/returnTo': { rememberReturnTo() {} },
    '../utils/authEntry': authEntry,
    './AuthBoot': { default: AuthBoot },
  }).default

test('AuthGuard paints the page in its first frame for a valid token, and the boot state instead of nothing', () => {
  assert.equal(html(authGuard('a.b.c')), '<main>page</main>')
  const boot = html(authGuard(null))
  assert.match(boot, /<div class="workspace-theme auth-boot" role="status"/, 'the workspace background paints at once')
  assert.match(boot, /로그인 상태를 확인하는 중이에요/)
})

// ---------------------------------------------------------------------------
// Cold paint (audit css-motion A5/A6)
// ---------------------------------------------------------------------------

test('index.html paints the workspace background in light and dark before any CSS loads', () => {
  const html = read('index.html')
  const palette = read('src/shared/styles/workspacePalette.css')
  const [light, dark] = [...palette.matchAll(/--workspace-bg: (#[0-9a-f]+);/g)].map((m) => m[1])
  assert.ok(light && dark, 'workspace backgrounds found')
  assert.match(html, /<meta name="color-scheme" content="light dark" \/>/)
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1]
  assert.ok(style, 'inline style present')
  assert.ok(html.indexOf('<style>') < html.indexOf('<script type="module"'), 'style comes before the app')
  assert.match(style, new RegExp(`:where\\(html\\) \\{ color-scheme: light; background-color: ${light}; \\}`))
  assert.match(style, new RegExp(`:where\\(html\\[data-theme='dark'\\]\\) \\{ color-scheme: dark; background-color: ${dark}; \\}`))
  assert.match(
    style,
    new RegExp(`@media \\(prefers-color-scheme: dark\\) \\{\\s*:where\\(html:not\\(\\[data-theme='light'\\]\\)\\) \\{ color-scheme: dark; background-color: ${dark}; \\}`),
  )
  // Zero specificity: once index.css and theme.css load, their :root rules always win.
  assert.doesNotMatch(style.replace(/\/\*[\s\S]*?\*\//g, ''), /(^|\n)\s*html[\s[{:]/)
})

// ---------------------------------------------------------------------------
// Forms, landing and banners
// ---------------------------------------------------------------------------

const motionTokens = load('src/shared/motion/tokens.ts', {}, { window: undefined })
const presence = load('src/shared/motion/presence.ts')
const usePresenceWith = (react) =>
  load('src/shared/motion/usePresence.ts', { react, './presence': presence, './tokens': motionTokens }, { setTimeout, clearTimeout })

test('an auth form message renders open with the text unchanged, and nothing when there is none', () => {
  const AuthMessage = load('src/features/auth/components/AuthMessage.tsx', {
    ...ui,
    '@shared/motion/usePresence': usePresenceWith(React),
  }).default
  assert.equal(html(AuthMessage, { message: '아이디를 입력해 주세요.' }), '<small class="auth-message" data-state="open">아이디를 입력해 주세요.</small>')
  assert.equal(html(AuthMessage, { message: '서버 문구', as: 'p', className: 'login__error' }), '<p class="auth-message login__error" data-state="open">서버 문구</p>')
  assert.equal(html(AuthMessage, { message: '' }), '')
})

const landingPage = (token) =>
  load('src/features/landing/pages/LandingPage.tsx', {
    ...ui,
    'react-router-dom': {
      Link: ({ to, children, className }) => React.createElement('a', { href: to, className }, children),
      Navigate: ({ to }) => React.createElement('meta', { 'data-navigate': to }),
    },
    '@shared/api/authTokens': { getAccessToken: () => token },
  }).default

test('the landing page sends signed-in users to the app without painting the introduction', () => {
  assert.equal(html(landingPage('a.b.c')), '<meta data-navigate="/app/schedules"/>')
})

test('the landing page keeps every slide mounted and only the current one reachable', () => {
  const markup = html(landingPage(null))
  const panels = [...markup.matchAll(/<div class="landing__slide-panel"([^>]*)>/g)].map((match) => match[1])
  assert.ok(panels.length > 1, 'every slide is in the page')
  assert.equal(panels[0], ' data-position="current"')
  for (const rest of panels.slice(1)) assert.equal(rest, ' data-position="after" aria-hidden="true" inert=""')
})

const banners = (online) => {
  const runner = hookRunner()
  const element = (type, props) => ({ type, props })
  const module = load('src/shared/components/layout/AppBanners.tsx', {
    react: runner.react,
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' },
    '@shared/components/common/WorkspaceIcon': { default: () => null },
    '@shared/hooks/useOnlineStatus': { default: () => online.current },
    '@shared/motion/usePresence': usePresenceWith(runner.react),
    '@shared/pwa/installPrompt': {},
    '@shared/utils/safeStorage': {},
  })
  return () => runner.render(module.OfflineBanner)?.props
}

test('a banner already there with the page does not drop in; one that appears later does, and fades out', () => {
  const withPage = banners({ current: false })
  assert.equal(withPage()['data-enter'], undefined)
  assert.equal(withPage()['data-state'], 'open')

  const online = { current: true }
  const later = banners(online)
  assert.equal(later(), undefined, 'nothing renders while online')
  online.current = false
  assert.equal(later()['data-enter'], '', 'a banner that appears while the person is looking drops in')
  online.current = true
  const leaving = later()
  assert.equal(leaving['data-state'], 'closing', 'it stays mounted through its exit')
  assert.equal(leaving['aria-hidden'], true)
})

const ownedCss = [
  'src/features/auth/components/AuthBoot.css',
  'src/features/auth/pages/LoginPage.css',
  'src/features/landing/pages/LandingPage.css',
  'src/shared/components/layout/AppBanners.css',
]

// Source check kept: CSS never runs in these tests, so the motion contract is read from the stylesheets.
test('motion in the auth, landing and banner styles follows the contract', () => {
  const shared = ['modalFadeIn', 'modalSlideUp', 'fadeIn', 'fadeSlideIn']
  for (const path of ownedCss) {
    const css = read(path)
    assert.doesNotMatch(css, /transition:\s*all/, `${path}: no transition: all`)
    assert.doesNotMatch(css, /infinite/, `${path}: no loops`)
    assert.doesNotMatch(css, /:hover[^{]*\{[^}]*translate/, `${path}: nothing moves on hover`)
    for (const match of css.matchAll(/@keyframes ([\w-]+)/g))
      assert.ok(!match[1].startsWith('motion-') && !shared.includes(match[1]), `${path}: ${match[1]} is a shared name`)
    for (const block of css.matchAll(/transition:([^;]+);/g))
      assert.doesNotMatch(block[1], /\b(width|height|top|left|margin|filter|box-shadow)\b/, `${path}: ${block[1].trim()}`)
    if (/animation|transition/.test(css))
      assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, `${path}: reduced motion handled`)
  }
})
