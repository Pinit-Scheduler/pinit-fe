# 작업 쪼개기 — 맡기기, 잠긴 원본, 보관함 (A단계)

2026-11-17 기능 변경 문서다. 큰 작업(예상 4시간 이상)을 AI에게 맡겨 작은 조각으로 나누는 기능 중 **A단계**(긴 설명, 잠긴 원본 표시, 공용 확인 창, 동의·확인·접수, 보관함에서 취소·버리기)의 화면을 설명한다. 제안 화면·검사·만들기, 되돌리기, 알림 종·알림함, 알림 설정은 B단계(`pinit-docs/docs/superpowers/plans/2026-11-17-task-split-x7-fe-b.md`)가 이 문서에 덧붙인다.

이 문서는 pinit-fe 기준 커밋 `42ce608` 위의 A단계 구현(`fba5371`부터 이 문서를 더하고 고친 커밋까지)과 그 위에서 한 **mock 서버에서의** 확인을 기록한다. 실제 서버와 연결한 확인, 운영 배포는 하지 않았다. 운영 서버의 접수 스위치가 꺼져 있는 동안에는 `summary.available`이 false라 쪼개기 입구가 보이지 않는다.

- 화면 기준: `pinit-docs/docs/projects/task-split/ui-design.md`, 시안 `Pinit-Scheduler/pinit-ui-design@265ec9c9af530c58e82b1558d4495c8a65a79720`(`src/features/task-split/`). 둘이 다르면 ui-design.md가 기준이다.
- API 기준: `pinit-monolith`의 ADR-0035(`docs/modular-monolith-migration/adr/0035-llm-task-split.md`) §8·§9·§14와 X2 구현 코드.
- 구현 위치: `src/features/task-split/`(`api/`, `utils/`, `hooks/`, `components/`, `pages/SplitInboxPage.tsx`), 공용 확인 창 `src/shared/components/common/confirm.ts`·`ConfirmHost.tsx`, mock `src/mocks/taskSplit.ts`.

## 사용자 흐름

### 맡기기

1. 예상 시간이 4시간 이상인 작업에는 카드에 `4시간 이상 · 쪼개기`가, 작업 상세에 `쪼개기` 버튼과 `예상 시간이 4시간 이상이에요. …` 한 줄이 보인다. 둘 다 서버의 `task.split`과 `GET /v2/task-splits/summary`가 허락할 때만 그린다.
2. 처음 누르면 동의 창(`쪼개기에 AI를 써요`)이 뜬다. 보내는 것·보내지 않는 것·결과를 적고 `동의하고 쪼개기`로 동의를 저장한 뒤 바로 접수한다.
3. 동의한 뒤에는 확인 창(`쪼개기를 맡길까요?`, `오늘 N번 중 1번을 써요. 맡기고 나면 M번 남아요.`)으로 한 번 확인받는다. 남은 횟수가 없으면 확인 창 대신 `오늘 쪼개기 횟수를 다 썼어요. 자정에 다시 채워져요.`를 알린다.
4. 접수되면 토스트 `쪼개기를 맡겼어요. 준비되면 알려 드릴게요.`를 띄우고 작업을 다시 읽는다. 같은 요청을 두 번 보내 두 번째가 내 `requestId`가 실린 409 `SPLIT_ALREADY_IN_PROGRESS`로 오면 성공으로 다룬다(ADR-0035 §7).
5. 접수가 `SPLIT_CONSENT_REQUIRED`로 거부되면 요약을 다시 읽고 동의 창을 다시 연다. 다시 읽은 안내 버전을 화면이 모르면 `안내 내용이 바뀌었어요. 화면을 새로 고친 뒤 다시 시도해 주세요.`를 띄우고 동의 창을 닫는다.

### 잠긴 원본

- 쪼개는 중이거나 제안이 준비된 작업은 서버가 잠근다(`task.split.lock`). 카드에 `쪼개는 중`/`쪼개기 제안 준비됨`, 상세 위에 안내(`쪼개는 중이에요`, `쪼개기 제안이 준비됐어요`)를 보이고, 버튼 줄에는 지금 할 수 있는 것만 둔다: 쪼개는 중이면 `요청 취소`, 준비됨이면 `제안 버리기`(B단계부터 `제안 보기`도).
- 다른 참여자가 건 잠금은 `김서연님이 쪼개는 중이에요.`처럼 닉네임과 단계만 알린다. 카드의 표시는 누를 수 없고 상세에는 버튼이 없다. 닉네임이 없으면 닉네임 없이 적는다.
- 요청 취소와 제안 버리기는 공용 확인 창을 거친다. 취소의 본문은 `취소해도 횟수는 돌아오지 않아요.`, 버리기는 위반이 남은 제안이면 `횟수는 이미 돌려 드렸어요. 이 제안을 버릴까요?`, 아니면 `이미 쓴 횟수는 돌아오지 않아요. 원본 작업은 그대로 남아요.`다.

