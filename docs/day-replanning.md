# 오늘 남은 일정 다시 짜기

2026-11-09 기능 변경 문서다. 기존 하루 계획의 `GET /v2/plans`와 새 일정 생성 계약은 유지한다. 이 문서는 `codex/replan-day`의 구현·검증을 설명하며 운영 배포 완료를 뜻하지 않는다. 공통 고정 그래프의 FE 기준 `d27098bfce1c845565176cb357017075d433d3ac`에는 이 기능이 없다.

## 사용자 흐름

하루 계획(`/app/plan`)에서 오늘을 보고 있을 때 전용 패널이 나타난다. 늦어진 시간은 기본 30분이며 0~240분의 정수만 허용한다.

1. **변경 미리보기**를 누르면 서버가 오늘 남은 미시작 작업 일정의 변경 전후를 제안한다. 이 요청은 일정을 저장하지 않는다.
2. 변경 전후 시각, 배치하지 못한 이유, 유지하는 일정을 확인한다. 제안된 변경은 처음에 모두 선택된다. 개별 체크를 해제할 수 있고 시간·길이를 직접 편집하는 기능은 제공하지 않는다.
3. **선택한 변경 적용**을 누르면 체크한 기존 Schedule의 시간을 변경한다. 새 Schedule을 만들거나 Task를 여러 Schedule로 나누지 않는다.
4. 성공하면 해당 ID의 중앙 ScheduleCache 항목을 비우고 `schedule:changed`로 날짜 목록 캐시를 무효화한 뒤 기존 하루 계획을 다시 조회한다. 성공한 스냅샷은 제거하므로 화면 갱신 실패 때문에 같은 적용을 다시 전송하지 않는다.

`DayReplanningPanel`·`useDayReplan`·`api/replanning.ts`가 전용 구현이다. `PlanPage`의 변경은 패널 진입과 적용 후 캐시 무효화에 한정한다. 회원 시간대가 바뀌면 패널을 다시 마운트하고, 로그아웃·계정 변경 시 미리보기와 선택을 버린다. 이전 입력의 지연된 미리보기 응답도 새 입력을 덮어쓰지 않는다.

## 보수적인 정책과 서버 책임

- 작업과 연결된 오늘의 `NOT_STARTED` 일정만 이동 후보다. 독립 약속, **모든 반복 회차**, 진행 중·일시정지·완료 일정은 유지한다. 유연한 반복도 이번 기능에서 옮기지 않는다.
- 마감·중요도·선행 관계·생활 시간/날짜 예외·회원 시간대·보정 설정·10분 버퍼를 서버가 계산한다. 기존 시작+지연 및 미리보기 시각+지연보다 앞당기지 않고 오늘 날짜를 넘기지 않는다.
- 길이는 저장된 유효 일정 길이와 현재 Task의 보정 예상 길이 중 큰 값이다. 저장된 길이를 줄이거나, 저장된 보정 길이에 계수를 거듭 곱하지 않는다. “시간 보정 설정 반영”은 설정이 켜졌다는 표시이며 실제 길이가 늘었다는 의미는 아니다.
- 선택하지 않은 변경과 배치하지 못한 일정은 **원래 시간에 남는다**. 전체 미리보기에는 맞는 제안도 일부만 고르면 원래 슬롯·선행 순서와 충돌할 수 있다. FE는 이를 설명하고 서버가 선택 결과 전체를 최종 검사한다. 자동으로 다른 항목을 선택하거나 옮기지 않는다.
- 적용은 서버가 소유권·현재 상태·버전/스냅샷·시간 충돌·생활 시간·선행 관계를 다시 검증하는 원자적 요청이다. 하나라도 거부되면 전체 변경이 적용되지 않는다. FE 검증은 서버 검증을 대체하지 않는다.

구체적인 도메인·잠금·트랜잭션 규칙의 원본은 BE의 `docs/planner/day-replanning.md` 및 전용 `DayReplanningService`다. 회원 설정의 시간대를 요청 `zoneId`로 사용하며 서버는 다른 시간대 요청을 거부한다.

## REST 계약

