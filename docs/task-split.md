# 작업 쪼개기 — 맡기기, 잠긴 원본, 보관함, 제안 화면, 되돌리기, 알림

2026-11-17 기능 변경 문서다. 큰 작업(예상 4시간 이상)을 AI에게 맡겨 작은 조각으로 나누는 기능의 화면 전체를 설명한다. **A단계**(긴 설명, 잠긴 원본 표시, 공용 확인 창, 동의·확인·접수, 보관함에서 취소·버리기)와 **B단계**(제안 화면의 지도·목록, 조각 다듬기와 서버 검사, 만들기와 거부, 만들기·버리기 되돌리기, 알림 종·알림함과 읽음, 알림 설정의 쪼개기 항목)다. 계획은 `pinit-docs/docs/superpowers/plans/2026-11-17-task-split-x7-fe-a.md`와 `…-x7-fe-b.md`다.

이 문서는 pinit-fe 기준 커밋 `42ce608` 위의 구현(A단계 `fba5371`~`656ac17`, B단계 `f443a78`~`86fe228`, 이 문서와 브라우저 기록을 더한 커밋)과 그 위에서 한 **mock 서버에서의** 확인을 기록한다. 실제 서버와 연결한 확인, 운영 배포는 하지 않았다. B단계가 부르는 S5~S7은 BE X4 계획의 모양, S10·S11과 알림(N1~N4·NP)은 ADR-0035의 가정이며 서버 코드와의 대조는 다음 과업(BE 계약 대조)이 한다. 운영 서버의 접수 스위치가 꺼져 있는 동안에는 `summary.available`이 false라 쪼개기 입구가 보이지 않는다.

- 화면 기준: `pinit-docs/docs/projects/task-split/ui-design.md`, 시안 `Pinit-Scheduler/pinit-ui-design@265ec9c9af530c58e82b1558d4495c8a65a79720`(`src/features/task-split/`). 둘이 다르면 ui-design.md가 기준이다.
- API 기준: `pinit-monolith`의 ADR-0035(`docs/modular-monolith-migration/adr/0035-llm-task-split.md`) §8·§9·§13·§14, X2 구현 코드, S5~S7은 BE X4 계획(`pinit-docs/docs/superpowers/plans/2026-11-17-task-split-x4-proposal-apply.md`).
- 구현 위치: `src/features/task-split/`(`api/`, `utils/`, `hooks/`, `components/`, `pages/SplitInboxPage.tsx`·`SplitProposalPage.tsx`), 알림 `src/features/notices/`, 알림 설정 `src/features/settings/`, 공용 확인 창 `src/shared/components/common/confirm.ts`·`ConfirmHost.tsx`, 공용 "?" 설명 `src/shared/components/common/TermHelp.tsx`, mock `src/mocks/taskSplit.ts`·`taskSplitProposal.ts`·`taskSplitCheck.ts`·`notices.ts`.

## 사용자 흐름

### 맡기기

1. 예상 시간이 4시간 이상인 작업에는 카드에 `4시간 이상 · 쪼개기`가, 작업 상세에 `쪼개기` 버튼과 `예상 시간이 4시간 이상이에요. …` 한 줄이 보인다. 둘 다 서버의 `task.split`과 `GET /v2/task-splits/summary`가 허락할 때만 그린다.
2. 처음 누르면 동의 창(`쪼개기에 AI를 써요`)이 뜬다. 보내는 것·보내지 않는 것·결과를 적고 `동의하고 쪼개기`로 동의를 저장한 뒤 바로 접수한다.
3. 동의한 뒤에는 확인 창(`쪼개기를 맡길까요?`, `오늘 N번 중 1번을 써요. 맡기고 나면 M번 남아요.`)으로 한 번 확인받는다. 남은 횟수가 없으면 확인 창 대신 `오늘 쪼개기 횟수를 다 썼어요. 자정에 다시 채워져요.`를 알린다.
4. 접수되면 토스트 `쪼개기를 맡겼어요. 준비되면 알려 드릴게요.`를 띄우고 작업을 다시 읽는다. 같은 요청을 두 번 보내 두 번째가 내 `requestId`가 실린 409 `SPLIT_ALREADY_IN_PROGRESS`로 오면 성공으로 다룬다(ADR-0035 §7).
5. 접수가 `SPLIT_CONSENT_REQUIRED`로 거부되면 요약을 다시 읽고 동의 창을 다시 연다. 다시 읽은 안내 버전을 화면이 모르면 `안내 내용이 바뀌었어요. 화면을 새로 고친 뒤 다시 시도해 주세요.`를 띄우고 동의 창을 닫는다.

### 잠긴 원본

- 쪼개는 중이거나 제안이 준비된 작업은 서버가 잠근다(`task.split.lock`). 카드에 `쪼개는 중`/`쪼개기 제안 준비됨`, 상세 위에 안내(`쪼개는 중이에요`, `쪼개기 제안이 준비됐어요`)를 보이고, 버튼 줄에는 지금 할 수 있는 것만 둔다: 쪼개는 중이면 `요청 취소`, 준비됨이면 `제안 보기`와 `제안 버리기`.
- 다른 참여자가 건 잠금은 `김서연님이 쪼개는 중이에요.`처럼 닉네임과 단계만 알린다. 카드의 표시는 누를 수 없고 상세에는 버튼이 없다. 닉네임이 없으면 닉네임 없이 적는다.
- 요청 취소와 제안 버리기는 공용 확인 창을 거친다. 취소의 본문은 `취소해도 횟수는 돌아오지 않아요.`, 버리기는 위반이 남은 제안이면 `횟수는 이미 돌려 드렸어요. 이 제안을 버릴까요?`, 아니면 `이미 쓴 횟수는 돌아오지 않아요. 원본 작업은 그대로 남아요.`다.

### 보관함

- 작업 목록 머리의 `쪼개기 보관함`(작업 아카이브 앞)으로 `/app/tasks/splits`에 간다. 입구는 `summary.available`이거나 `archiveCount > 0`일 때 보이고 수를 함께 적는다.
- 보관함은 `GET /v2/task-splits`의 항목을 최근 것부터 그린다: 쪼개는 중(`N분 전 요청`, `취소`), 준비됨(조각 수·뺀 조각·보관 기한, `제안 보기`, `버리기`), 실패(이유와 `횟수는 돌려 드렸어요.`, `버리기`). 실패 항목 버리기에는 확인 창이 없다.
- 요청이 준비되면 서버의 작업 변경 신호로 보관함과 요약을 다시 읽는다. 새로 고치지 않아도 줄이 `준비됨`으로 바뀐다.
- 보관함을 열면 실패 알림을 읽음으로 한다(`POST /v2/notifications/notices/read` `{kind: 'SPLIT_FAILED'}`). 실패해도 알리지 않는다.
- 뒤로 가기는 앱 안의 이전 화면으로 간다. 딥링크로 열어 앱 안에 돌아갈 곳이 없으면 보관함은 `/app/tasks`로, 제안 화면은 `/app/tasks/splits`로 간다(온보딩 가이드와 같은 방식).