### 보관함

- 작업 목록 머리의 `쪼개기 보관함`(작업 아카이브 앞)으로 `/app/tasks/splits`에 간다. 입구는 `summary.available`이거나 `archiveCount > 0`일 때 보이고 수를 함께 적는다.
- 보관함은 `GET /v2/task-splits`의 항목을 최근 것부터 그린다: 쪼개는 중(`N분 전 요청`, `취소`), 준비됨(조각 수·뺀 조각·보관 기한, `버리기`), 실패(이유와 `횟수는 돌려 드렸어요.`, `버리기`). 실패 항목 버리기에는 확인 창이 없다.
- 요청이 준비되면 서버의 작업 변경 신호로 보관함과 요약을 다시 읽는다. 새로 고치지 않아도 줄이 `준비됨`으로 바뀐다.
- 뒤로 가기는 앱 안의 이전 화면으로 간다. 딥링크로 열어 앱 안에 돌아갈 곳이 없으면 `/app/tasks`로 간다(온보딩 가이드와 같은 방식).

### 긴 설명

작업 설명은 2,000자까지 보인다. 작업 상세는 전부, 카드의 펼친 설명은 8줄, 작업 아카이브는 3줄을 줄바꿈 그대로 보인다. 선후관계 고르기 목록은 한 줄 말줄임이라 줄바꿈이 공백으로 접힌다.

## 화면이 계산하지 않는 것과 서버 책임

- 쪼개기를 권할지, 맡길 수 있는지와 그 이유, 잠금, 남은 횟수, 동의 여부와 안내 버전은 서버가 정한다(`task.split`, `allowedActions`·`unavailableReasons`, `summary`). 화면은 연결 일정, 삭제 권한, 예상 시간 240분을 따지지 않는다.
- 잠긴 원본의 수정·삭제·완료 같은 동작은 서버가 `allowedActions`를 false로, 이유를 `SPLIT_IN_PROGRESS`로 준다. 그래도 명령이 가면 서버가 409 `TASK_LOCKED_BY_SPLIT`로 거부한다.
- 요청 상태(쪼개는 중 → 준비됨/실패, 만료)의 전이, 실패 시 횟수 돌려주기, 위반이 남은 제안의 횟수 돌려주기는 서버가 한다. 확인 창을 보는 사이 상태가 바뀌어 `SPLIT_REQUEST_STATE_CHANGED`가 오면 서버 문구를 보이고 다시 읽는다.
- 쪼개기를 모르는 서버(요약이 404·503)에서는 쪼개기 표시와 입구가 하나도 보이지 않고 오류 토스트도 없다.
- 실패 토스트는 `getRequestFailureMessage`로 만든다. 서버가 준 문구가 있으면 그것이 나간다.

## REST 계약

FE가 A단계에서 부르는 모든 엔드포인트다. 출처는 X2 실제 코드다(`T/` = `pinit-monolith/modules/task/src/main/java/me/gg/pinit/pinittask/`). 오류 본문은 `{code, message, resourceType, resourceId, latestVersion, split}`이고 `split`의 해당 없는 필드는 null이다(`T/interfaces/workspace/WorkspaceControllerAdvice.java`, `T/domain/split/exception/SplitErrorDetails.java`). 시각은 ISO-8601 instant다. null인 필드가 빠진 채 와도 같게 다룬다(`== null`). B단계가 이 표에 줄을 더하고 마지막에 서버 코드와 다시 대조한다.

