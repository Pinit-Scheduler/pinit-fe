import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const load = (relative) => {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require,
    console,
  })
  return module.exports
}
const dates = load('../src/shared/utils/datetime.ts')
const { saveTaskCompletion } = load(
  '../src/features/tasks/utils/taskCompletion.ts',
)
const { applyMockTaskDependencies, recomputeMockTaskReadiness } = load(
  '../src/mocks/taskDependencies.ts',
)

test('deadline formatting and edit values preserve the calendar day across browser zones', () => {
  const prior = process.env.TZ
  try {
    for (const browser of [
      'Pacific/Honolulu',
      'Pacific/Kiritimati',
      'UTC',
      'Asia/Seoul',
    ]) {
      process.env.TZ = browser
      for (const due of [
        { date: '2026-11-03', zoneId: 'Asia/Seoul', offset: '+09:00' },
        {
          date: '2026-11-03',
          zoneId: 'America/Los_Angeles',
          offset: 'UTC-08:00',
        },
      ]) {
        assert.equal(
          dates.formatDateWithOffset(due, 'YYYY-MM-DD'),
          '2026-11-03',
        )
        assert.equal(
          dates.toDayjsFromDateWithOffset(due).format('YYYY-MM-DD'),
          '2026-11-03',
        )
        assert.equal(
          dates.toApiDateWithOffset('2026-11-03', due.zoneId).date,
          '2026-11-03',
        )
      }
    }
  } finally {
    if (prior === undefined) delete process.env.TZ
    else process.env.TZ = prior
  }
})
test('task mutation succeeds even if refresh fails, and publishes known saved state exactly once', async () => {
  const published = [],
    original = { id: 1, title: 'Task', completed: false, isCompleted: false }
  let mutations = 0
  const result = await saveTaskCompletion(original, {
    mutate: async () => {
      mutations++
      return { ...original, completed: true, isCompleted: true, version: 8 }
    },
    refresh: async () => {
      throw Error('offline')
    },
    onSaved: (task) => published.push(task),
  })
  assert.equal(mutations, 1)
  assert.equal(published.length, 1)
  assert.equal(published[0].completed, true)
  assert.equal(result.task.completed, true)
  assert.equal(result.task.version, 8)
  assert.match(result.refreshError, /상태는 저장/)
  assert.equal(original.completed, false)
})
test('failed mutation neither publishes a fake completion nor tries detail refresh', async () => {
  let publishes = 0,
    refreshes = 0
  await assert.rejects(
    saveTaskCompletion(
      { id: 1, completed: false },
      {
        mutate: async () => {
          throw Error('rejected')
        },
        refresh: async () => {
          refreshes++
        },
        onSaved: () => {
          publishes++
        },
      },
    ),
    /rejected/,
  )
  assert.equal(publishes, 0)
  assert.equal(refreshes, 0)
})
test('mock dependency additions/removals are bidirectional, update readiness and preserve records on rejected cycles', () => {
  const tasks = [
    {
      id: 1,
      completed: false,
      nextTaskIds: [2],
      tags: [{ id: 5, name: 'unchanged' }],
    },
    { id: 2, completed: false, previousTaskIds: [1] },
    { id: 3, completed: false },
  ]
  assert.equal(
    applyMockTaskDependencies(tasks, 3, {
      addDependencies: [{ fromId: 1, toId: 0 }],
    }).ok,
    true,
  )
  assert.deepEqual(JSON.parse(JSON.stringify(tasks[2].previousTaskIds)), [1])
  assert.ok(tasks[0].nextTaskIds.includes(3))
  assert.equal(tasks[2].inboundDependencyCount, 1)
  const before = JSON.stringify(tasks)
  assert.equal(
    applyMockTaskDependencies(tasks, 1, {
      addDependencies: [{ fromId: 3, toId: 1 }],
    }).ok,
    false,
  )
  assert.equal(JSON.stringify(tasks), before)
  assert.equal(
    applyMockTaskDependencies(tasks, 3, {
      removeDependencies: [{ fromId: 1, toId: 3 }],
    }).ok,
    true,
  )
  assert.deepEqual(JSON.parse(JSON.stringify(tasks[2].previousTaskIds)), [])
  tasks[0].completed = true
  recomputeMockTaskReadiness(tasks)
  assert.equal(tasks[1].inboundDependencyCount, 0)
  assert.deepEqual(tasks[0].tags, [{ id: 5, name: 'unchanged' }])
})
test('mock dependency checks reject self/missing/cross-owner edges', () => {
  const tasks = [
    { id: 1, ownerId: 1 },
    { id: 2, ownerId: 2 },
  ]
  assert.equal(
    applyMockTaskDependencies(tasks, 1, {
      addDependencies: [{ fromId: 1, toId: 1 }],
    }).status,
    409,
  )
  assert.equal(
    applyMockTaskDependencies(tasks, 1, {
      addDependencies: [{ fromId: 1, toId: 2 }],
    }).status,
    400,
  )
  assert.equal(
    applyMockTaskDependencies(tasks, 1, {
      addDependencies: [{ fromId: 1, toId: 99 }],
    }).status,
    400,
  )
})
