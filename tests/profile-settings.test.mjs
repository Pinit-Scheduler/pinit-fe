import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const loadModule = (relativePath, dependencies = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  })
  return module.exports
}

const require = createRequire(import.meta.url)
const dayjsDependencies = Object.fromEntries(
  ['dayjs', 'dayjs/plugin/utc', 'dayjs/plugin/timezone', 'dayjs/plugin/isoWeek', 'dayjs/plugin/weekday', 'dayjs/locale/ko']
    // 소스는 default import를 쓰고 transpile은 interop 없이 CommonJS로 바꾸므로 default로 감싼다
    .map((name) => [name, { __esModule: true, default: require(name) }]),
)

const settings = loadModule('../src/features/settings/utils/profileSettings.ts')
const storage = loadModule('../src/shared/utils/safeStorage.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))

test('daily objective options run from 30 minutes to 16 hours in 30-minute steps', () => {
  const options = plain(settings.dailyObjectiveOptions(240))
  assert.equal(options.length, 32)
  assert.equal(options[0], 30)
  assert.equal(options.at(-1), 960)
  assert.ok(options.includes(240))
})

test('an off-grid objective set through the API stays selectable in order', () => {
  const options = plain(settings.dailyObjectiveOptions(95))
  assert.equal(options.length, 33)
  assert.deepEqual(options.slice(0, 4), [30, 60, 90, 95])
  assert.equal(plain(settings.dailyObjectiveOptions(null)).length, 32)
})

test('time zone options keep only IANA regions and always offer UTC, current and device zones', () => {
  const options = plain(
    settings.timeZoneOptions(['Europe/London', 'Asia/Seoul', '+09:00', 'EST', 'America/Port-au-Prince'], 'Asia/Tokyo', 'America/Argentina/Buenos_Aires'),
  )
  assert.deepEqual(options, [
    'America/Argentina/Buenos_Aires',
    'America/Port-au-Prince',
    'Asia/Seoul',
    'Asia/Tokyo',
    'Europe/London',
    'UTC',
  ])
  assert.deepEqual(plain(settings.timeZoneOptions([], null, null)), ['UTC'])
})

test('the device zone is suggested only when it differs from the member zone', () => {
  assert.equal(settings.suggestedDeviceZone('Asia/Seoul', 'America/New_York'), 'America/New_York')
  assert.equal(settings.suggestedDeviceZone('Asia/Seoul', 'Asia/Seoul'), null)
  assert.equal(settings.suggestedDeviceZone(null, 'America/New_York'), null)
  assert.equal(settings.suggestedDeviceZone('Asia/Seoul', 'GMT+9'), null)
})

test('the last member zone is stored and read back, and storage failures fall back to null', () => {
  const memory = new Map()
  const fake = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) }
  assert.equal(storage.readText(storage.STORAGE_KEYS.displayZoneId, fake), null)
  storage.writeText(storage.STORAGE_KEYS.displayZoneId, 'America/New_York', fake)
  assert.equal(storage.readText(storage.STORAGE_KEYS.displayZoneId, fake), 'America/New_York')

  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(storage.readText('x', broken), null)
  assert.doesNotThrow(() => storage.writeText('x', 'y', broken))
})

test('the display zone switches to any region the browser knows and ignores unknown ids', () => {
  const datetime = loadModule('../src/shared/utils/datetime.ts', dayjsDependencies)
  assert.equal(datetime.getDisplayZoneId(), 'Asia/Seoul')

  assert.equal(datetime.setDisplayZone('America/New_York'), 'America/New_York')
  assert.equal(datetime.getDisplayZoneId(), 'America/New_York')
  assert.equal(datetime.getDisplayOffsetMinutes(), datetime.getZoneOffsetMinutes('America/New_York'))

  assert.equal(datetime.setDisplayZone('UTC'), 'UTC')
  assert.equal(datetime.setDisplayZone('Asia/Seoul'), 'Asia/Seoul')
  assert.equal(datetime.getDisplayOffsetMinutes(), 540)

  assert.equal(datetime.setDisplayZone('Mars/Olympus'), 'Asia/Seoul')
})
