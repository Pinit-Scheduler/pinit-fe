# Task·Schedule 분리 체크리스트

> 기준: `.github/openapi-task.json` v1, `docs/Task.md`

## 0. 준비
- [ ] v1 OpenAPI 스펙 주요 필드/응답코드 확인 메모
- [x] `src/api/config.ts` 버전별 URL 지원(`buildApiUrl(path, version='v0')`)

## 1. API 레이어
- [x] `src/api/tasks.ts` 신설: list(page/size/readyOnly), cursor list, create, update, delete(deleteSchedules), complete, reopen, createScheduleFromTask
- [x] `src/api/schedules.ts` v1 전환: daily get, create, update, delete, start/suspend/complete/cancel(time·zone 쿼리), detail
- [x] v0 호출 분리/네임스페이스 유지(legacy)
- [x] time/zone 쿼리 헬퍼 추가(`buildTimeQuery` 등)

## 2. 타입
- [x] `src/types/task.ts` 추가(Task, TaskRequest, TaskSummary/Deps)
- [x] `src/types/schedule.ts` v1 모델로 단순화(title/description/date/scheduleType/state/taskId/duration?)
- [x] 중요도·난이도·의존성 필드 legacy optional 또는 분리
- [x] 난이도/중요도 상수·스타일을 Task 전용으로 이동

## 3. 라우팅·네비
- [x] `src/App.tsx` 경로 재구성: `/app/today`, `/app/schedules`, `/app/tasks`, `/app/statistics` 및 생성/편집 라우트
- [x] `components/layout/BottomTabBar.tsx` 탭 4개, + 버튼 컨텍스트 분기
- [x] `components/layout/AppShell.tsx` 제목/뒤로가기 로직 갱신

## 4. Today 탭(신규)
- [x] `/app/today` 페이지: 오늘 일정(v1) + readyOnly 작업 리스트/추천
- [x] Task → “오늘 일정 배정” 플로우(`/v1/tasks/{id}/schedules` + 시작시간·scheduleType 입력 모달)
- [x] 일정 완료/취소 시 task 상태 동기화

## 5. 일정 탭 v1 전환
- [x] 훅 수정: `useScheduleList`, `useWeeklySchedulePresence`, `useOverdueSchedulesSummary` → v1 API/필드
- [x] UI 단순화: `ScheduleForm`/Modal/Detail/Card 에서 중요도·난이도·의존성 제거, taskId 배지 표시
- [x] `useScheduleActions` time/zone 포함, taskId 연동 시 Task 캐시 갱신 이벤트
- [x] 주간 존재 감지: v1 주간 API 없으면 7일 병렬 fetch 도입(성능 확인)

## 6. 작업 탭(신규)
- [x] 리스트/상세/폼 컴포넌트: dueDate·importance·difficulty 표시, readyOnly 필터, 데드라인 정렬(기본 목록)
- [x] `TaskForm`: 의존성 선택 모달(작업 검색/체크리스트), Fibo 난이도·중요도 슬라이더
- [x] 액션: complete/reopen, delete(deleteSchedules), “일정으로 복사”→ 일정 생성 모달 재사용
- [x] 의존성 API 규칙 적용: 생성 시 from/to 한쪽 0, 수정 시 0 금지, removeDependencies 처리

## 7. 상태/이벤트
- [x] `ScheduleCacheContext` 스키마 갱신(state, scheduleType, taskId, duration)
- [x] `TaskCacheContext` 신설(리스트·상세 캐시)
- [x] 이벤트: `schedule:changed` / `task:changed` 분리, 관련 훅 리스너 등록

## 8. 유틸·공통
- [x] `priorityStyles`, 난이도/중요도 UI를 Task 전용으로 이동
- [x] `toApiDateTimeWithZone` 기반 `withTimeZoneParams` 헬퍼 추가
- [x] `MiniPlayerBar` v1 상태는 Schedule 기준, Task 일정 복사 후 재생 흐름 점검

## 9. 통계
- [x] v0 `/statistics` 유지 가드(추후 v1 확인) → v1 `/statistics` 사용
- [x] scheduleType 분리 후 차트 정상 여부 검증, 필요 시 Task/ Schedule 필터 옵션(후순위)

## 10. 테스트 체크
- [ ] Task CRUD + 의존성 추가/삭제 + readyOnly 필터 + cursor 페이지네이션
- [ ] Task→Schedule 복사 후 일정 시작/완료/취소 시 Task 상태 반영
- [ ] Schedule v1 CRUD/상태 전환(time/zone 포함), taskId 유무 케이스
- [ ] Today 탭 추천·배정, + 버튼 컨텍스트, 네비 타이틀/백버튼 동작
- [ ] Statistics, 시간대 설정, MiniPlayerBar 활성/정지 흐름

## 열린 사항 확인
- [ ] v1 응답 본문 필드/HTTP 코드(200 vs 201) 확인 후 타입 보정
- [ ] v1 주간/집계 엔드포인트 존재 여부 재확인(없으면 병렬 호출 허용 범위 검토)
- [ ] Task 응답 메타(inboundTaskCount 등) 유무에 따라 UI 뱃지 결정