| # | 메서드·경로 | 요청 | 성공 응답 | 다루는 오류(code, 상태, `split`에 실린 것) | 출처 |
|---|---|---|---|---|---|
| S1 | `GET /v2/task-splits/summary` | - | 200 `{available, consent: {currentVersion, consented, provider}, quota: {limit, used, remaining, resetsAt}, archiveCount}` | 어떤 실패든 입구를 숨긴다(토스트 없음) | `T/interfaces/workspace/TaskSplitController.java` `summary`, `T/application/split/SplitSummaryService.java` |
| S2 | `PUT /v2/task-splits/consent` | `{disclosureVersion}` | 200 `{disclosureVersion, consentedAt}` | `SPLIT_CONSENT_OUTDATED` 409 (`currentDisclosureVersion`) | `TaskSplitController.consent`, `T/application/split/SplitConsentService.java` |
| S3 | `POST /v2/task-splits` | `{taskId}` | 201 `{request: SplitRequestItem, quota}` | `SPLIT_UNAVAILABLE` 503, `SPLIT_CONSENT_REQUIRED` 409 (`currentDisclosureVersion`), `SPLIT_TARGET_NOT_FOUND` 404, `SPLIT_NOT_ELIGIBLE` 422 (`reasons`), `SPLIT_ALREADY_IN_PROGRESS` 409 (본인: `requestId` / 다른 참여자: `requesterNickname`, `lockStage`), `SPLIT_QUOTA_EXCEEDED` 429 (`quotaLimit`, `quotaResetsAt`) | `TaskSplitController.submit`, `T/application/split/SplitIntakeService.java`, `T/domain/split/exception/TaskSplitException.java` |
| S4 | `GET /v2/task-splits` | - | 200 `{quota, items: SplitRequestItem[]}`. 최근 것부터. `QUEUED`·`RUNNING`·`READY`(만료 전)·`FAILED`만 | 일반 실패 | `TaskSplitController.list`, `T/application/split/SplitInboxService.java` |
| S8 | `POST /v2/task-splits/{requestId}/cancel` | - | 200 `{request}`. 이미 끝난 요청이면 바꾸지 않고 200 | `SPLIT_REQUEST_NOT_FOUND` 404, `SPLIT_REQUEST_STATE_CHANGED` 409 (`currentStatus`) | `TaskSplitController.cancel`, `T/application/split/SplitRequestCommandService.java` |
| S9 | `POST /v2/task-splits/{requestId}/discard` | - | 200 `{request, undoable}`. `undoable`은 준비된 제안을 버렸을 때만 true | S8과 같다 | `TaskSplitController.discard`, `SplitRequestCommandService.SplitDiscardResult` |
| T1 | `GET /v2/workspace/tasks`, `GET /v2/workspace/tasks/{id}` | 기존 | 기존 응답 + `split: {recommended, canRequest, cannotRequestReasons, lock}`. `lock`은 null 또는 `{stage: 'PROCESSING' \| 'PROPOSAL_READY', mine, requestId, requestStatus, requesterNickname}`. 잠긴 원본의 `allowedActions`(edit·assign·move·delete·complete·reopen·schedule·editDependencies)는 false, 이유는 `SPLIT_IN_PROGRESS` | - | `T/interfaces/workspace/WorkspaceResourceController.java:36` `TaskResponse.split`, `T/application/split/SplitTaskView.java`, `SplitLockView.java`, `T/application/workspace/WorkspaceResourceService.java:251-257` |
| T2 | 기존 작업 명령(수정, 완료·재개, 삭제, 일정 배정 등) | 기존 | 기존 | `TASK_LOCKED_BY_SPLIT` 409 (본인: `requestId`, `lockStage` / 다른 참여자: `requesterNickname`, `lockStage`) | `T/domain/split/exception/TaskLockedBySplitException.java` |
| P1 | 하루 계획 승인 | 기존 | 기존 | 블록 거부 사유 `TASK_LOCKED_BY_SPLIT` | `T/domain/planning/model/BlockRejectionReason.java`, `T/domain/planning/exception/PlanningErrorMessages.java:54` |

`SplitRequestItem = {requestId, taskId, spaceId, originalTitle: string | null, status, failureReason, requestedAt, readyAt, expiresAt, pieceCount, excludedCount, violationRemaining: boolean | null, canApply: boolean | null, cannotApplyReason: 'ADMIN_ONLY' | null}`(`T/application/split/SplitRequestItemView.java`). `status`는 표시 상태다.

실시간 코드는 고치지 않았다. 서버의 `SPLIT_CHANGED` 기록은 기존 `TASK` 변경 신호로 와서 작업 상세와 `task:changed`를 거쳐 요약·보관함을 다시 읽게 한다(ADR-0035 §14.5).

