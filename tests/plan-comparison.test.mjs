import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
const module = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL(
        '../src/features/statistics/utils/planComparison.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { module, exports: module.exports, Map },
)
const { summarizePlans } = module.exports
test('planned totals deduplicate overlapping week requests and keep period end exclusive', () => {
  const a = {
    id: 1,
    date: '2026-11-03',
    state: 'COMPLETED',
    plannedMinutes: 60,
  }
  const result = summarizePlans(
    [
      a,
      a,
      { id: 2, date: '2026-11-04', state: 'NOT_STARTED', plannedMinutes: 30 },
      { id: 3, date: '2026-12-01', state: 'COMPLETED', plannedMinutes: 90 },
    ],
    '2026-11-01',
    '2026-12-01',
  )
  assert.equal(result.totalPlanned, 90)
  assert.equal(result.completedPlanned, 60)
  assert.equal(result.total, 2)
})
test('a missing planned duration is reported, never replaced with actual runtime', () => {
  const result = summarizePlans(
    [{ id: 1, date: '2026-11-03', state: 'COMPLETED', plannedMinutes: null }],
    '2026-11-01',
    '2026-12-01',
  )
  assert.equal(result.unknown, 1)
  assert.equal(result.completedPlanned, 0)
  assert.equal(result.states.COMPLETED, 1)
})
