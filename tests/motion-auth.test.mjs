import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

const load = (path) => {
  const { outputText } = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports })
  return module.exports
}

// ---------------------------------------------------------------------------
// AuthGuard entry (audit C7)
// ---------------------------------------------------------------------------

const { resolveAuthEntry } = load('src/features/auth/utils/authEntry.ts')

test('a valid stored token is ready before the first paint, so AuthGuard never renders a blank frame', () => {
  assert.equal(resolveAuthEntry({ loggedOut: false, token: 'a.b.c', isExpired: () => false }), 'ready')
})

test('a missing or expired token waits for a refresh, and a logout marker goes to login first', () => {
  assert.equal(resolveAuthEntry({ loggedOut: false, token: null, isExpired: () => false }), 'refresh')
  assert.equal(resolveAuthEntry({ loggedOut: false, token: 'a.b.c', isExpired: () => true }), 'refresh')
  assert.equal(resolveAuthEntry({ loggedOut: true, token: 'a.b.c', isExpired: () => false }), 'logged-out')
})

test('AuthGuard decides readiness in its state initializer and shows the boot state instead of null', () => {
  const guard = read('src/features/auth/components/AuthGuard.tsx')
  assert.match(guard, /useState\(\(\) => readAuthEntry\(\) === 'ready'\)/)
  assert.match(guard, /if \(!isReady\) return <AuthBoot \/>/)
  assert.doesNotMatch(guard, /return null/)
})

test('the boot state paints the workspace background at once and fades its mark in only after a delay', () => {
  const boot = read('src/features/auth/components/AuthBoot.tsx')
  const css = read('src/features/auth/components/AuthBoot.css')
  assert.match(boot, /className="workspace-theme auth-boot"/)
  assert.match(boot, /role="status"/)
  assert.match(css, /--auth-boot-delay: calc\(var\(--motion-status-delay\) \* 2\)/)
  for (const selector of ['.auth-boot__mark', '.auth-boot__line'])
    assert.match(css, new RegExp(`\\${selector} \\{[^}]*var\\(--auth-boot-delay\\) both`), selector)
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

test('auth form messages fade in and out through presence instead of popping', () => {
  const message = read('src/features/auth/components/AuthMessage.tsx')
  assert.match(message, /usePresence\(message \|\| null\)/)
  assert.match(message, /data-state=\{presence\.closing \? 'closing' : 'open'\}/)
  for (const page of ['LoginPage', 'SignupPage']) {
    const source = read(`src/features/auth/pages/${page}.tsx`)
    assert.doesNotMatch(source, /errors\.\w+ && </, `${page} renders errors through AuthMessage`)
    assert.match(source, /aria-busy=\{isSubmitting \|\| undefined\}/, `${page} marks the pending submit`)
  }
})

test('the landing page redirects signed-in users without painting and keeps every slide mounted', () => {
  const page = read('src/features/landing/pages/LandingPage.tsx')
  assert.doesNotMatch(page, /useEffect/)
  assert.match(page, /if \(hasToken\) return <Navigate to="\/app\/schedules" replace \/>/)
  assert.match(page, /slides\.map\(\(slide, index\) => \{/)
  assert.match(page, /data-position=\{isActive \? 'current' : index < currentSlide \? 'before' : 'after'\}/)
  assert.match(page, /inert=\{!isActive \|\| undefined\}/)
})

test('app banners keep mounted through their exit and only drop in when they appear after the page', () => {
  const banners = read('src/shared/components/layout/AppBanners.tsx')
  const css = read('src/shared/components/layout/AppBanners.css')
  assert.equal(banners.match(/= useBannerPresence\(/g)?.length, 3, 'every banner uses the presence helper')
  assert.match(banners, /'data-enter': arrivedWithPage \? undefined : ''/)
  assert.match(css, /\.app-banner\[data-enter\] \{\s*animation: motion-drop-in/)
  assert.match(css, /\.app-banner\[data-state='closing'\] \{\s*animation: motion-fade-out/)
})

const ownedCss = [
  'src/features/auth/components/AuthBoot.css',
  'src/features/auth/pages/LoginPage.css',
  'src/features/landing/pages/LandingPage.css',
  'src/shared/components/layout/AppBanners.css',
]

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

test('a pending submit waits the status delay before its hairline and never dims the fields', () => {
  const css = read('src/features/auth/pages/LoginPage.css')
  assert.match(
    css,
    /\.login__btn\[aria-busy='true'\]::before \{[^}]*animation: login-pending 2400ms var\(--motion-ease\) var\(--motion-status-delay\) both;/,
  )
  assert.doesNotMatch(css, /input:disabled[^{]*\{[^}]*opacity/)
})
