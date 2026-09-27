import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

test('the production service worker and imported scripts share one scope safely', () => {
  const handlers = new Set()
  const scope = {
    addEventListener: (name) => handlers.add(name),
    console,
    location: { origin: 'https://pinit.go-gradually.me' },
    URL,
  }
  scope.self = scope
  vm.createContext(scope)
  scope.importScripts = (...urls) => {
    for (const url of urls) {
      const path = url.split('?')[0]
      vm.runInContext(readFileSync(join(publicDir, path.slice(1)), 'utf8'), scope, { filename: path })
    }
  }

  vm.runInContext(readFileSync(join(publicDir, 'sw.js'), 'utf8'), scope, { filename: 'sw.js' })

  assert.deepEqual([...handlers], ['install', 'activate', 'fetch', 'push', 'notificationclick'])
  assert.equal(typeof scope.pinitSw.push.showNotificationOnce, 'function')
})
