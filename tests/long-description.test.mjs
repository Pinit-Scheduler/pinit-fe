import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const src = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const rule = (css, selector) => {
  const at = css.indexOf(selector + ' {')
  assert.ok(at >= 0, selector)
  return css.slice(at, css.indexOf('}', at))
}

test('작업 상세는 설명의 줄바꿈을 지키고 접지 않는다', () => {
  const body = rule(src('features/tasks/components/TaskDetailModal.css'), '.task-detail-modal__description--body')
  assert.match(body, /white-space:\s*pre-wrap/)
  assert.match(body, /overflow-wrap:\s*anywhere/)
  assert.doesNotMatch(body, /line-clamp/)
  assert.match(src('features/tasks/components/TaskDetailModal.tsx'), /task-detail-modal__description--body/)
})

test('작업 카드의 펼친 설명은 줄바꿈을 지키고 8줄까지 보인다', () => {
  const p = rule(src('features/tasks/components/WorkspaceTaskCard.css'), '.workspace-task__description p')
  assert.match(p, /white-space:\s*pre-wrap/)
  assert.match(p, /overflow-wrap:\s*anywhere/)
  assert.match(p, /-webkit-line-clamp:\s*8/)
})

test('아카이브 목록은 3줄, 선후관계 고르기 목록은 한 줄로 줄인다', () => {
  const archive = rule(src('features/tasks/components/modals/TaskArchiveModal.css'), '.task-archive-modal__item-desc')
  assert.match(archive, /white-space:\s*pre-wrap/)
  assert.match(archive, /-webkit-line-clamp:\s*3/)
  const dependency = rule(src('features/tasks/components/modals/TaskDependencyModal.css'), '.task-dependency-modal__desc')
  assert.match(dependency, /text-overflow:\s*ellipsis/)
  assert.match(src('features/tasks/components/modals/TaskDependencyModal.tsx'), /task-dependency-modal__desc/)
})