## mock

`VITE_USE_MOCK_API=true`인 개발 서버에서 `src/mocks/taskSplit.ts`가 S1~S4·S8·S9와 작업 응답의 `split`, 잠긴 원본의 `TASK_LOCKED_BY_SPLIT`을 답한다. 응답 모양과 문구는 서버 `TaskSplitController`·`SplitErrorMessages`를 따르고, 규칙은 화면 확인에 필요한 만큼의 근사다. 상태는 새로 고치면 처음으로 돌아간다. 계정은 `demo` / `demo1234`.

시작 상태: 접수 켜짐, 동의 안 함, 오늘 3번 중 1번 씀(`settings: {available: true, consented: false, used: 1, limit: 3}`). 안내 버전 `1`, 제공자 `Anthropic`.

| fixture 키 | 작업 | 스페이스 | 요청 상태 |
|---|---|---|---|
| `ready` | 온보딩 개편 설계 (8시간) | 개인 | 준비됨, 조각 5·뺀 조각 2 |
| `queued` | 결제 모듈 이관 (5시간) | 개인 | 대기(쪼개는 중) |
| `running` | 검색 색인 다시 만들기 (6시간) | 개인 | 처리 중(쪼개는 중) |
| `violation` | 데이터 이전 리허설 (12시간) | 개인 | 준비됨, 위반이 남음(횟수 돌려줌) |
| `failed` | 연말 회고 자료 (4시간 30분) | 개인 | 실패(`PROVIDER_UNAVAILABLE`) |
| `expired` | 분기 목표 초안 (5시간) | 개인 | 준비됨이었으나 보관 기한 지남 |
| `applied` | 블로그 이전 | 개인 | 적용됨(원본 없음) |
| `discarded` | 사진 정리 (4시간) | 개인 | 버림 |
| `cancelled` | 세금 서류 모으기 (4시간) | 개인 | 취소됨 |
| `adminOnly` | 12월 발제문 쓰기 (5시간) | 독서 모임 | 준비됨, 관리자만 적용 |
| `allExcluded` | 릴리즈 회고 준비 (4시간) | 개인 | 준비됨, 조각 0·뺀 조각 3 |
| `otherProcessing` | 결제 화면 리팩터링 (6시간) | 제품팀 | 다른 참여자(김서연)가 쪼개는 중 |
| `otherReady` | 12월 로드맵 초안 (5시간) | 제품팀 | 다른 참여자(김서연)의 제안 준비됨 |
| `free`, `free2` | 사내 위키 이전 계획 (6시간), 여행 계획 세우기 (5시간) | 개인 | 요청 없음(맡길 수 있음) |
| `linked` | 이사 준비 (5시간) | 개인 | 요청 없음, 일정에 연결돼 맡길 수 없음 |

브라우저 개발자 도구의 `window.__pinitMock.split`:

- `fixtures` — 위 키마다 `{taskId, requestId}`.
- `requests` — mock이 가진 요청 목록(저장 상태).
- `finish(requestId, 'READY' | 'READY_WITH_VIOLATION' | 'FAILED')` — 처리 중인 요청을 끝내고 작업 변경 신호를 보낸다.
- `settings` — `available`, `consented`, `used`, `limit`을 바꾼다.
- `setAutoFinish(ms | null)` — 새 요청이 저절로 준비되기까지의 시간(기본 5000ms). `null`이면 저절로 끝나지 않는다.

## 화면으로 확인받을 것

ADR-0035 §19 B-6대로 아래 표와 캡처를 함께 보인다. 캡처는 `node qa/task-split/local.mjs`가 `qa/task-split/screenshots/`에 남긴다(실행 방법은 [qa/task-split/README.md](../qa/task-split/README.md)). 파일 이름은 `{mobile|desktop}-{번호}-{이름}.png`이고 모바일은 390×844, 데스크톱은 1280×800이다.

