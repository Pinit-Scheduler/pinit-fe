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

const tour = loadModule('../src/features/onboarding/utils/tour.ts')
const spotlight = loadModule('../src/features/onboarding/utils/spotlight.ts')

// vm 컨텍스트의 객체는 다른 realm이라 deepStrictEqual 전에 평범한 값으로 옮긴다.
const plain = (value) => JSON.parse(JSON.stringify(value))

const guide = {
  behavior: [{ heading: null, items: ['동작'] }],
  principle: [{ heading: null, items: ['원리'] }],
  usage: [{ heading: null, items: ['사용'] }],
}

const tourOf = (key) => ({ route: `/app/${key}`, anchor: `${key}.header`, purpose: `${key} 목적`, benefit: `${key} 이점` })

const makeResponse = ({ acknowledgedRevision = 0, cRevision = 1 } = {}) => ({
  revision: Math.max(1, cRevision),
  acknowledgedRevision,
  pendingTour: [],
  features: [
    { key: 'a', title: '가', revision: 1, tour: tourOf('a'), guide },
    { key: 'b', title: '나', revision: 1, tour: null, guide },
    { key: 'c', title: '다', revision: cRevision, tour: tourOf('c'), guide: null },
  ],
})

test('buildTourSteps follows the given keys and skips unknown or tour-less features', () => {
  const steps = plain(tour.buildTourSteps(makeResponse(), ['c', 'zz', 'b', 'a']))
  assert.deepEqual(
    steps.map((step) => step.key),
    ['c', 'a'],
  )
  assert.deepEqual(steps[0], {
    key: 'c',
    title: '다',
    route: '/app/c',
    anchor: 'c.header',
    purpose: 'c 목적',
    benefit: 'c 이점',
    isNew: false,
  })
  assert.deepEqual(plain(tour.buildTourSteps(makeResponse(), [])), [])
})

test('isNew marks only features revised after a real acknowledgement', () => {
  const fresh = makeResponse({ acknowledgedRevision: 0, cRevision: 2 })
  assert.deepEqual(
    fresh.features.map((feature) => tour.isFeatureNew(fresh, feature)),
    [false, false, false],
  )
  assert.deepEqual(
    plain(tour.buildTourSteps(fresh, ['a', 'c'])).map((step) => step.isNew),
    [false, false],
  )

  const revised = makeResponse({ acknowledgedRevision: 1, cRevision: 2 })
  assert.deepEqual(
    revised.features.map((feature) => tour.isFeatureNew(revised, feature)),
    [false, false, true],
  )
  assert.deepEqual(
    plain(tour.buildTourSteps(revised, ['a', 'c'])).map((step) => step.isNew),
    [false, true],
  )

  const caughtUp = makeResponse({ acknowledgedRevision: 2, cRevision: 2 })
  assert.equal(tour.isFeatureNew(caughtUp, caughtUp.features[2]), false)
})

test('allTourKeys lists toured features in response order', () => {
  assert.deepEqual(plain(tour.allTourKeys(makeResponse())), ['a', 'c'])
  assert.deepEqual(plain(tour.allTourKeys({ ...makeResponse(), features: [] })), [])
})

test('anchorSelector rejects malformed anchors', () => {
  assert.equal(tour.anchorSelector('plan.controls'), '[data-onboarding-anchor="plan.controls"]')
  assert.equal(tour.anchorSelector('task-form.dependencies'), '[data-onboarding-anchor="task-form.dependencies"]')
  for (const invalid of ['plan', 'a"]', '', 'Plan.controls', 'plan.', '.controls', 'plan controls', 'plan.controls"]']) {
    assert.equal(tour.anchorSelector(invalid), null, JSON.stringify(invalid))
  }
})

test('spotlightRect pads and clamps to the viewport', () => {
  const viewport = { width: 375, height: 812 }
  assert.deepEqual(plain(spotlight.spotlightRect({ top: -20, left: 5, width: 100, height: 40 }, viewport)), {
    top: 0,
    left: 0,
    width: 113,
    height: 28,
  })
  assert.deepEqual(plain(spotlight.spotlightRect({ top: 100, left: 20, width: 100, height: 40 }, viewport)), {
    top: 92,
    left: 12,
    width: 116,
    height: 56,
  })
  assert.deepEqual(plain(spotlight.spotlightRect({ top: 800, left: 300, width: 100, height: 40 }, viewport)), {
    top: 792,
    left: 292,
    width: 83,
    height: 20,
  })
  assert.deepEqual(plain(spotlight.spotlightRect({ top: 100, left: 20, width: 100, height: 40 }, viewport, 0)), {
    top: 100,
    left: 20,
    width: 100,
    height: 40,
  })
  const offscreen = plain(spotlight.spotlightRect({ top: 2000, left: 900, width: 50, height: 50 }, viewport))
  assert.equal(offscreen.width, 0)
  assert.equal(offscreen.height, 0)
  assert.ok(offscreen.top <= viewport.height && offscreen.left <= viewport.width)
})

test('calloutPlacement goes below, above, then center', () => {
  const viewport = { width: 375, height: 812 }
  assert.deepEqual(plain(spotlight.calloutPlacement({ top: 100, left: 0, width: 100, height: 50 }, viewport, 200)), {
    placement: 'below',
    top: 162,
  })
  assert.deepEqual(plain(spotlight.calloutPlacement({ top: 700, left: 0, width: 100, height: 50 }, viewport, 200)), {
    placement: 'above',
    top: 488,
  })
  assert.deepEqual(plain(spotlight.calloutPlacement({ top: 150, left: 0, width: 100, height: 550 }, viewport, 200)), {
    placement: 'center',
    top: 306,
  })
  assert.deepEqual(plain(spotlight.calloutPlacement(null, viewport, 200)), { placement: 'center', top: 306 })
  assert.deepEqual(plain(spotlight.calloutPlacement({ top: 100, left: 0, width: 100, height: 50 }, viewport, 200, 20)), {
    placement: 'below',
    top: 170,
  })
})

test('shouldEndTour only when the path drifts from the expected one', () => {
  assert.equal(tour.shouldEndTour('/app/plan', '/app/plan'), false)
  assert.equal(tour.shouldEndTour('/app/plan', '/app/today'), true)
  assert.equal(tour.shouldEndTour(null, '/app/today'), false)
  assert.equal(tour.shouldEndTour(null, '/app/plan'), false)
})
