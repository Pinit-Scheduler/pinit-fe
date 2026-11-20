import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { requireFrom } from './support/errors.mjs'

const load = (relativePath) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  vm.runInNewContext(outputText, { module, exports: module.exports, require: requireFrom({}) })
  return module.exports
}

const consent = load('../src/features/oauth/utils/consent.ts')
const activity = load('../src/features/settings/utils/mcpActivity.ts')

test('동의 화면은 마인드맵을 말한다', () => {
  const [read, write, del] = consent.buildConsentScopeOptions(['mcp:read', 'mcp:write'], ['mcp:delete'])
  assert.equal(read.label, '개인·공유 스페이스의 일정·작업·프로젝트·참여자와 내 마인드맵 보기')
  assert.equal(write.label, '개인·공유 스페이스의 내용과 내 마인드맵 만들기·수정·상태 변경 (삭제는 불가)')
  assert.equal(del.label, '스페이스·프로젝트·일정·작업·마인드맵 가지 삭제 및 초대 철회·참여자 제외 (미리보기 후 확인)')
  assert.equal(del.warning, '삭제·초대 철회·참여자 제외·스페이스 나가기는 미리보기를 확인한 뒤에만 실행돼요. 영구 삭제, 반복 범위 삭제, 마인드맵 가지 삭제는 되돌릴 수 없어요.')
})

test('MCP 사용 기록이 마인드맵 도구 여섯을 읽는다', () => {
  const label = (tool, argumentNames = []) => activity.describeActivity({ tool, outcome: 'OK', argumentNames })
  assert.deepEqual(['get_mind_map', 'add_mind_map_branches', 'update_mind_map_branch', 'move_mind_map_branch', 'set_mind_map_branch_check'].map((t) => label(t)),
    ['마인드맵 조회', '마인드맵 가지 추가', '마인드맵 가지 글 수정', '마인드맵 가지 옮기기', '마인드맵 체크 상태 변경'])
  assert.equal(label('delete_mind_map_branch'), '마인드맵 가지 삭제 미리보기')
  assert.equal(label('delete_mind_map_branch', ['confirmationToken']), '마인드맵 가지 삭제')
})