| 번호 | 이름 | 화면 |
|---|---|---|
| 01 | `task-list` | 작업 목록 머리의 `쪼개기 보관함 7`, 카드의 `4시간 이상 · 쪼개기`·`쪼개는 중`·`쪼개기 제안 준비됨` |
| 02 | `detail-offer` | 작업 상세의 `쪼개기` 버튼과 권하는 한 줄 |
| 03 | `consent` | 동의 창 |
| 04 | `submitted` | 접수 토스트, 잠긴 원본의 `쪼개는 중이에요`와 `요청 취소` |
| 05 | `cancel-confirm` | 요청 취소 확인 창(처음 초점은 `그대로 두기`) |
| 06 | `detail-linked` | 꺼진 `쪼개기`와 `일정에 넣은 작업은 쪼갤 수 없어요. …` |
| 07 | `request-confirm` | 맡기기 확인 창 `오늘 3번 중 1번을 써요. …` |
| 08 | `detail-other-lock` | 다른 참여자의 잠금 `김서연님이 쪼개는 중이에요.`, 버튼 없음 |
| 09 | `inbox` | 보관함: 남은 횟수, 쪼개는 중·준비됨·실패 |
| 10 | `discard-confirm-refunded` | 위반이 남은 제안 버리기 확인 창 |
| 11 | `discard-failed` | 실패 항목을 확인 창 없이 버린 뒤 |
| 12 | `ready-signal` | 04에서 맡긴 요청이 새로 고치지 않고 `준비됨`으로 바뀐 보관함 |

이 계획이 정한 것(ui-design §11이 열어 둔 것과 문서끼리 다른 곳):

| 항목 | 정한 것 | 까닭 |
|---|---|---|
| 쪼개기 버튼을 보일 조건(§11-1) | `task.split`이 있고, 잠금이 없고, `summary.available`이고, `cannotRequestReasons`에 `TASK_COMPLETED`·`RECURRING_TASK`가 없을 때 보인다(시안의 "미완료이고 반복 회차가 아닌 작업"). 그 밖의 이유(`HAS_LINKED_SCHEDULE`, `ADMIN_ONLY`)가 있으면 버튼을 끄고 아래에 이유 한 줄을 적는다 | 시안은 보일 조건만 정했다. 눌러도 아무 일이 없는 거부를 피하고(ui-design §2 반목표), 기존 작업 상세의 "꺼진 버튼 + 이유 한 줄" 방식을 따른다 |
| 카드의 "4시간 이상 · 쪼개기" | `recommended`이고 `canRequest`이고 `summary.available`일 때만 | 누를 수 없는 표시를 카드에 두지 않는다 |
| 동의 창 문구(§11-1) | 시안의 세 묶음을 지키되 요구사항 §5.9가 요구한 항목(제공자 이름, 100건, 마감 경과 여부, 담당자 없는 작업, 프로젝트 목표)을 더했다 | 요구사항 §5.9 "실제 범위를 그대로 적는다" |
| 맡기기 확인 문구 | 시안의 `오늘 N번 중 1번을 써요. 맡기고 나면 M번 남아요.` | ui-design §5.1의 문장은 예시("처럼")이고 §5.7이 시안을 기준으로 가리킨다 |
| 접수 토스트(ADR §17의 38번) | `쪼개기를 맡겼어요. 준비되면 알려 드릴게요.` | ui-design §5.1과 시안. 요구사항 §4의 "접수됐어요…"는 쓰지 않는다 |
| 보관함 입구(§11-2) | 작업 목록 머리, "작업 아카이브" 앞. `summary.available`이거나 `archiveCount > 0`일 때 보인다 | 시안. 스위치를 끈 뒤에도 남은 요청을 정리할 길이 있어야 한다 |
| 긴 설명(§11-3) | 작업 상세는 전부, 카드의 펼친 설명은 8줄, 아카이브 3줄, 선후관계 고르기 목록 1줄. 상세·카드·아카이브는 줄바꿈을 유지하고, 선후관계 목록은 한 줄 말줄임이라 줄바꿈이 공백으로 접힌다 | 상세는 내용을 읽는 곳이고 목록은 훑는 곳이다. 선례는 프로젝트 성과 표시(`e2bc0d9`) |
| 잠긴 원본의 다른 문구 | `SPLIT_IN_PROGRESS` 이유 한 줄은 `쪼개기 요청이 진행 중이라 할 수 없어요.`, 연결 일정 이유는 `일정에 넣은 작업은 쪼갤 수 없어요. 일정을 지우거나 연결을 푼 뒤 쪼개 주세요.` | 설계 문서에 문구가 없다. BE 문구(`PlanningErrorMessages`)와 기존 화면의 말투를 따랐다 |
| "제안 보기" | A단계에서는 그리지 않는다(`PROPOSAL_SCREEN_READY = false`). B단계가 제안 화면과 함께 켠다 | A단계만으로도 죽은 버튼이 없게 한다 |