### 긴 설명

작업 설명은 2,000자까지 보인다. 작업 상세는 전부, 카드의 펼친 설명은 8줄, 작업 아카이브는 3줄을 줄바꿈 그대로 보인다. 선후관계 고르기 목록은 한 줄 말줄임이라 줄바꿈이 공백으로 접힌다. 제안 화면은 목록 보기의 펼친 설명(`목적·진행 방법·완료 기준`)과 조각 내용 창에서 조각 설명 전체를 줄바꿈 그대로(`white-space: pre-line`) 보인다.

### 제안 화면(`/app/tasks/splits/{requestId}`)

1. 알림, 보관함의 `제안 보기`, 작업 상세의 `제안 보기`로 연다. 열면 `GET /v2/task-splits/{id}`(S5)를 읽고 이 요청의 준비 알림을 읽음으로 한다(`{kind: 'SPLIT_READY', requestId}`). 알림이 제안보다 늦게 생기면 종의 숫자가 늘 때 한 번 더 읽음으로 한다.
2. 머리에 원본 제목, `원본 N시간 · M/D 마감 · M/D까지 보관`, `원본 N시간 → 조각 합계 …`, `제안 버리기`가 있다. 도구 줄에 `지도`·`목록`, `되돌리기`(한 단계), `처음 제안으로`가 있다.
3. 지도는 만들 조각만 단계(서버의 `stage`)마다 열로 놓고 서버가 준 `before`로 선을 긋는다(작업 맵의 `tm-*` 모양). 카드에는 제목, 보정 후 시간(4시간 이상이면 경고 표시), 마감, `×`(빼기)가 있다. 카드를 누르면 조각 내용 창이 열리고 그 조각의 선이 강조된다. 목록은 단계 번호 1, 2, …와 카드(`고치기`·`빼기`, 시간·난이도·마감, `이전 조각:`, 펼치는 설명)다. 한 단계에 조각이 둘 이상이면 `순서 없이 할 수 있어요`를 적는다.
4. 조각 내용 창은 읽기(`조각 내용`: 요약, 이전 조각, 경고, 설명 전체, `빼기`·`고치기`)와 고치기(`조각 고치기`: 제목, 예상 시간(분), 난이도, 마감, 이전 조각 고르기, 설명, `취소`·`확인`) 두 단계다. 599px 이하에서는 아래에서 올라오는 시트로 하단 탭을 덮고, 그보다 넓으면 가운데 카드다(600~899px에서는 아래에서 미끄러져 올라온다).
5. `확인`·`빼기`·`다시 넣기`마다 조각 전체를 `POST /v2/task-splits/{id}/check`(S6)로 보낸다. 기다리는 동안 모든 조각 조작과 창의 버튼이 잠기고 `확인하는 중…`이 보인다. `확인`이 거부되면(`accepted === false`) 창을 닫지 않고 조각을 바꾸지 않으며 칸 아래에 서버 문구를 보인다. 통과하면 읽기 단계로 돌아가고 토스트 `조각을 고쳤어요.`에 `되돌리기`(6초)를 준다. 빼기·다시 넣기는 `"제목" 조각을 뺐어요.`/`"제목" 조각을 다시 넣었어요.` 토스트와 `되돌리기`다.
6. 이전 조각 고르기: 서버의 `orderChoices`를 그린다. 뺀 조각을 거쳐 이어진 후보는 체크된 채 꺼져 있고 `뺀 조각을 거쳐 이어져 있어요`, 순환이 생기는 후보는 꺼져 있고 `순환이 생겨요`와 `?`(순환 설명)다. `이전 조각` 옆 `?`는 용어 설명이다(마우스·초점·누르기로 열고 바깥을 누르면 닫힌다).
7. `뺀 조각 N개` 아래에 AI가 뺀 조각(`이미 끝낸 것 같아요 · 근거`, `겹치는 작업이 있어요 · 근거`)과 회원이 뺀 조각(`내가 뺌 · 시간`)을 두고 `다시 넣기`를 준다. 다시 넣은 조각은 창에서 `"근거" 작업과 겹칠 수 있어요.`나 `"근거"에서 이미 끝냈을 수 있어요.`를 보인다. 모두 빠지면 지도 자리에 `만들 조각이 없어요. 아래에서 조각을 다시 넣어 주세요.`(회원이 뺌) 또는 `이미 끝낸 것 같아요. 아래 근거를 보고, 필요한 조각만 다시 넣어 주세요.`(AI가 뺌)를 보인다.
8. 아래의 적용 막대는 `N개 · 합계`와 `고칠 곳 N개` 또는 `4시간 이상 N개`, `만들기`다. `만들기`는 서버의 `canApply`가 false거나 검사·만들기 중이면 꺼진다.
9. 고치는 중인 내용은 서버에 저장하지 않는다. 새로 고치면 서버의 제안으로 다시 열린다.

### 만들기와 거부

- `만들기`는 확인 창 없이 조각 전체를 `POST …/apply`(S7)로 보낸다. 보내는 동안 모든 조각 조작과 조각 창이 잠긴다.
- 성공하면 원본의 스페이스로 범위를 바꾸고 `/app/task-map`으로 **기록을 바꿔** 간다(뒤로 가기가 제안 화면으로 돌아가지 않는다). 제안 화면의 토스트는 닫고 `조각 N개를 만들었어요.`와 `되돌리기`(6초)만 띄운다. 이어받지 못한 선후관계가 있으면 `반복 작업과의 선후관계 N개는 잇지 못했어요.`를 붙인다.
- 거부: 만료(`SPLIT_REQUEST_NOT_READY` + `EXPIRED`)는 화면 전체가 `보관 기간이 끝난 제안이에요`, `원본 열어 다시 쪼개기`, `보관함으로`다. 권한(`SPLIT_NOT_ELIGIBLE` + `ADMIN_ONLY`)은 지도 위에 `만들지 못했어요. 이제 관리자만 할 수 있어요`와 관리자 이름을 보이는 자리로 올리고 `만들기`를 끈다(`제안 버리기`는 켜 둔다). 조각 값·마감 문제(`SPLIT_INVALID_PIECES` + `check`)는 받은 검사 결과로 다시 그린다. 그 밖에 서버가 답한 거부(순환 안전장치, 서버가 답한 401 포함)는 `만들지 못했어요. 아무것도 바뀌지 않았어요. 잠시 뒤 다시 시도해 주세요.`다.
- `SPLIT_REQUEST_NOT_READY`가 `currentStatus: READY`를 실으면(낙관적 잠금 경로) 고치던 조각을 지킨 채 제안을 조용히 다시 읽는다.
- 응답이 오지 않으면 `만들었는지 확인하지 못했어요.`로 시작하는 문구를 띄우고, 고치던 조각을 맡겨 둔 채 제안을 다시 읽어 실제 상태를 따른다.
- 열 때 이미 관리자만 만들 수 있는 제안이면 `이제 관리자만 만들 수 있어요`와 같은 본문을 보이고 `만들기`를 끈다.
- 제안을 열 수 없을 때: 요청이 없으면(404) `더 이상 볼 수 없는 제안이에요.`, 적용됨·버림·취소됨은 `이미 처리된 요청이에요.`, 접수됨·처리 중·실패는 보관함으로 보낸다.

