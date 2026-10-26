import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
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

// vm 컨텍스트의 객체는 다른 realm이라 deepStrictEqual 전에 평범한 값으로 옮긴다.
const plain = (value) => JSON.parse(JSON.stringify(value))

const { onboardingFixture } = loadModule('../src/mocks/onboardingFixture.ts')
const fixture = plain(onboardingFixture)

// ADR-0017 §7 앵커 계약. 백엔드 YAML도 같은 표를 따른다.
const ADR_CONTRACT = {
  today: { route: '/app/today', anchor: 'today.header' },
  tasks: { route: '/app/tasks', anchor: 'tasks.header' },
  dependencies: { route: '/app/tasks/new', anchor: 'task-form.dependencies' },
  schedules: { route: '/app/schedules', anchor: 'schedules.week-strip' },
  'schedule-run': { route: '/app/schedules', anchor: 'schedules.list' },
  planner: { route: '/app/plan', anchor: 'plan.controls' },
  statistics: { route: '/app/statistics', anchor: 'statistics.cards' },
  routines: { route: '/app/settings', anchor: 'settings.routines' },
  notifications: { route: '/app/settings', anchor: 'settings.push' },
  'ai-connection': { route: '/app/settings', anchor: 'settings.ai-connection' },
  onboarding: { route: '/app/settings', anchor: 'settings.onboarding' },
}

const srcDir = fileURLToPath(new URL('../src/', import.meta.url))

const listTsxFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listTsxFiles(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })

test('every fixture anchor exists in the source', () => {
  const sources = listTsxFiles(srcDir).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
  const anchors = fixture.features.filter((feature) => feature.tour).map((feature) => feature.tour.anchor)
  assert.ok(anchors.length > 0)

  const problems = anchors.flatMap((anchor) => {
    const holders = sources.filter(({ text }) => text.includes(`data-onboarding-anchor="${anchor}"`))
    return holders.length === 1 ? [] : [`${anchor}: ${holders.length} files ${holders.map(({ path }) => path).join(', ')}`]
  })
  assert.deepEqual(problems, [])
})

test('fixture keys and anchors match the ADR contract', () => {
  const actual = Object.fromEntries(
    fixture.features.map((feature) => [
      feature.key,
      feature.tour ? { route: feature.tour.route, anchor: feature.tour.anchor } : null,
    ]),
  )
  assert.deepEqual(actual, ADR_CONTRACT)
  assert.deepEqual(Object.keys(actual), Object.keys(ADR_CONTRACT), 'tour order')

  assert.equal(fixture.revision, 1)
  assert.equal(fixture.revision, Math.max(...fixture.features.map((feature) => feature.revision)))
  assert.deepEqual(
    fixture.features.filter((feature) => feature.guide === null).map((feature) => feature.key),
    ['onboarding'],
  )

  const planner = fixture.features.find((feature) => feature.key === 'planner')
  assert.deepEqual(
    planner.guide.principle.map((group) => group.heading),
    ['후보', '우선순위', '시간창과 기존 일정', '하루 목표', '배치 방법', '승인과 재검사', '배치하지 못한 이유'],
  )

  const strings = JSON.stringify(fixture)
  assert.ok(!strings.includes('{{'), 'placeholders are resolved like the server does')
})
