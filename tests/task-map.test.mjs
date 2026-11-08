import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const load = (name) => {
  const source = readFileSync(
    new URL(`../src/features/task-map/${name}.ts`, import.meta.url),
    'utf8',
  )
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    AbortController,
  })
  return module.exports
}
const { buildTaskGraph, taskReadiness, matrixQuadrant, fitGraph, zoomGraph } =
  load('graph')
const { collectTaskGraph } = load('graphData')
const plain = (value) => JSON.parse(JSON.stringify(value))
const task = (id, extra = {}) => ({
  id,
  title: `Task ${id}`,
  description: '',
  dueDate: { date: '2026-11-03', zoneId: 'Asia/Seoul' },
  importance: 7,
  difficulty: 3,
  completed: false,
  inboundDependencyCount: 0,
  previousTaskIds: [],
  nextTaskIds: [],
  ...extra,
})
const today = '2026-11-03'

test('server inbound count is authoritative even when graph dependencies are missing', () => {
  assert.equal(
    taskReadiness(
      task(1, { previousTaskIds: [99], inboundDependencyCount: 2 }),
    ),
    'blocked',
  )
  assert.equal(
    taskReadiness(
      task(1, { previousTaskIds: [99], inboundDependencyCount: 0 }),
    ),
    'ready',
  )
  assert.equal(
    taskReadiness(task(1, { inboundDependencyCount: undefined })),
    'unknown',
  )
})
test('branch and merge layout preserves unique nodes, edge direction and source records', () => {
  const records = [
    task(1, { nextTaskIds: [2, 3] }),
    task(2, { previousTaskIds: [1], nextTaskIds: [4] }),
    task(3, { previousTaskIds: [1], nextTaskIds: [4] }),
    task(4, { previousTaskIds: [2, 3] }),
    task(5),
  ]
  const before = JSON.stringify(records)
  for (const mobile of [false, true]) {
    const graph = buildTaskGraph(records, { today, mobile })
    assert.equal(graph.nodes.length, 5)
    assert.equal(graph.edges.length, 4)
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
    for (const edge of graph.edges)
      assert.ok(
        mobile
          ? nodes.get(edge.from).y < nodes.get(edge.to).y
          : nodes.get(edge.from).x < nodes.get(edge.to).x,
      )
    for (const a of graph.nodes)
      for (const b of graph.nodes)
        if (a.id !== b.id)
          assert.ok(
            a.x + a.width <= b.x ||
              b.x + b.width <= a.x ||
              a.y + a.height <= b.y ||
              b.y + b.height <= a.y,
          )
  }
  assert.equal(JSON.stringify(records), before)
})
test('completed predecessor is summarized by default, expands with completed toggle, and missing IDs stay explicit', () => {
  const records = [
    task(1, { completed: true }),
    task(2, { previousTaskIds: [1, 99], inboundDependencyCount: 1 }),
  ]
  const graph = buildTaskGraph(records, { today })
  assert.equal(graph.nodes.length, 1)
  assert.deepEqual(
    plain(graph.nodes[0].completedPredecessors.map((t) => t.id)),
    [1],
  )
  assert.deepEqual(plain(graph.nodes[0].missingPredecessors), [99])
  assert.equal(
    buildTaskGraph(records, { today, includeCompleted: true }).edges.length,
    1,
  )
})
test('cycle warning is finite and does not omit tasks', () => {
  const graph = buildTaskGraph(
    [
      task(1, { previousTaskIds: [2] }),
      task(2, { previousTaskIds: [1] }),
      task(3),
    ],
    { today },
  )
  assert.equal(graph.nodes.length, 3)
  assert.equal(graph.unresolvedCount, 2)
  assert.ok(
    graph.nodes.every(
      (node) => Number.isFinite(node.x) && Number.isFinite(node.y),
    ),
  )
})
test('matrix urgency includes overdue and boundary dates while undated tasks stay nonurgent', () => {
  assert.equal(
    matrixQuadrant(task(1, { dueDate: { date: '2026-11-05' } }), today, 2),
    0,
  )
  assert.equal(
    matrixQuadrant(task(1, { dueDate: { date: '2026-11-06' } }), today, 2),
    1,
  )
  assert.equal(
    matrixQuadrant(
      task(1, { importance: 6, dueDate: { date: '2026-10-01' } }),
      today,
      2,
    ),
    2,
  )
  assert.equal(
    matrixQuadrant(task(1, { importance: 6, dueDate: null }), today, 2),
    3,
  )
  assert.equal(
    matrixQuadrant(task(1, { dueDate: { date: '2026-02-30' } }), today, 2),
    1,
  )
})
test('fit and anchored zoom are bounded for huge or empty dimensions', () => {
  const view = fitGraph({ width: 1000000, height: 1000000 }, 390, 400)
  assert.equal(view.scale, 0.25)
  assert.equal(zoomGraph(view, 0.000001, { x: 30, y: 30 }).scale, 0.25)
  assert.equal(zoomGraph(view, 1000, { x: 30, y: 30 }).scale, 1.5)
  assert.ok(Number.isFinite(fitGraph({ width: 0, height: 0 }, 390, 400).x))
})
test('collector loads all open and archive pages and resolves external predecessor chains', async () => {
  const calls = []
  const result = await collectTaskGraph(
    {
      openPage: async (page) => {
        calls.push(`open:${page}`)
        return {
          content: [task(page + 1, { previousTaskIds: page ? [] : [10] })],
          last: page === 1,
        }
      },
      completedPage: async (cursor) => {
        calls.push(`done:${cursor}`)
        return {
          items: [task(cursor ? 4 : 3, { completed: true })],
          nextCursor: cursor ? null : 'next',
          hasNext: !cursor,
        }
      },
      detail: async (id) => {
        calls.push(`detail:${id}`)
        return task(id, {
          completed: true,
          previousTaskIds: id === 10 ? [11] : [],
        })
      },
    },
    true,
    new AbortController().signal,
  )
  assert.equal(result.tasks.length, 6)
  assert.equal(result.primaryCount, 4)
  assert.deepEqual(calls, [
    'open:0',
    'open:1',
    'done:null',
    'done:next',
    'detail:10',
    'detail:11',
  ])
})
test('collector does not silently accept failed pages or repeated pagination', async () => {
  const base = {
    completedPage: async () => ({ items: [] }),
    detail: async (id) => task(id),
  }
  await assert.rejects(
    collectTaskGraph(
      {
        ...base,
        openPage: async (page) => {
          if (page) throw Error('offline')
          return { content: [task(1)], last: false }
        },
      },
      false,
      new AbortController().signal,
    ),
    /offline/,
  )
  await assert.rejects(
    collectTaskGraph(
      { ...base, openPage: async () => ({ content: [task(1)], last: false }) },
      false,
      new AbortController().signal,
    ),
    /다음 페이지/,
  )
})
test('missing predecessor details remain explicit and aborted loads do not return a snapshot', async () => {
  const source = {
    openPage: async () => ({
      content: [task(1, { previousTaskIds: [99], inboundDependencyCount: 1 })],
      last: true,
    }),
    completedPage: async () => ({ items: [] }),
    detail: async () => {
      throw Error('not found')
    },
  }
  const result = await collectTaskGraph(
    source,
    false,
    new AbortController().signal,
  )
  assert.deepEqual(plain(result.unavailableIds), [99])
  assert.equal(taskReadiness(result.tasks[0]), 'blocked')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(collectTaskGraph(source, false, controller.signal), {
    name: 'AbortError',
  })
})
test('large independent datasets retain every task and finite positions', () => {
  const graph = buildTaskGraph(
    Array.from({ length: 5000 }, (_, index) => task(index)),
    { today, mobile: true },
  )
  assert.equal(graph.nodes.length, 5000)
  assert.ok(
    graph.nodes.every(
      (node) => Number.isFinite(node.x) && Number.isFinite(node.y),
    ),
  )
})