### 되돌리기

- 만들기 토스트의 `되돌리기`는 `POST …/undo-apply`(S10)를 부르고 제안 화면을 고치던 조각 그대로 다시 연다. 원본은 `쪼개기 제안 준비됨`으로 돌아온다. 복구하지 못한 선후관계가 있으면 `작업을 되돌렸어요. 선후관계 N개는 복구하지 못했어요.`다. 거부되면 서버 문구를 보이고 작업 맵에 머문다.
- 제안 화면의 `제안 버리기`는 확인 창 뒤 보관함으로 가고 토스트 `제안을 버렸어요.`에 `되돌리기`를 준다. 누르면 `POST …/undo-discard`(S11) 뒤 제안 화면을 고치던 조각 그대로 다시 연다.
- 토스트가 사라진 뒤의 되돌리기 화면은 없다.

### 알림 종과 알림함

- 상단 바의 종은 안 읽은 수를 한 번이라도 읽은 뒤에 나타나고, 그 뒤로는 늘 보인다. 안 읽은 알림이 있으면 숫자를 단다(`aria-label` `알림, 새 알림 N개`). 숫자는 작업 변경 신호 직후와 3초 뒤, 창이 다시 보일 때, 보이는 동안 60초마다 다시 읽는다. 다시 읽지 못하면 숫자만 숨긴다. 알림함을 모르는 서버(안 읽은 수를 한 번도 읽지 못함)에서는 종이 없고 오류도 알리지 않는다. 나중에 읽히면 그때 나타난다.
- 종을 누르면 알림함 패널이 열린다(경로가 아니다). 599px 이하에서는 아래에서 올라오는 시트, 넓은 화면은 종 아래에 붙는다. `알림`, `모두 읽음`, 알림 줄(`쪼개기 제안이 준비됐어요`·`쪼개기를 끝내지 못했어요`, 원본 제목, `N분 전`), `쪼개기 보관함 열기`. 모르는 종류의 알림은 목록에서 뺀다. 취소·버리기 버튼은 두지 않는다.
- 알림을 누르면 읽음으로 하고(N3, 실패는 무시) 준비 알림은 제안 화면, 실패 알림은 보관함으로 간다.

### 알림 설정

설정의 알림 묶음에 `작업 쪼개기 알림`(`쪼개기 제안이 준비되거나 실패하면 푸시로 알려 드려요. 꺼도 알림함에는 남아요.`) 토글이 있다. 기본은 켜짐이다. 이 줄은 서버 응답이 `taskSplitEnabled`를 실었을 때만 그린다: 읽기 전과 이 항목을 모르는 서버에서는 줄이 없다(다른 설정 줄은 그대로). 바꾸면 다른 알림 설정과 같이 저장 표시가 뜬다.

### 기능이나 서버가 없을 때

- 요약(S1)이 404·503이거나 `available`이 false면 쪼개기 표시와 입구가 없다(A단계와 같다). 남은 요청이 있으면(`archiveCount > 0`) 보관함 입구는 남는다.
- 빈 보관함은 `보관함이 비어 있어요.`와 `작업 목록으로`이고, 쪼개기를 쓸 수 있을 때(`summary.available`)만 `4시간이 넘는 큰 작업을 열고 "쪼개기"를 눌러 보세요.`를 더한다.
- 알림함을 모르는 서버에서는 종이 없고(위), 알림 설정에 쪼개기 줄이 없다.

## 화면이 계산하지 않는 것과 서버 책임

- 쪼개기를 권할지, 맡길 수 있는지와 그 이유, 잠금, 남은 횟수, 동의 여부와 안내 버전은 서버가 정한다(`task.split`, `allowedActions`·`unavailableReasons`, `summary`). 화면은 연결 일정, 삭제 권한, 예상 시간 240분을 따지지 않는다.
- 잠긴 원본의 수정·삭제·완료 같은 동작은 서버가 `allowedActions`를 false로, 이유를 `SPLIT_IN_PROGRESS`로 준다. 그래도 명령이 가면 서버가 409 `TASK_LOCKED_BY_SPLIT`로 거부한다.
- 요청 상태(쪼개는 중 → 준비됨/실패, 만료)의 전이, 실패 시 횟수 돌려주기, 위반이 남은 제안의 횟수 돌려주기는 서버가 한다. 확인 창을 보는 사이 상태가 바뀌어 `SPLIT_REQUEST_STATE_CHANGED`가 오면 서버 문구를 보이고 다시 읽는다.
- 쪼개기를 모르는 서버(요약이 404·503)에서는 쪼개기 표시와 입구가 하나도 보이지 않고 오류 토스트도 없다.
- 실패 토스트는 `getRequestFailureMessage`로 만든다. 서버가 준 문구가 있으면 그것이 나간다. 예외는 만들기 거부의 "그 밖"이다(고정 문장).
- **제안 화면은 규칙을 계산하지 않는다.** 보정 후 시간, 4시간 이상인지, 단계, 선(`before`), 칸 오류, 경고, 합계, 만들 수 있는지와 그 이유, 모두 빠진 이유, 입력 한도(`limits`), 마감 범위(`dueMin`·`dueMax`), 고를 수 있는 이전 조각과 순환은 모두 `SplitCheck`의 값을 그린다. 화면은 날짜를 계산하지 않고 입력값을 스스로 막지 않는다(조각 창의 `<form>`은 `noValidate`). 마감 순서 규칙(어느 한쪽 조각의 마감에 이미 오류가 있으면 그 쌍은 보지 않는다)과 후보 제목의 20자+`…` 자르기도 서버(mock은 그 근사)가 한다.
- 만들기의 최종 검사, 원본을 휴지통으로 보내고 조각과 선후관계를 만드는 일, 되돌리기의 가능 여부(`SPLIT_UNDO_NOT_AVAILABLE`)는 서버가 한다.
- 알림의 생성·읽음·안 읽은 수는 서버가 정한다. 화면은 제안·보관함을 열 때 읽음 호출을 따로 하고, 실패해도 알리지 않는다.

## REST 계약

