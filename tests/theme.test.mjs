import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const loadModule = (relativePath) => {
  const { outputText } = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports })
  return module.exports
}

const theme = loadModule('../src/shared/theme/theme.ts')

const memoryStorage = () => {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  }
}

test('unknown or missing stored values fall back to the system theme', () => {
  assert.equal(theme.parseThemePreference(null), 'system')
  assert.equal(theme.parseThemePreference('sepia'), 'system')
  assert.equal(theme.parseThemePreference('dark'), 'dark')
})

test('choosing system clears the stored choice so the OS setting wins', () => {
  const storage = memoryStorage()
  theme.writeThemePreference('dark', storage)
  assert.equal(theme.readThemePreference(storage), 'dark')
  theme.writeThemePreference('system', storage)
  assert.equal(storage.map.size, 0)
  assert.equal(theme.readThemePreference(storage), 'system')
})

test('a storage that throws reads as system and ignores writes', () => {
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => {} }
  assert.equal(theme.readThemePreference(broken), 'system')
  assert.doesNotThrow(() => theme.writeThemePreference('light', broken))
})

test('system resolves from prefers-color-scheme, explicit choices ignore it', () => {
  assert.equal(theme.resolveTheme('system', true), 'dark')
  assert.equal(theme.resolveTheme('system', false), 'light')
  assert.equal(theme.resolveTheme('light', true), 'light')
})

test('the pre-render script in index.html uses the same storage key', () => {
  assert.ok(read('../index.html').includes(`localStorage.getItem('${theme.THEME_STORAGE_KEY}')`))
})

test('every light palette token has a dark value in both dark selectors', () => {
  const css = read('../src/shared/styles/theme.css')
  const block = (selector) => {
    const start = css.indexOf(`${selector} {`)
    assert.ok(start >= 0, `${selector} missing`)
    return new Set([...css.slice(start, css.indexOf('}', start)).matchAll(/(--c-[a-z0-9-]+):/g)].map((m) => m[1]))
  }
  const light = block(':root')
  for (const selector of [":root[data-theme='dark']", ":root:not([data-theme='light'])"]) {
    assert.deepEqual([...block(selector)].sort(), [...light].sort(), selector)
  }
})