## 시안과 다른 곳

시안을 `npm ci && npm start`(`http://127.0.0.1:4173`)로 띄워 작업 카드, 작업 상세(권함·잠금), 동의 창, 확인 창, 보관함을 두 뷰포트에서 같은 자리끼리 캡처해 대조했다. 마크업·class·CSS를 옮긴 곳은 같게 그려진다(잠긴 원본의 버튼 하나짜리 줄, 취소 확인 창, 동의 창의 세 묶음, 보관함 줄의 모양). 남은 차이는 모두 정한 것이다.

- 문구: 동의 창에 제공자 이름·100건·마감 경과·담당자 없는 작업·프로젝트 목표가 더해졌다(위 표). 취소 확인과 횟수 돌려주기 문구에서 "오늘"을 뺐다(`취소해도 횟수는 돌아오지 않아요.`, `횟수는 돌려 드렸어요.`, Global Constraints).
- 보관함의 준비된 줄: 시안은 읽지 않은 줄(`data-unread`)을 파란 테두리·파란 상태 글자로 그리고 `제안 보기`를 둔다. 읽음 표시는 알림(B단계)의 것이고 `제안 보기`는 `PROPOSAL_SCREEN_READY = false`라 A단계에는 없다.
- 상단의 알림 종(시안의 수 배지)은 B단계다.
- 상태 이름: 시안의 `PROCESSING`(요청 상태로), `PROVIDER` 같은 실패 이름 대신 ADR의 `QUEUED`·`RUNNING`·`PROVIDER_UNAVAILABLE` 등을 쓴다. 화면에 보이는 글자는 같다.
- 확인 창의 층: 시안의 `.split-dialog__backdrop`은 `calc(var(--z-modal-backdrop) + 6)`, FE의 공용 확인 창은 `+ 1`이다. 작업 상세(`+ 0`) 위에 뜨는 것을 캡처 05·07에서 확인했다. 크기·여백·그림자·버튼 줄은 시안의 `.split-dialog`, `.split-dialog--confirm`과 같다.

## 검증

- 단위 시험: `tests/task-split-*.test.mjs`(API 모듈, 잠금 이유, mock 핸들러, 문구·판정 순수 함수, 요약·명령, 시작 흐름, 카드·상세 표시, 보관함), `tests/confirm-dialog.test.mjs`, `tests/long-description.test.mjs`. `npm test`·`npm run lint`·`npm run build`가 통과한다(빌드는 기존 청크 크기 경고만).
- 브라우저: `node qa/task-split/local.mjs`가 Vite 개발 서버(mock)와 Chromium으로 위 12단계를 두 뷰포트에서 걷는다. 단계마다 문구를 확인하고 모바일 가로 넘침(`scrollWidth <= 390`)을 확인한다. console error와 pageerror가 하나라도 있으면 실패한다.
- 따로 손으로 확인한 것(브라우저, mock): 새 요청이 약 5초 뒤 저절로 준비됨이 되고 작업 상세가 `쪼개기 제안이 준비됐어요`로 바뀐다. 접수 뒤 확인 창의 남은 횟수와 보관함 수가 다시 읽힌다. 카드 펼친 설명 8줄·아카이브 3줄의 줄바꿈 유지, 선후관계 목록의 한 줄 말줄임(줄바꿈은 공백으로 접힘), 줄바꿈 없는 긴 글자의 가로 넘침 없음. 다른 참여자 잠금의 카드 표시가 누를 수 없는 것. 동의 재요청 뒤 모르는 안내 버전의 토스트. 앱 안에 돌아갈 곳이 없을 때 보관함의 뒤로 가기가 `/app/tasks`로 가는 것(mock은 새로 고치면 로그인 상태가 처음으로 돌아가 딥링크를 직접 열 수 없어 history 항목을 첫 항목으로 바꿔 확인했다).
- 확인하지 않은 것: 실제 서버(X2)·DB와의 연결, 실제 인증·세션 갱신, 실시간 스트림의 실제 `SPLIT_CHANGED` 전달, 푸시 알림, 실제 기기·스크린 리더, 운영 배포. 서비스 워커 캐시 버전은 `pinit-cache-v34`로 올렸다(`tests/service-worker-cache-version.test.mjs`).