FE가 부르는 모든 엔드포인트다. S1~S4·S8·S9·T1·T2·P1의 출처는 X2 실제 코드다(`T/` = `pinit-monolith/modules/task/src/main/java/me/gg/pinit/pinittask/`). 오류 본문은 `{code, message, resourceType, resourceId, latestVersion, split}`이고 `split`의 해당 없는 필드는 null이다(`T/interfaces/workspace/WorkspaceControllerAdvice.java`, `T/domain/split/exception/SplitErrorDetails.java`). 시각은 ISO-8601 instant, 날짜는 `YYYY-MM-DD`다. null인 필드가 빠진 채 와도 같게 다룬다(`== null`). S5~S7·S10·S11과 N1~N4·NP·푸시 줄은 **가정**이다(S5~S7은 BE X4 계획, 나머지는 ADR-0035). 서버 코드와의 대조는 BE 계약 대조 과업이 한다. Notification API의 오류 본문은 `ProblemDetail` + `message` + `code`다.

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
| S5 | `GET /v2/task-splits/{requestId}` | - | 200 `{request: SplitRequestItem, proposal, check}`. 준비됨이 아니면 `proposal`·`check`는 null(또는 없음). 만료 시각이 지난 준비됨은 `request.status`가 `EXPIRED`. `factors`는 `{"1": 1.0, …}` | `SPLIT_REQUEST_NOT_FOUND` 404 | X4 계획 Task 5, ADR §8.2·§8.3(가정) |
| S6 | `POST /v2/task-splits/{requestId}/check` | `{pieces: DraftPiece[], action?: {type: 'CONFIRM' \| 'EXCLUDE' \| 'INCLUDE', key}}`. 조각마다 여덟 칸(`key, title, description, minutes, difficulty, dueDate, after, selected`)만 보낸다 | 200 `SplitCheck`. 저장하지 않는다 | `SPLIT_REQUEST_NOT_FOUND` 404, `SPLIT_REQUEST_NOT_READY` 409 (`currentStatus`), `SPLIT_INVALID_PIECES` 422(`check` 없음), `INVALID_REQUEST` 400 | X4 계획 Task 2~4, ADR §8.3·§9(가정) |
| S7 | `POST /v2/task-splits/{requestId}/apply` | `{pieces: DraftPiece[]}`(뺀 조각 포함 전체) | 200 `{request, created: {key, taskId}[], createdEdges, notInherited: {taskId, direction, reason}[], trashedTaskId}` | `SPLIT_REQUEST_NOT_FOUND` 404, `SPLIT_REQUEST_NOT_READY` 409 (`currentStatus`), `SPLIT_NOT_ELIGIBLE` 422 (`reasons`, 남는 것은 `ADMIN_ONLY`), `SPLIT_INVALID_PIECES` 422 (값·마감 문제일 때 `check`), `SPLIT_NOTHING_SELECTED` 422, `STATE_CONFLICT` 409, `INVALID_REQUEST` 400 | X4 계획 Task 8, ADR §9·§12(가정) |
| S10 | `POST /v2/task-splits/{requestId}/undo-apply` | - | 200 `{request, restoredTaskId, restoredEdgeCount, notRestored: {taskId, direction}[]}` | `SPLIT_REQUEST_NOT_FOUND` 404, `SPLIT_UNDO_NOT_AVAILABLE` 409 (`undoReason`, `reasons`) | ADR §8.2·§9·§13(가정) |
| S11 | `POST /v2/task-splits/{requestId}/undo-discard` | - | 200 `{request}` | S10과 같다 | ADR §8.2·§9·§13(가정) |
| N1 | `GET /v2/notifications/notices` | - | 200 `{unreadCount, items: Notice[]}`. 최근 것부터 많아야 100건 | 일반 실패(패널 안 문구) | ADR §14.3(가정) |
| N2 | `GET /v2/notifications/notices/unread-count` | - | 200 `{unreadCount}` | 어떤 실패든 숫자를 숨긴다 | ADR §14.3(가정) |
| N3 | `POST /v2/notifications/notices/{noticeId}/read` | - | 204 | `NOTICE_NOT_FOUND` 404(무시하고 이동) | ADR §14.3·§9(가정) |
| N4 | `POST /v2/notifications/notices/read` | `{kind?, requestId?}`: `{}` 모두 읽음, `{kind: 'SPLIT_READY', requestId}` 제안을 열 때, `{kind: 'SPLIT_FAILED'}` 보관함을 열 때 | 200 `{unreadCount}` | 화면 호출은 어떤 실패든 무시. `모두 읽음` 실패는 토스트 `알림을 읽음으로 하지 못했어요.` | ADR §14.3(가정) |
| NP | `GET`·`PUT /v2/notifications/preferences` | 기존 필드 + `taskSplitEnabled`(PUT에서 null이면 저장된 값을 둔다) | 기존 필드 + `taskSplitEnabled` | 기존과 같다 | ADR §14.4(가정) |
| 푸시 | 서버가 보내는 `url` | - | 준비됨 `/app/tasks/splits/{requestId}`, 실패 `/app/tasks/splits`. FE 경로가 바뀌면 서버 상수도 바뀐다 | - | ADR §14.4(가정) |
| P1 | 하루 계획 승인 | 기존 | 기존 | 블록 거부 사유 `TASK_LOCKED_BY_SPLIT` | `T/domain/planning/model/BlockRejectionReason.java`, `T/domain/planning/exception/PlanningErrorMessages.java:54` |

`SplitRequestItem = {requestId, taskId, spaceId, originalTitle: string | null, status, failureReason, requestedAt, readyAt, expiresAt, pieceCount, excludedCount, violationRemaining: boolean | null, canApply: boolean | null, cannotApplyReason: 'ADMIN_ONLY' | null}`(`T/application/split/SplitRequestItemView.java`). `status`는 표시 상태다. `Notice = {noticeId: string, kind: 'SPLIT_READY' | 'SPLIT_FAILED', requestId, originalTitle, createdAt, readAt}`. 제안·검사의 타입(`SplitPiece`, `SplitProposalView`, `SplitCheck`)은 `src/features/task-split/api/splitProposals.ts`, 알림은 `src/features/notices/api/notices.ts`에만 있다.

실시간 코드는 고치지 않았다. 서버의 `SPLIT_CHANGED` 기록은 기존 `TASK` 변경 신호로 와서 작업 상세와 `task:changed`를 거쳐 요약·보관함을 다시 읽게 한다(ADR-0035 §14.5).

## mock

`VITE_USE_MOCK_API=true`인 개발 서버에서 `src/mocks/taskSplit.ts`가 S1~S4·S8·S9와 작업 응답의 `split`, 잠긴 원본의 `TASK_LOCKED_BY_SPLIT`을, `taskSplitProposal.ts`(검사 계산은 `taskSplitCheck.ts`)가 S5~S7·S10·S11을, `notices.ts`가 N1~N4와 알림 설정의 `taskSplitEnabled`를 답한다. 검사 계산은 서버 규칙의 근사이고 `src/mocks/` 밖으로 가져가지 않는다. 응답 모양과 문구는 서버 `TaskSplitController`·`SplitErrorMessages`를 따르고, 규칙은 화면 확인에 필요한 만큼의 근사다. 상태는 새로 고치면 처음으로 돌아간다. 계정은 `demo` / `demo1234`.

