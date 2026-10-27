import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const loadModule = (relativePath) => {
  const { outputText } = ts.transpileModule(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, Set })
  return module.exports
}

const pwa = loadModule('../src/shared/pwa/installPrompt.ts')

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1',
  iphoneKakao: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.6.5',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
}

test('only iOS Safari gets the share-menu hint, including iPadOS in desktop mode', () => {
  assert.equal(pwa.isIosSafari(UA.iphoneSafari), true)
  assert.equal(pwa.isIosSafari(UA.ipadDesktopMode, 5), true)
  assert.equal(pwa.isIosSafari(UA.ipadDesktopMode, 0), false)
  assert.equal(pwa.isIosSafari(UA.iphoneChrome), false)
  assert.equal(pwa.isIosSafari(UA.iphoneKakao), false)
  assert.equal(pwa.isIosSafari(UA.androidChrome), false)
})

test('an installed app never shows the banner; a browser prompt wins over the iOS hint', () => {
  assert.equal(pwa.installAvailability({ standalone: true, hasPrompt: true, iosSafari: true }), 'none')
  assert.equal(pwa.installAvailability({ standalone: false, hasPrompt: true, iosSafari: false }), 'prompt')
  assert.equal(pwa.installAvailability({ standalone: false, hasPrompt: false, iosSafari: true }), 'ios')
  assert.equal(pwa.installAvailability({ standalone: false, hasPrompt: false, iosSafari: false }), 'none')
})

test('without a saved browser prompt, install reports unavailable', async () => {
  assert.equal(await pwa.promptInstall(), 'unavailable')
})