| 경로 | 본문 | 응답 |
| --- | --- | --- |
| `POST /v2/plans/replan` | `{ date, zoneId, delayMinutes }` | `{ date, zoneId, delayMinutes, plannedAt, snapshotToken, windowStart, windowEnd, changes, protectedSchedules, unplaced }` |
| `POST /v2/plans/replan/apply` | `{ date, zoneId, delayMinutes, plannedAt, snapshotToken, selectedScheduleIds }` | `{ appliedScheduleIds }` |

- `date`는 회원 시간대의 오늘이다. 모든 응답 시각은 ISO instant 문자열(`...Z`)이며 FE는 응답 `zoneId`로 표시한다.
- `changes`: `{ scheduleId, taskId, title, expectedVersion, beforeStart, beforeEnd, afterStart, afterEnd, calibrationApplied }`.
- `protectedSchedules`: `{ scheduleId, title, start, end, reason }`. 이유는 `INDEPENDENT_APPOINTMENT`, `RECURRING_SCHEDULE`, `IN_PROGRESS`, `SUSPENDED`, `COMPLETED`, `TASK_UNAVAILABLE`, `OUTSIDE_TODAY`다.
- `unplaced`: `{ scheduleId, taskId, title, reason }`. 이유는 `DEADLINE_PASSED`, `PREDECESSOR_NOT_PLACED`, `NO_FITTING_SLOT`다. 알 수 없는 이유도 원래 일정 유지라는 한국어 안내로 표시한다.
- 미리보기는 15분 유효하다. FE도 만료된 적용 버튼을 막고, 서버가 최종 유효성을 검사한다. `plannedAt`·`snapshotToken`은 받은 값을 그대로 보내며 FE에서 변경된 시간을 작성하지 않는다.

인증·재발급·오류 본문은 기존 `httpClient`를 사용한다. 409(`error: REPLAN_CONFLICT`)는 공통 문구와 서버 메시지를 보여 주고 선택·미리보기를 유지한다. 선택을 조정하거나 새 미리보기로 재시도할 수 있다. 네트워크 단절·5xx처럼 적용 결과가 불확실하면 같은 스냅샷의 재적용을 막고 새 미리보기를 요구한다. 미리보기 갱신 실패도 예전 스냅샷의 적용을 다시 허용하지 않는다.

## 검증

`tests/day-replanning.test.mjs`는 실제 API·hook·패널 모듈을 로드하는 모의 React/API 하네스를 사용한다. 입력 범위, 원래 ID와 서버 토큰의 선택 전송, 지연 응답 취소, unmount/계정 변경, 중복 적용 차단, 409 선택 보존, 결과 불확실 시 재적용 차단, 성공 후 갱신 실패, 15분 만료, 회원 시간대 표시, 중앙 캐시의 선택 ID 제거를 검사한다. BE 배치 알고리즘·소유권·동시성·롤백의 증거는 BE 테스트와 별도로 읽는다.

### 2026-11-09 실행 기록

- `npm test -- --test-reporter=tap`: **231개 통과, 실패·건너뜀 0**. 이 기능의 신규 테스트는 13개다.
- `npm run lint`: 통과. 기존 `baseline-browser-mapping` 갱신 안내는 남아 있다.
- `npm run build`: TypeScript·Vite 통과. JS 번들 679.45 kB(압축 211.28 kB)와 기존 500 kB 청크 경고를 확인했다.
- `git diff --check`: 통과.
- 실제 로컬 PlanPage를 Chrome headless/Playwright에서 열고 **30분 → 미리보기 → 일부 선택 → 409 선택 유지 → 같은 선택 재시도 성공 → 새 미리보기**를 검증했다. 선택한 기존 ID `101`만 적용 요청에 포함됐고, 성공 후 적용 가능한 예전 미리보기가 제거됐다.
- 1365×1000 데스크톱 및 390×844 모바일 화면을 캡처해 확인했다. 모바일 가로 넘침 0, 입력/미리보기 버튼의 키보드 포커스 이동, page error 0을 확인했다.

브라우저 검증은 모든 API 응답을 별도 Playwright route fixture로 제공하고 외부 네트워크를 차단한 화면·전송 계약 검증이다. 기존 `VITE_USE_MOCK_API` 내장 mock에는 새 재배치 경로를 추가하지 않았다. 실제 BE·DB·인증을 연결한 E2E, 실제 기기·스크린 리더·운영 배포는 미확인이다. BE의 도메인·컨트롤러·롤백 테스트 결과와 이 기록을 구분한다.