시작 상태: 접수 켜짐, 동의 안 함, 오늘 3번 중 1번 씀(`settings: {available: true, consented: false, used: 1, limit: 3}`). 안내 버전 `1`, 제공자 `Anthropic`.

| fixture 키 | 작업 | 스페이스 | 요청 상태 |
|---|---|---|---|
| `ready` | 온보딩 개편 설계 (8시간) | 개인 | 준비됨, 조각 5·뺀 조각 2(이미 끝냄 1, 겹침 1). 시안의 제안과 같은 조각 |
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
- `failNextApply('EXPIRED' | 'ADMIN_ONLY' | 'UNEXPECTED' | null)` — 다음 만들기 한 번을 그 거부로 답한다(UNEXPECTED는 순환 안전장치 `STATE_CONFLICT`). 시안의 "시안 전용" 선택 상자 대신이다.

준비된 fixture의 제안은 처음 읽을 때 만든다: `ready`는 시안의 온보딩 제안, `violation`은 보정 후 6시간인 조각이 낀 세 조각, `allExcluded`는 AI가 모두 뺀 세 조각, 그 밖은 2~4조각의 일반 제안이다. 버림 fixture는 버리기 되돌리기용 제안을 가진다.

알림함 mock은 `ready`의 준비 알림(안 읽음), `failed`의 실패 알림(안 읽음), `applied`의 준비 알림(읽음)을 깔아 둔다. 요청이 끝나면(`finish`, 자동 준비) 1.5초 뒤에 알림을 만든다(서버에서 알림이 신호보다 늦게 생기는 것을 흉내 낸다). 응답 지연은 `__pinitMock.setLatency(ms)`로 바꾼다(새로 고쳐도 남는다).

## 화면으로 확인받을 것

ADR-0035 §19 B-6대로 아래 표와 캡처를 함께 보인다. 캡처는 `node qa/task-split/local.mjs`가 `qa/task-split/screenshots/`에 남긴다(실행 방법은 [qa/task-split/README.md](../qa/task-split/README.md)). 파일 이름은 `{mobile|desktop}-{번호}-{이름}.png`이고 모바일은 390×844, 데스크톱은 1280×800이다(두 배율). 15·17·19·29번은 어두운 테마(`…-dark.png`)도 있다. 덧붙인 캡처는 `{viewport}-22-via-excluded-cycle.png`(순환이 생기는 후보), `desktop-17-piece-read-768.png`(768px에서의 조각 창), `{viewport}-38-not-openable-missing.png`(없는 요청)다.

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
| 13 | `bell` | 종 옆 숫자 `2`(배지의 글자와 `aria-label` `알림, 새 알림 2개`를 단언) |
| 14 | `notice-panel` | 알림함 패널: 좁은 화면은 아래 시트, 넓은 화면은 종 아래 |
| 15 | `proposal-map` | 알림으로 연 제안 화면: 지도의 카드 5장, `뺀 조각 2개`, `5개 · 9시간 40분`, `만들기`. 종 숫자가 2→1. 원본(개인)과 고른 스페이스(`제품팀`)가 달라 상단의 `목적` 줄이 없다 |
| 16 | `proposal-list` | 목록 보기: 단계 1~4, 펼친 긴 설명 |
| 17 | `piece-read` | 조각 내용 창(읽기), 누른 조각의 선 강조, 좁은 화면에서 하단 탭을 덮는 시트 |
| 18 | `piece-refused` | 고치기로 바꾸면 초점이 제목 칸. 제목을 비우고 `확인`: 창이 남고 제목 칸 아래 `제목은 1~20자로 입력해 주세요.`(기다리는 동안 `확인하는 중…`) |
| 19 | `piece-edited` | 300분으로 고친 뒤 읽기로 돌아오면 초점이 창 제목(`조각 내용`): 토스트 `조각을 고쳤어요.`·`되돌리기`, `4시간 이상이에요.`, 막대의 `4시간 이상 1개` |
| 20 | `term-help` | `이전 조각` 옆 `?`의 설명(좁은 화면은 tap). 설명 상자 전체가 화면 안. 누른 설명과 키보드 초점으로 연 설명 모두 Esc가 설명만 닫고 창은 남는다. 바깥을 누르면 닫힌다 |
| 21 | `piece-removed` | `팀 리뷰 받기`를 뺀 뒤: 토스트, `뺀 조각 3개`, `내가 뺌 ·`, 앞뒤 조각이 바로 이어진 선 |
| 22 | `via-excluded` | `최종안 문서화`의 고치기: `개편안 스케치 3종`이 체크된 채 꺼져 있고 `뺀 조각을 거쳐 이어져 있어요`(순환 후보는 `-cycle` 캡처) |
| 23 | `undo-toolbar` | 도구 줄 `되돌리기` 뒤 `처음 제안으로` |
| 24 | `reinclude-warning` | `온보딩 문구 초안`을 다시 넣고 연 창의 겹침 경고 |
| 25 | `empty-by-member` | 모두 뺀 지도 자리의 문구, 꺼진 `만들기` |
| 26 | `apply-unexpected` | 그 밖의 거부 토스트, 화면 그대로 |
| 27 | `apply-admin-only` | 권한 거부 안내가 보이는 자리, 꺼진 `만들기`, 켜진 `제안 버리기` |
| 28 | `discard-undo` | 버린 뒤 보관함 토스트의 `되돌리기`로 다시 연 제안 |
| 29 | `applied-map` | 만드는 동안(응답을 1.5초 늦춤) 지도의 `×`, 도구 줄, `다시 넣기`, `제안 버리기`, `만들기`가 꺼지고, 그때 연 조각 창의 버튼도 모두 꺼진다. 만든 뒤 작업 맵: 토스트는 `조각 5개를 만들었어요.`(`되돌리기`) 하나뿐이고(26번의 거부 토스트 없음), 뒤로 가기는 제안 화면이 아니라 보관함(`/app/tasks/splits`)으로 간다(앞으로 가기로 돌아와 이어 감). 가운데 조각의 앞뒤 선 |
| 30 | `apply-undone` | 되돌린 뒤 작업 목록의 원본 `쪼개기 제안 준비됨` |
| 31 | `apply-expired` | 만료 거부의 전체 화면 |
| 32 | `all-excluded` | AI가 모두 뺀 제안의 지도 자리 문구, `뺀 조각 3개` |
| 33 | `admin-only-open` | 열 때 이미 관리자만 만들 수 있는 제안: `이제 관리자만 만들 수 있어요`, 관리자 이름, 꺼진 `만들기` |
| 34 | `late-notice` | 준비 직후 작업 상세의 `제안 보기`로 연 제안. 스크립트는 5초 안에 종 숫자가 앞의 값보다 한 번 커졌다가 앞의 값으로 돌아온 것을 단언한다(늦게 생긴 알림을 종이 읽고, 제안 화면이 그것을 다시 읽음으로 함) |
| 35 | `inbox-read` | 실패한 `결제 모듈 이관`의 보관함 줄. 실패 알림이 종 숫자에 남지 않는다 |
| 36 | `settings` | `작업 쪼개기 알림`을 끈 뒤의 저장 표시 |
| 37 | `read-all` | 알림함의 `모두 읽음`: 배지가 사라지고(`aria-label` `알림`), 안 읽은 줄과 `모두 읽음` 버튼이 없다 |
| 38 | `not-openable` | 만료 말고 열 수 없는 제안(주소를 앱 안에서 바꿔 연다): 처리 중 요청 → 보관함으로 이동, 취소됨·적용됨 → `이미 처리된 요청이에요.`·`보관함으로`, 없는 요청(404) → `더 이상 볼 수 없는 제안이에요.`(`…-38-not-openable-missing.png`) |