test('task APIs propagate AbortSignal and preserve unknown server readiness', async () => {
  const source = readFileSync(
    new URL('../src/features/tasks/api/tasks.ts', import.meta.url),
    'utf8',
  )
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  })
  const module = { exports: {} },
    calls = []
  const client = async (url, options) => {
    calls.push({ url, options })
    return url.includes('/completed')
      ? { data: [] }
      : url.includes('/search') || /\/tasks\?/.test(url)
        ? { content: [] }
        : {
            task: { ...task(1), inboundDependencyCount: null },
            spaceId: -1,
            projectId: null,
            assigneeId: 1,
            assigneeNickname: '나',
            version: 0,
            allowedActions: {},
          }
  }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    URLSearchParams,
    require: (name) =>
      name === '@features/spaces/store'
        ? { getSelectedScope: () => ({ spaceId: null, projectId: null }) }
        : name === '@features/spaces/metadata'
          ? { rememberMetadata() {} }
          : name.includes('httpClient')
            ? { httpClient: client }
            : name.includes('config')
              ? { buildApiUrl: (path) => path }
              : { toApiDateTimeWithZone: (date) => date },
  })
  const api = module.exports,
    signal = new AbortController().signal
  await api.fetchTasks({ signal })
  await api.searchTasks({ signal })
  await api.fetchTaskArchiveByCursor({ signal })
  const detail = await api.fetchTaskDetail(1, signal)
  assert.equal(detail.inboundDependencyCount, undefined)
  assert.equal(taskReadiness(detail), 'unknown')
  assert.ok(calls.every((call) => call.options.signal === signal))
})

test('completed toggle loads all completed search pages including today and future dates', async () => {
  const source = readFileSync(
    new URL('../src/features/task-map/graphApi.ts', import.meta.url),
    'utf8',
  )
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  })
  const module = { exports: {} },
    calls = []
  const searchTasks = async ({ page, params }) => {
    const status = params[0][1]
    calls.push(`${status}:${page}`)
    return status === 'OPEN'
      ? { content: [task(10)], last: true }
      : page === 0
        ? {
            content: [
              task(1, { completed: true, dueDate: { date: '2026-10-01' } }),
              task(2, { completed: true }),
            ],
            last: false,
          }
        : {
            content: [
              task(3, { completed: true, dueDate: { date: '2026-12-01' } }),
            ],
            last: true,
          }
  }
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: () => ({ searchTasks, fetchTaskDetail: async (id) => task(id) }),
  })
  const result = await collectTaskGraph(
    module.exports.taskGraphSource,
    true,
    new AbortController().signal,
  )
  assert.deepEqual(plain(result.tasks.map((item) => item.id)), [10, 1, 2, 3])
  assert.deepEqual(calls, ['OPEN:0', 'COMPLETED:0', 'COMPLETED:1'])
})
