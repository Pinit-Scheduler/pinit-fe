import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const loadModule = (relativePath) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, require: () => assert.fail('no imports') })
  return module.exports
}

const activity = loadModule('../src/features/settings/utils/mcpActivity.ts')

test('known tools read as Korean actions and unknown tools keep their name', () => {
  assert.equal(activity.describeActivity({ tool: 'update_task', outcome: 'OK', argumentNames: ['taskId'] }), '작업 수정')
  assert.equal(activity.describeActivity({ tool: 'replace_routines', outcome: 'OK' }), '생활 시간 저장')
  assert.equal(activity.describeActivity({ tool: 'get_weekly_statistics', outcome: 'OK' }), '주간 통계 조회')
  assert.equal(activity.describeActivity({ tool: 'future_tool', outcome: 'OK' }), 'future_tool')
})

test('a delete without a confirmation token is only a preview', () => {
  assert.equal(
    activity.describeActivity({ tool: 'delete_task', outcome: 'OK', argumentNames: ['taskId'] }),
    '작업 삭제 미리보기',
  )
  assert.equal(
    activity.describeActivity({ tool: 'delete_task', outcome: 'OK', argumentNames: ['confirmationToken', 'taskId'] }),
    '작업 삭제',
  )
  assert.equal(activity.describeActivity({ tool: 'delete_recurrence', outcome: 'OK', argumentNames: null }), '반복 삭제 미리보기')
})

test('targets show by kind and id, at most three', () => {
  assert.equal(activity.formatTargets([]), null)
  assert.equal(activity.formatTargets(null), null)
  assert.equal(activity.formatTargets([{ type: 'task', id: 12 }]), '작업 #12')
  assert.equal(
    activity.formatTargets([
      { type: 'task', id: 3 },
      { type: 'schedule', id: 41 },
      { type: 'recurrence', id: 5 },
      { type: 'schedule', id: 42 },
      { type: 'schedule', id: 43 },
    ]),
    '작업 #3 · 일정 #41 · 반복 #5 외 2개',
  )
})

test('only unsuccessful calls get a badge', () => {
  assert.equal(activity.outcomeBadge('OK'), null)
  assert.equal(activity.outcomeBadge('ERROR'), '실패')
  assert.equal(activity.outcomeBadge('DENIED'), '권한 없음')
  assert.equal(activity.outcomeBadge('RATE_LIMITED'), '호출 한도 초과')
  assert.equal(activity.outcomeBadge('SOMETHING_NEW'), 'SOMETHING_NEW')
})

test('every MCP tool of ADR-0026 has a label', () => {
  const tools = [
    'list_schedules_by_date', 'list_schedules_by_week', 'get_schedule', 'create_schedule', 'update_schedule',
    'start_schedule', 'complete_schedule', 'suspend_schedule', 'cancel_schedule', 'list_tasks',
    'list_tasks_by_deadline', 'get_task', 'create_task', 'update_task', 'complete_task', 'reopen_task',
    'schedule_task', 'plan_day', 'apply_plan', 'weekly_review', 'get_time_calibration', 'get_weekly_statistics',
    'get_routines', 'replace_routines', 'create_recurrence', 'list_recurrences', 'update_recurrence',
    'delete_schedule', 'delete_task', 'delete_recurrence',
  ]
  assert.equal(tools.length, 30)
  for (const tool of tools) {
    assert.notEqual(
      activity.describeActivity({ tool, outcome: 'OK', argumentNames: ['confirmationToken'] }),
      tool,
      tool,
    )
  }
})