A단계가 정한 것(ui-design §11이 열어 둔 것과 문서끼리 다른 곳):

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
| "제안 보기" | A단계에서는 그리지 않았고 B단계가 제안 화면과 함께 켰다(`PROPOSAL_SCREEN_READY = true`) | A단계만으로도 죽은 버튼이 없게 했다 |

B단계가 정한 것(계획의 표와 구현 중 정한 것). 캡처 번호를 함께 적는다:

| 항목 | 정한 것 | 까닭 | 캡처 |
|---|---|---|---|
| 알림함이 비었을 때의 종(§11-5) | 늘 보인다. 숫자만 숨긴다. 안 읽은 수를 읽지 못해도 종은 보인다 | 시안 | 13 |
| 종 숫자를 다시 읽는 때 | 작업 변경 신호 직후와 3초 뒤, 창이 다시 보일 때, 보이는 동안 60초마다 | ui-design §5.3. 알림 기록은 신호보다 늦게 생긴다 | 34, 35 |
| 알림함 | 경로가 아니라 종에서 여는 패널. 제안을 열면 그 준비 알림을, 보관함을 열면 실패 알림을 읽음으로 한다 | 시안, ADR §14.2 | 14, 15, 35 |
| 제안을 열 수 없을 때 | 404 → `더 이상 볼 수 없는 제안이에요.`, 적용됨·버림·취소됨 → `이미 처리된 요청이에요.`, 접수됨·처리 중·실패 → 보관함으로, 만료 → 만료 안내 | UC-03 4a·4b, ui-design §5.3 | 31(만료) |
| 만들기 거부의 "그 밖" | 서버가 답한 거부(서버가 답한 401 포함)는 `만들지 못했어요. 아무것도 바뀌지 않았어요. 잠시 뒤 다시 시도해 주세요.` 고정. 응답이 없으면 `만들었는지 확인하지 못했어요.`로 시작하는 문구 뒤 다시 읽는다 | ui-design §5.6 | 26 |
| `SPLIT_REQUEST_NOT_READY` + `currentStatus: READY` | 고치던 조각을 지킨 채 조용히 다시 읽는다 | 서버의 낙관적 잠금 경로 | - |
| 권한 안내의 제목 | 눌러서 거부되면 `만들지 못했어요. 이제 관리자만 할 수 있어요`, 열 때 이미 그렇다면 `이제 관리자만 만들 수 있어요`. 본문은 같다 | 시안은 눌러서 거부된 경우만 그렸다 | 27, 33 |
| 만드는 동안 | 모든 조각 조작과 조각 창이 잠긴다 | 보낸 조각과 화면이 갈라지지 않게 | - |
| 만든 뒤 | 원본의 스페이스로 범위를 바꾸고 `/app/task-map`으로 기록을 바꿔 간다. 뒤로 가기는 제안으로 돌아가지 않고, 제안 화면의 토스트는 닫고 만들기 토스트만 남긴다 | 작업 맵은 고른 스페이스만 그린다. 처리된 제안을 뒤로 가기로 다시 열지 않게 | 29 |
| 이어받지 못한 선후관계 | 만들기 토스트 뒤에 `반복 작업과의 선후관계 N개는 잇지 못했어요.` | 설계 문서에 문구가 없다 | - |
| 되돌린 뒤 복구하지 못한 선후관계 | 기존 휴지통 문구 `작업을 되돌렸어요. 선후관계 N개는 복구하지 못했어요.` | UC-08 | - |
| 다시 넣은 조각의 안내 | `"{근거}" 작업과 겹칠 수 있어요.`, `"{근거}"에서 이미 끝냈을 수 있어요.` | 시안. 근거 작업의 완료일은 서버가 주지 않는다 | 24 |
| 이전 조각 후보 | 서버가 정한 순서 규칙과 후보 제목(20자 + `…`)을 그대로 그린다. 마감 순서 규칙은 어느 한쪽의 마감에 이미 오류가 있으면 그 쌍을 보지 않는다 | 서버 규칙 | 22 |
| 상단 뒤로 가기 | 앱 안의 이전 화면. 없으면 보관함은 `/app/tasks`, 제안 화면은 `/app/tasks/splits` | 딥링크·푸시로 연 경우 | 33 |
| 알림 설정 문구 | `작업 쪼개기 알림`, `쪼개기 제안이 준비되거나 실패하면 푸시로 알려 드려요. 꺼도 알림함에는 남아요.` | 설계 문서에 문구가 없다 | 36 |
| 출처 없는 새 문구 | `모두 읽음` 실패 토스트 `알림을 읽음으로 하지 못했어요.`, 알림의 원본 제목이 없을 때의 대체어 `작업` | 설계 문서에 문구가 없다(구현 때 정함) | - |
| 다른 스페이스의 제안 | 요청의 스페이스가 고른 스페이스와 다르면 `/app/tasks/splits*`의 상단 띠에서 고른 스페이스의 `목적` 줄을 숨긴다. 고른 스페이스는 바꾸지 않는다 | 다른 스페이스의 목적이 이 제안의 것처럼 보이지 않게 | 15 |
| 조각 문제로 거부된 만들기 | `SPLIT_INVALID_PIECES`가 `check`를 실으면 토스트 없이 받은 검사 결과로 다시 그린다. "아무것도 만들어지지 않았다"를 따로 적은 문장은 없다(지도·막대의 `고칠 곳 N개`와 칸 오류가 그 자리다). ui-design §5.6의 "아무것도 만들어지지 않았다가 먼저 읽혀야 한다"를 이렇게 읽었다. 유지관리자 확인 필요 | Global Constraints "조각 값·마감 문제는 토스트로 끝내지 않는다" | - |

