import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const duration = loadModule('../src/shared/utils/isoDuration.ts')
const calibration = loadModule('../src/features/calibration/utils/calibrationView.ts', {
  '@shared/utils/isoDuration': duration,
})

const plain = (value) => JSON.parse(JSON.stringify(value))

test('factors and ratios print without trailing zeros', () => {
  assert.equal(calibration.formatFactor(1.6), '×1.6')
  assert.equal(calibration.formatFactor(1.0), '×1')
  assert.equal(calibration.formatFactor(0.5), '×0.5')
  assert.equal(calibration.formatFactor(1.35), '×1.35')
  assert.equal(calibration.formatFactor(null), '-')
  assert.equal(calibration.formatFactor(undefined), '-')
})

test('accuracy prints as a whole percent', () => {
  assert.equal(calibration.formatAccuracy(0.75), '75%')
  assert.equal(calibration.formatAccuracy(0.33), '33%')
  assert.equal(calibration.formatAccuracy(0), '0%')
  assert.equal(calibration.formatAccuracy(1), '100%')
  assert.equal(calibration.formatAccuracy(null), '-')
})

test('a calibrated block explains its length; an uncalibrated one says nothing', () => {
  assert.equal(
    calibration.blockCalibrationNote({
      duration: 'PT1H15M', baseDuration: 'PT45M', calibrationFactor: 1.6, factorSource: 'DIFFICULTY',
    }),
    '예상 45분 → 1시간 15분 (같은 난이도 기록 ×1.6)',
  )
  assert.equal(
    calibration.blockCalibrationNote({
      duration: 'PT45M', baseDuration: 'PT1H30M', calibrationFactor: 0.5, factorSource: 'OVERALL',
    }),
    '예상 1시간 30분 → 45분 (전체 기록 ×0.5)',
  )
  for (const block of [
    { duration: 'PT45M', baseDuration: 'PT45M', calibrationFactor: 1, factorSource: 'NONE' },
    { duration: 'PT45M', baseDuration: 'PT45M', calibrationFactor: 1, factorSource: 'DIFFICULTY' },
    { duration: 'PT45M' },
    { duration: 'PT45M', baseDuration: 'bogus', calibrationFactor: 1.6, factorSource: 'DIFFICULTY' },
  ]) {
    assert.equal(calibration.blockCalibrationNote(block), null, JSON.stringify(block))
  }
})

test('a factor is usable when any difficulty has one from history', () => {
  const none = { byDifficulty: [{ difficulty: 1, source: 'NONE' }, { difficulty: 5, source: 'NONE' }] }
  const some = { byDifficulty: [{ difficulty: 1, source: 'NONE' }, { difficulty: 5, source: 'DIFFICULTY' }] }
  const overall = { byDifficulty: [{ difficulty: 1, source: 'OVERALL' }] }
  assert.equal(calibration.hasUsableFactor(none), false)
  assert.equal(calibration.hasUsableFactor(some), true)
  assert.equal(calibration.hasUsableFactor(overall), true)
  assert.equal(calibration.hasUsableFactor(null), false)
  assert.equal(calibration.hasUsableFactor({}), false)
})

test('weeks start on Monday', () => {
  assert.equal(calibration.weekStartOf('2026-10-26'), '2026-10-26')
  assert.equal(calibration.weekStartOf('2026-10-27'), '2026-10-26')
  assert.equal(calibration.weekStartOf('2026-11-01'), '2026-10-26')
  assert.equal(calibration.weekStartOf('2026-11-02'), '2026-11-02')
  assert.equal(calibration.weekStartOf('2027-01-01'), '2026-12-28')
  assert.equal(calibration.weekStartOf('not a date'), null)
})

test('the median ratio becomes one plain sentence', () => {
  assert.equal(calibration.ratioSentence(null), '이번 주에는 측정된 일정이 없어요.')
  assert.equal(calibration.ratioSentence(1.6), '예상보다 보통 1.6배 걸렸어요.')
  assert.equal(calibration.ratioSentence(0.7), '예상보다 보통 빨리 끝났어요 (×0.7).')
  assert.equal(calibration.ratioSentence(1.04), '예상과 거의 같았어요.')
  assert.equal(calibration.ratioSentence(0.96), '예상과 거의 같았어요.')
})

test('unmeasured schedules are listed only when there are some', () => {
  assert.deepEqual(
    plain(calibration.unmeasuredLines({ noTimer: 0, taskCompletedOnly: 0, running: 0, runningElapsed: 'PT0S', outlier: 0 })),
    [],
  )
  assert.deepEqual(
    plain(calibration.unmeasuredLines({ noTimer: 2, taskCompletedOnly: 1, running: 1, runningElapsed: 'PT25M', outlier: 1 })),
    [
      '타이머 없이 완료 2건 · 시작을 누르고 완료하면 측정돼요',
      '작업만 완료하고 일정은 끝내지 않음 1건',
      '진행 중·일시정지 1건 (지금까지 25분)',
      '예상과 너무 달라 제외 1건',
    ],
  )
})

test('difficulty factors read as a table row', () => {
  assert.deepEqual(
    plain(calibration.factorRow({ difficulty: 5, factor: 1.6, rawMedian: 1.62, sampleCount: 7, source: 'DIFFICULTY' })),
    { difficulty: '난이도 5', factor: '×1.6', detail: '기록 7건' },
  )
  assert.deepEqual(
    plain(calibration.factorRow({ difficulty: 8, factor: 1.3, rawMedian: 2, sampleCount: 2, source: 'OVERALL' })),
    { difficulty: '난이도 8', factor: '×1.3', detail: '기록 2건 · 전체 기록 사용' },
  )
  assert.deepEqual(
    plain(calibration.factorRow({ difficulty: 21, factor: 1, rawMedian: null, sampleCount: 0, source: 'NONE' })),
    { difficulty: '난이도 21', factor: '×1', detail: '기록 부족' },
  )
})