| 알림 ID의 형 | 문자열 | `split_notice.public_id CHAR(36)`(ADR §14.2) | - |
| 만들기 거부를 다시 해 보는 법 | mock의 `__pinitMock.split.failNextApply(…)` | 시안의 "시안 전용" 선택 상자를 화면에 두지 않는다 | 26, 27, 31 |

## 시안과 다른 곳

A단계: 시안을 띄워 작업 카드, 작업 상세(권함·잠금), 동의 창, 확인 창, 보관함을 두 뷰포트에서 같은 자리끼리 캡처해 대조했다. 마크업·class·CSS를 옮긴 곳은 같게 그려진다(잠긴 원본의 버튼 하나짜리 줄, 취소 확인 창, 동의 창의 세 묶음, 보관함 줄의 모양).

B단계: 시안 저장소에 이미 설치된 의존성으로 시안의 Vite 개발 서버를 띄워(새로 설치하지 않았고 Vite 캐시는 시안 밖에 두었다) 알림 종·알림함, 제안 화면(지도, 목록, 조각 내용 창의 읽기·고치기, 뺀 조각, 적용 막대), 권한 거부, 만료 안내를 390×844와 1280×800에서 같은 자리끼리 캡처해 위 캡처와 나란히 보고, 시안 소스(`src/features/task-split/`)와 대조했다. 지도 카드·선, 조각 창 두 단계, 이전 조각 고르기(순환 표시 포함), 적용 막대, 권한 안내 상자, 만료 화면, 알림 패널(좁은 화면의 시트, 넓은 화면의 종 아래)은 같게 그려진다. 남은 차이:

정한 것(계획과 구현 중 정한 것):

- 문구: 동의 창에 제공자 이름·100건·마감 경과·담당자 없는 작업·프로젝트 목표가 더해졌다(A단계 표). 취소 확인과 횟수 돌려주기 문구에서 "오늘"을 뺐다(`취소해도 횟수는 돌아오지 않아요.`, `횟수는 돌려 드렸어요.`).
- 보관함의 준비된 줄: 시안은 읽지 않은 줄(`data-unread`)을 파란 테두리·파란 상태 글자로 그린다. 읽음은 알림함의 것이라 보관함 줄에는 그리지 않는다.
- 상태 이름: 시안의 `PROCESSING`, `PROVIDER` 같은 이름 대신 ADR의 `QUEUED`·`RUNNING`·`PROVIDER_UNAVAILABLE` 등을 쓴다. 화면에 보이는 글자는 같다.
- 뺀 조각의 근거 줄: 시안의 `(11/5에 완료)` 같은 근거 작업의 완료일이 없다. 서버가 주지 않는다(ADR §8.3).
- 시안의 "시안 전용" 만들기 결과 선택 상자가 없다. 같은 거부는 mock의 `failNextApply`로 재현한다.
- 시안의 준비됨 인앱 토스트(`SplitNotifier`)가 없다. 종 숫자와 알림함으로 알린다.
- 열 때 이미 관리자만 만들 수 있는 제안의 제목 `이제 관리자만 만들 수 있어요`(시안은 눌러서 거부된 경우만 그렸다).
- 열 수 없는 제안의 문구는 시안의 `이 제안은 더 이상 볼 수 없어요.` 한 문장 대신 `더 이상 볼 수 없는 제안이에요.`/`이미 처리된 요청이에요.`로 나눴다.
- 확인 창의 층: 조각 창(`.split-dialog__backdrop`)은 시안의 `calc(var(--z-modal-backdrop) + 6)` 대신 기본 모달 층 `var(--z-modal-backdrop)`이다. FE의 공용 확인 창(`+ 1`)이 조각 창 위에 그려진다.

결함(위 표 1번)이었던 것: 만들기 거부의 오류 토스트가 작업 맵의 만들기 토스트와 함께 보였다. 이제 다음 만들기·성공·화면을 떠날 때 닫는다.

스페이스: 제안 화면은 지금 고른 범위(스페이스)를 바꾸지 않는다. 만든 뒤에야 원본의 스페이스로 바꾼다. 요청의 스페이스가 고른 스페이스와 다르면 `/app/tasks/splits*` 화면의 상단 띠에서 고른 스페이스의 `목적` 줄을 숨긴다(`features/spaces/pageSpace.ts`).

데이터만 다른 것(설계 차이 아님): 보관 기한 날짜(mock 준비 fixture는 6일 남음, 시안은 7일), 알림함의 알림 수(mock은 읽은 알림과 12번에서 준비된 요청의 알림을 더 가진다), 사이드바 머리(시안은 더 이전 FE에서 가져와 로고가 있다. 쪼개기 밖의 차이다).

밝은·어두운 테마: 기존 화면의 꺼진 버튼 색(ui-design §11 "구현 때 따로 볼 것", 예: 도구 줄의 꺼진 `되돌리기`·`처음 제안으로`, 꺼진 `만들기`)은 시안과 같고 고치지 않았다.

## 검증

- 단위 시험: `tests/task-split-*.test.mjs`(API 모듈, 잠금 이유, mock 핸들러와 검사·만들기·되돌리기, 다듬기 상태와 화면 판정, 문구, 지도 배치, 조각 창, 제안 화면, 만들기, 요약·명령, 시작 흐름, 카드·상세 표시, 보관함), `tests/notices.test.mjs`, `tests/notification-preferences.test.mjs`, `tests/term-help.test.mjs`, `tests/confirm-dialog.test.mjs`, `tests/long-description.test.mjs`. `npm test`·`npm run lint`·`npm run build`가 통과한다(빌드는 기존 청크 크기 경고만).
- 브라우저: `node qa/task-split/local.mjs`가 Vite 개발 서버(mock)와 Chromium으로 위 38단계를 두 뷰포트(390×844 손가락 입력, 1280×800)에서 걷는다. 단계마다 문구를 확인하고 페이지 가로 넘침(`scrollWidth <= 뷰포트 너비`)을 확인한다. 캡처는 최종 리뷰 수정(`8c4ef4f`~`c4b08f3`) 위에서 다시 찍었다.
- console 오류: console error와 pageerror가 하나라도 있으면 실패한다. 예외는 일부러 만든 거부의 HTTP 기록이고, 뷰포트마다 경우별로 줄 수를 단언한다: 만들기 거부 UNEXPECTED·ADMIN_ONLY·EXPIRED 각 2줄, 없는 요청 열기 4줄. 거부된 응답 하나가 두 줄인 까닭: `src/shared/api/httpClient.ts`의 요청 함수가 오류 응답에 `❌ API Error`를 찍고 `ApiError`를 던지면, 같은 함수의 바깥 `catch`가 그것을 받아 `🔥 API Error caught`를 찍고 다시 던진다. 없는 요청이 4줄인 까닭: 개발 서버는 `StrictMode`(`src/main.tsx`)라 처음 붙을 때 effect를 한 번 더 돌려 제안을 두 번 읽는다(운영 빌드에서는 한 번).
- 테마: 15·17·19·29번은 밝은 테마와 어두운 테마로 찍었다. "글자와 바탕의 대비가 깨진 곳이 없다"는 캡처를 눈으로 본 판단이고, 대비를 잰 것이 아니다.
- ui-design §11에서 "확인하지 않은 것"으로 남았던 모바일에서 "?" 설명 누르기(20), 권한·만료 거부 화면(27·31·33), 알림을 눌러 이동(15), 조각 내용 창의 "확인"(18·19)을 확인했다.
- 따로 잰 것(스크립트의 `note` 줄): 지도 상자는 두 너비 모두 상자 안 가로 스크롤 없이 들어간다(390px: 352px 상자, 1280px: 978px 상자). 조각 창의 배경 층은 기본 모달 층(`var(--z-modal-backdrop)` = 200)으로 하단 탭(100)과 미니 플레이어를 덮고, 공용 확인 창(`+ 1`)은 그 위다. 창이 열린 동안 Tab은 창 안에서만 돈다. 768px에서 창은 가운데 카드(x 104, 폭 560)로 아래(y 775)에서 올라온다(y 249). "?" 설명 상자는 390px에서 x 8~288, 1280px에서 x 368~648. 종 배지와 패널의 색은 토큰으로 풀린다(배지 흰 글자·파란 바탕, 패널 흰 바탕). 390px에서 패널은 화면 너비의 아래 시트이고 페이지가 넘치지 않는다.
- 이전: A단계에서 따로 손으로 확인한 것(새 요청의 자동 준비, 남은 횟수 다시 읽기, 긴 설명의 줄 수와 말줄임, 다른 참여자 잠금 표시, 모르는 안내 버전 토스트, 보관함 뒤로 가기의 대체 경로)은 그대로다. 기능·알림함을 모르는 서버에서 종·설정 줄이 없고 빈 보관함 문구가 바뀌는 것은 최종 리뷰 수정 때 일회성 스크립트(mock 응답을 브라우저에서 감쌈)로 확인했고, 이 스크립트에는 없다.
- 브라우저에서 확인하지 않은 것(mock으로 만들 수 없어 단위 시험만, mock 스위치는 더하지 않았다):
  - 이어받지 못한 선후관계의 만들기 토스트(`notInherited`): `tests/task-split-apply.test.mjs` "뺀 조각도 함께 보내고, 잇지 못한 선후관계를 알린다".
  - 되돌린 뒤 복구하지 못한 선후관계(`notRestored`): 같은 파일 "되돌리면 고치던 조각을 맡겨 둔 채 제안 화면으로 돌아간다", "모두 복구하면 따로 알리지 않고 제안 화면으로 돌아간다".
  - 만들기 되돌리기의 거부: 같은 파일 "되돌리기가 거부되면 서버 문구를 보이고 작업 맵에 머문다", "되돌리기에 응답이 없으면 연결을 확인하라고 한다".
  - `SPLIT_INVALID_PIECES` + `check`로 다시 그리기: 같은 파일 "조각 문제로 거부되면 토스트 없이 받은 검사 결과로 다시 그린다", `check` 없는 경우 "검사 결과 없이 조각 문제로 거부되면(키가 맞지 않음) 제안을 다시 읽는다".
  - 응답 없는 만들기: 같은 파일 "응답이 오지 않으면 바뀌지 않았다고 말하지 않고 고치던 조각으로 다시 읽는다", "게이트웨이 오류(5xx, 앱 코드 없음)는 처리했는지 모르니 미확인으로 다룬다".
  - `SPLIT_REQUEST_NOT_READY` + `currentStatus: READY`의 조용한 다시 읽기: 같은 파일 "요청이 아직 준비됨인데 거부되면 제안을 다시 읽게 한다", `tests/task-split-proposal.test.mjs` "요청이 아직 준비됨인데 검사가 거부되면 제안을 다시 읽고 고치던 조각을 잇는다".
  - `모두 읽음` 실패 토스트(`알림을 읽음으로 하지 못했어요.`): 브라우저에서도 단위 시험에서도 확인하지 않았다(성공은 37번).
  - 브라우저로 확인한 것으로 옮긴 것: 만드는 동안 조각 조작의 잠금(29), `모두 읽음`(37), 만료 말고 열 수 없는 제안 세 갈래(38), 작업 맵으로 기록을 바꾸는 이동과 토스트 하나(29).
- 확인하지 않은 것: 실제 서버(X2·X4·X5·X6)·DB와의 연결과 계약 대조(다음 과업), 실제 인증·세션 갱신, 실제 푸시와 서비스 워커(캡처는 서비스 워커를 막고 찍었다), 실시간 스트림의 실제 `SPLIT_CHANGED` 전달과 지연, 조각 50개짜리 제안의 사용감, 실제 기기·스크린 리더, 운영 배포. 서비스 워커 캐시 버전은 `pinit-cache-v36`으로 올렸다(`tests/service-worker-cache-version.test.mjs`).

## 브라우저 확인에서 찾은 결함(모두 고침)

| # | 결함 | 고친 커밋 | 지금의 증거 |
|---|---|---|---|
| 1 | 만들기가 거부된 오류 토스트가 닫을 때까지 남아, 다시 만든 뒤 작업 맵에서 `조각 5개를 만들었어요.`와 함께 보이고 좁은 화면에서 상단 뒤로 가기를 가렸다 | `8c4ef4f`(다음 만들기·화면을 떠날 때 닫는다) | 29번이 작업 맵의 토스트가 만들기 토스트 하나뿐임을 단언, `mobile-29-applied-map.png` |
| 2 | "?" 설명이 390px에서 왼쪽으로 잘렸다(x = -61px). 시안의 CSS와 같았다 | `9b71c09`(화면과 넘침 상자 안으로 민다) | 20번이 설명 상자가 화면 안임을 단언(390px x 8), `mobile-20-term-help.png` |
| 3 | Esc가 `data-open`만 지우고 초점·hover로 설명이 계속 보였다 | `9b71c09`(Esc는 떠 있는 설명만 닫는다) | 20번이 누른 설명과 초점으로 연 설명 모두 Esc 뒤 숨고 창이 남음을 단언 |
| 4 | 조각 창의 읽기↔고치기 뒤 초점이 `body`로 떨어졌다 | `0815b3e`(고치기는 첫 칸, 읽기는 제목) | 18·19번이 초점을 단언 |
| 5 | 마감 없는 조각의 지도 카드가 빈 `<time dateTime="">`을 그렸다 | `32b44fa`(`MapPiece.dueDate: string \| null`, 마감이 없으면 `<time>`을 그리지 않는다) | mock은 마감 없는 조각을 만들지 않아 브라우저 증거 없음. `tests/task-split-map.test.mjs` "마감이 없는 조각은 지도에 빈 날짜를 그리지 않는다" |
