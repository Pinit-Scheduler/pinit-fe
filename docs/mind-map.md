# 마인드맵

2026-11-20 기능 변경 문서다. 회원 한 명이 한 장의 나무(주제 하나에서 뻗는 가지)를 쓰는 마인드맵 화면과 저장을 설명한다. 화면은 ui-design에서 만들고 확인한 것을 같은 바이트로 옮겼고, 이 저장소에서는 **mock API로** 확인했다. 그 확인은 BE 운영 배포와 별개다. 운영 서버에 마인드맵이 반영됐는지는 이 문서가 말하지 않는다.

**병합 조건.** `master`에 병합하면 Vercel이 바로 배포한다. 오늘 화면의 마인드맵 카드는 모든 회원에게 늘 보이므로, BE의 `/v2/mind-map`이 운영에 반영된 뒤에만 병합한다(ADR-0036 §10의 1·2단계). MCP 스위치(`pinit.mcp.mind-map.enabled`)는 화면 배포 뒤에 켠다(§10의 4단계).

- 화면 기준: pinit-docs의 마인드맵 설계와 Y3 계획(`docs/superpowers/plans/2026-11-20-mind-map-y3-ui-design.md`)의 "이 계획이 정한 것" 표. 시안과 측정 기록은 `pinit-ui-design` README의 "마인드맵" 절이다.
- API 기준: `pinit-monolith`의 ADR-0036과 `/v2/mind-map…` 구현(아래 "계약 대조").

## 들어가는 길

- 왼쪽 메뉴 `내 화면`의 `마인드맵`(`/app/mind-map`). 순서는 오늘, 마인드맵, 통계였고, 2026-11-25에 일정이 이 묶음으로 올라와 오늘, 일정, 마인드맵, 통계다([일정을 개인 단위로](purpose-spaces.md#일정을-개인-단위로-화면과-폼-2026-11-25)).
- 홈(오늘 화면)의 마인드맵 카드. 맵을 읽지 못하면 카드가 서버 문구를 보인다.
- 설정 머리 바로 아래 카드의 `마인드맵` 줄. 폰에서 들어가는 주된 길이다.

계정당 한 장이고 스페이스와 상관없다.

## 화면이 계산하지 않는 것

- 나무 규칙(주제 id·체크·id 형식·중복·글 길이·가지 수·깊이)의 최종 판정은 서버다. 화면은 같은 규칙으로 미리 막기만 하고, 서버가 거절하면 서버 문구를 그대로 보인다.
- 제한값(가지 수, 글 길이, 깊이)은 화면에 박아 두지 않고 GET 응답의 `limits`를 쓴다.
- 글 정리(공백·줄바꿈)는 서버와 같은 표(`tests/fixtures/mind-map-text-cases.json`)로 검사한다. 이 파일은 BE `modules/task/src/test/resources/mind-map/text-normalization-cases.json`과 바이트가 같아야 하고 다르면 BE가 원본이다.

## 저장

- 화면의 나무는 **확정된 나무**만 서버로 간다. 글을 쓰는 중인 가지는 확정하기 전에는 보내지 않는다.
- 변경은 1초 모아 보내고, 창이 숨거나 탭이 닫힐 때는 바로 보낸다. 창이 숨을 때는 본문이 64KB 안이면 keepalive로 보내고, 글을 쓰는 중이면 보내지 않는다(탭이 닫힐 때 `pagehide`가 쓰던 글을 확정해 보낸다).
- 저장마다 `saveId`(소문자 UUID)를 붙인다. 응답을 잃은 저장은 다음 저장이 받은 409의 `lastSaveId`로 들어갔는지 안다.
- 서버 version이 다르면 409 `VERSION_CONFLICT`. 화면은 덮어쓰지 않고 토스트를 한 번 띄운 뒤 최신 나무를 불러온다. 저장 상태는 위 막대에서 저장하지 못한 이유와 `다시 시도`로 보인다.
- 페이지를 떠난 뒤의 저장이 실패하면 어느 화면에서든 토스트를 띄우고, 같은 계정으로 다시 열었을 때 서버 version이 그대로면 그 나무로 이어서 저장한다. 그사이 바뀌었으면 덮지 않고 알린다.
- 커서(고른 가지)는 `PUT /v2/mind-map/cursor`로 따로 보낸다(204).

## 계약 대조

2026-11-20, pinit-monolith 브랜치 `claude/dreamy-gauss-ln9kc1`, 커밋 `f7dfcbd`(`docs(mind-map): Y2 기록의 열린 항목을 최종 리뷰 반영에 맞춘다`, Y1·Y2 구현과 최종 리뷰 반영 포함)의 서버 코드를 읽어 `/v2/mind-map…`의 경로, 본문, 오류 모양, 문구를 mock(`src/mocks/mindMap.ts`)과 화면의 API 모듈(`src/features/mind-map/api/mindMapApi.ts`)에 줄마다 견줬다. 대조는 코드와 서버 시험(`MindMapControllerV2IntegrationTest`)을 읽어서 했고 실제 서버에 연결해 부르지는 않았다. 다른 것은 ui-design `claude/dreamy-gauss-ln9kc1`의 `677f731`(`fix(mind-map): mock을 BE 계약에 맞춘다`)에서 고쳐 이 저장소로 같은 바이트로 옮겼다. 대조는 서버 코드를 읽어서 한 것이라, Jackson 기본 변환처럼 서버를 불러 봐야 아는 느슨한 종류 처리는 확인하지 못했고 아래 "남긴 차이"에 확인하지 않은 것으로 적었다.

BE 근거의 경로는 `modules/task/src/main/java/me/gg/pinit/pinittask/` 아래이고 `M/`로 줄였다. mock 줄은 `src/mocks/mindMap.ts`(고친 뒤)다.

| 항목 | BE 근거 | BE 값 | mock | 조치 |
|---|---|---|---|---|
| 경로와 메서드 | `M/interfaces/mindmap/MindMapControllerV2.java:27,39,49,66` | `GET /v2/mind-map`, `PUT /v2/mind-map`, `PUT /v2/mind-map/cursor` | `:16-17`, `handleMindMap`의 경로 셋 | 없음 |
| GET 200 본문 | `M/interfaces/mindmap/dto/MindMapResponse.java:8-19`, `MindMapNodeDto.java:12-18` | `{version, root, cursorNodeId, limits{maxBranches, maxTextLength, maxDepth}}`, 가지 `{id, text, collapsed, check, children}` | `readMap`(`:238-251`) 같은 칸 | 없음 |
| `limits` | `M/domain/mindmap/model/MindMapPolicy.java:16-18` | 500·100·32 | `MOCK_MIND_MAP_LIMITS`(`:12`) 500·100·32 | 없음 |
| PUT 200 본문 | `M/interfaces/mindmap/dto/MindMapSaveResponse.java:5-6` | `{version}` | `:292` `{version}` | 없음 |
| cursor 204 | `MindMapControllerV2.java:72-76` | 본문 없음 204 | `noContent()` | 없음 |
| 409 충돌 본문 | `M/interfaces/mindmap/dto/MindMapConflictResponse.java:6-11`, `MindMapControllerAdvice.java:87-93`, `MindMapConflictException.java:12` | `{code: "VERSION_CONFLICT", message, latestVersion, lastSaveId}`. 행이 없으면 `latestVersion` 0, `lastSaveId` null. MCP가 마지막이면 `lastSaveId` null | `:271`, `remoteEdit`이 `lastSaveId`를 비운다 | 없음 |
| 충돌 문구 | `M/domain/mindmap/exception/MindMapErrorMessages.java:16` `CONCURRENT_CHANGE` | `다른 곳에서 마인드맵이 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 고쳐 주세요.` | `:20` 같은 글 | 없음 |
| 409 `MEMBER_WITHDRAWN` | `MindMapControllerAdvice.java:95-100`, `MindMapWithdrawnException.java:9`, `MindMapErrorMessages.java:17`, `M/application/mindmap/MindMapService.java:161-162,181-182` | 탈퇴한 회원의 **처음** 저장(행 없음)만. 규칙 검사 뒤. `{code: "MEMBER_WITHDRAWN", message: "탈퇴한 회원의 마인드맵은 쓸 수 없어요.", latestVersion: null, lastSaveId: null}` | 전: 없음. 후: `:278-279`, 조작 `__pinitMock.mindMap.withdraw(memberId)`(`:332`, 맵을 지우고 탈퇴 표시) | mock에 더했다 |
| 400 `ErrorResponse` 칸 | `M/interfaces/exception/ErrorResponse.java:8-13,30` | `{timestamp, status, error, message, path: "uri=/v2/mind-map…", errors[{field, rejectedValue, reason}]}`, `errors`는 없으면 `[]` | `errorBody`(`:129`) 같은 칸 | 없음 |
| 검사 차례 | `MindMapControllerV2.java:62`(모양) → `MindMapService.java:67`(version) → `:157`(규칙) → `:181`(탈퇴) | 본문 읽기 → 값의 종류 → 모양 → version → 나무 규칙 → 탈퇴 | 전: 모양 → version → 규칙. 후: BE와 같다 | 고쳤다 |
| 위반 규칙 이름 여덟 | `M/domain/mindmap/model/MindMapRule.java:5-12` | `ROOT_ID_CHANGED`, `ROOT_CHECKED`, `ID_FORMAT`, `ID_DUPLICATE`, `TEXT_EMPTY`, `TEXT_TOO_LONG`, `TOO_MANY_BRANCHES`, `TOO_DEEP` | `RULE_REASONS`(`:26`) 같은 여덟 | 없음 |
| 규칙 위반 본문 | `MindMapControllerAdvice.java:37-45`, `InvalidMindMapTreeException.java` | `errors[i] = {field: 가지 id, rejectedValue: 규칙 이름, reason: 문구}`, `message`는 첫 위반의 문구. 가지 수·깊이를 넘으면 그 위반 하나만(`field`는 주제 id) | `ruleErrors`(`:208`) 같은 모양·차례 | 없음 |
| 규칙마다의 문구 | `MindMapErrorMessages.java:6-13` | `ROOT_ID_CHANGED` `가장 위의 주제는 바꿀 수 없어요. 화면을 새로고침한 뒤 다시 시도해 주세요.` / `ROOT_CHECKED` `가장 위의 주제에는 체크박스를 달 수 없어요. 체크박스를 없애고 다시 시도해 주세요.` / `ID_FORMAT` `가지를 구별하는 값이 올바르지 않아요. 화면을 새로고침한 뒤 다시 시도해 주세요.` / `ID_DUPLICATE` `같은 가지가 두 번 들어 있어요. 화면을 새로고침한 뒤 다시 시도해 주세요.` / `TEXT_EMPTY` `가지의 글이 비어 있어요. 글을 적거나 가지를 지워 주세요.` / `TEXT_TOO_LONG` `가지의 글은 100자까지 적을 수 있어요. 글을 줄여 주세요.` / `TOO_MANY_BRANCHES` `가지는 주제를 포함해 500개까지 만들 수 있어요. 안 쓰는 가지를 지운 뒤 다시 시도해 주세요.` / `TOO_DEEP` `가지는 주제 아래로 32단계까지 이어 만들 수 있어요. 단계를 줄여 주세요.` | 전: 여덟 모두 다른 글(예: `가지 글을 적어 주세요.`). 후: `:26-35` BE 글 그대로 | 고쳤다 |
| 모양 오류(빠짐·null·모르는 체크) | `MindMapControllerAdvice.java:47-51`, `M/interfaces/mindmap/dto/MindMapSaveRequest.java:25-34`, `MindMapNodeDto.java:30-75` | 모두 모은다. 차례 `expectedVersion`(null 또는 음수), `saveId`(null 또는 소문자 UUID 아님), `root`, 가지마다 `.check`·`.id`·`.text`·`.collapsed`·`.children`, null인 가지는 `root.children[1]`. `rejectedValue`는 받은 값(없으면 null), `message`·`reason`은 `REQUEST_SHAPE` `마인드맵의 내용을 읽지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.`(`MindMapErrorMessages.java:15`) | 전: `message` `마인드맵을 저장하지 못했어요. 새로 고친 뒤 다시 해 주세요.`, `reason` `형식이 올바르지 않아요.`, 가지 칸 차례 id·text·collapsed·check. 후: `shapeErrors`(`:190`) BE 차례와 문구 | 고쳤다 |
| 값의 종류가 틀린 400 | `MindMapControllerAdvice.java:58-85` | Jackson이 멈춘 첫 곳 **하나**, `field`는 `root.children[0].children` 모양의 JSON 경로, `rejectedValue` null, `message`·`reason` `REQUEST_SHAPE`. 숫자 글자 `"0"`의 `expectedVersion`은 받는다(서버 시험 `문자열_expectedVersion은_Jackson_기본_변환으로_받는다`) | 전: 종류 오류도 모두 모으고 받은 값을 실었다, `"0"`은 400. 후: `saveMismatch`·`nodeMismatch`(`:156-188`) 문서 차례의 첫 곳 하나, `"0"`은 0으로 받는다 | 고쳤다 |
| 음수 `expectedVersion` | `MindMapSaveRequest.java:25-26` | 409가 아니라 400 모양 오류(`field` `expectedVersion`, `rejectedValue` -1) | 전에도 400. 후: 문구만 `REQUEST_SHAPE` | 고쳤다(문구) |
| 깨진 JSON·빈 본문 | `MindMapControllerAdvice.java:68-69`, `M/domain/error/RequestErrorMessages.java:18` | 일반 400, `message` `요청을 처리하지 못했어요. 화면을 새로고침한 뒤 다시 시도해 주세요.`(`UNREADABLE_BODY`), `errors` `[]`. 객체가 아닌 본문(`[]`)도 같다(경로가 빈 Jackson 오류) | 전: 빈 객체로 읽어 모양 오류 셋. 후: `readBody`(`:139`)가 null이면 `unreadableBody`. cursor도 같다 | 고쳤다 |
| cursor 형식 오류 | `M/interfaces/mindmap/dto/MindMapCursorRequest.java:14-18` | 400 `REQUEST_SHAPE`, `errors[{field: "nodeId", rejectedValue: 받은 값 또는 null, reason: REQUEST_SHAPE}]` | 전: `message`·`reason` `형식이 올바르지 않아요.`. 후: `:301` BE와 같다 | 고쳤다 |
| 읽기 500 | `MindMapControllerAdvice.java:102-106`, `MindMapErrorMessages.java:18` | `ErrorResponse`, `message` `저장된 마인드맵을 읽지 못했어요. 잠시 후 다시 시도해 주세요.`(`UNREADABLE`), `errors` `[]`, **`code` 칸 없음**(계획의 `MAP_UNREADABLE`은 코드가 아니라 이 문구다) | 전: `마인드맵을 불러오지 못했어요.`. 후: `failNextLoad`가 BE 문구 | 고쳤다. 오늘 화면 카드는 서버 문구를 보이므로 `qa/mind-map/local.mjs`의 기대 문구도 바꿨다. 맵 화면은 제목 `마인드맵을 불러오지 못했어요.` 아래에 이 문구를 적는다 |
| 그 밖의 500 | `M/interfaces/exception/TaskFallbackControllerAdvice.java:58-72`, `RequestErrorMessages.java:30` | `ErrorResponse`, `message` `일시적인 문제로 처리하지 못했어요. 잠시 후 다시 시도해 주세요.`(`UNEXPECTED`) | 전: `마인드맵을 저장하지 못했어요.`. 후: `failNextSave('server')`가 BE 문구 | 고쳤다 |
| `cursorNodeId` 보정 | `MindMapService.java:56-62` | 저장된 값이 없거나 나무에 없으면 주제 id. 저장한 적 없으면 주제 id | `:246`, `:249` 같다 | 없음 |
| 저장 안 한 회원의 cursor 저장 | `MindMapService.java:76-83`, `M/domain/mindmap/repository/MindMapRepository.java:38` | 행이 없으면 아무것도 바꾸지 않고 204. 나무에 없는 id도 저장한다(읽을 때 보정) | `:303` 같다 | 없음 |
| 화면의 실패 가르기 | — | 위의 본문들 | `classifySaveError`(`mindMapApi.ts:69-88`): 409 `VERSION_CONFLICT`+숫자 `latestVersion`만 충돌, 400과 `MEMBER_WITHDRAWN`(`latestVersion` null)은 거부, 5xx·응답 없음은 잃은 저장. 문구는 `httpClient`가 `errors[].reason`(없으면 `message`)에서 꺼낸다 | 코드 변경 없음. `tests/mind-map-api.test.mjs`의 `BE의 실패 본문 그대로를 가른다`로 BE 본문 그대로 확인 |

### 남긴 차이

화면 동작에 닿지 않아 고치지 않은 것이다.

- **주제 id**: BE는 회원 id에서 이름 기반 UUID를 만든다(`MindMapRootId.of`). mock은 `6d6d0000-0000-4000-8000-<회원 id 16진수>`다. 화면은 주제 id를 만들지 않고 GET에서 받은 값을 그대로 보낸다.
- **Jackson 기본 변환**: mock은 숫자 글자의 `expectedVersion`만 숫자로 받는다. 숫자를 글 칸에 보내거나 `"true"`를 `collapsed`에, `1.5`를 `expectedVersion`에 보낼 때 BE가 Jackson 기본값으로 받는지는 확인하지 않았고, mock은 값의 종류 오류로 답한다. 화면은 늘 바른 종류를 보낸다.
- **가지 수와 깊이를 함께 넘을 때**: BE는 스택으로 도는 동안 먼저 닿은 한도 하나를 답한다(`MindMapPolicy.java:47-70`). mock은 늘 가지 수를 먼저 본다. 둘 다 위반 하나만 싣는 것은 같다.
- **`violations`의 `rule`**: `classifySaveError`는 `rejectedValue`가 글이면 `rule`에 넣는다. 모양 오류에서는 규칙 이름이 아니라 받은 값(예: `MAYBE`)이 들어간다. 화면은 `violations`를 쓰지 않고 문구만 보이므로 두었다.
- **503 `lost`와 401**: `failNextSave('lost')`의 503(반영한 뒤 응답을 잃음)과 로그인 없는 401은 이 controller가 아니라 게이트웨이·네트워크를 흉내 낸 것이라 BE 본문과 대조하지 않았다.

## mock 사용법

dev 서버를 `VITE_USE_MOCK_API=true`로 띄운다. demo 계정에 예시 맵이 깔려 있다. 개발자 도구의 `__pinitMock.mindMap`:

- `failNextSave('server' | 'lost' | null)`: 다음 저장 한 번을 실패시킨다. `server`는 반영하지 않고 500, `lost`는 반영한 뒤 503(응답을 잃은 저장).
- `failNextLoad(true)`: 다음 읽기 한 번을 500으로 답한다.
- `withdraw(memberId = 1)`: 회원을 탈퇴시킨다. 그 뒤 처음 저장이 409 `MEMBER_WITHDRAWN`으로 거절된다(새로 고치면 되돌아간다).
- `remoteEdit()`: 다른 기기나 MCP가 고친 것처럼 첫 가지 글 끝에 ` (다른 기기)`를 붙이고 version을 올린다. `lastSaveId`는 비운다.

글 정리 표는 fixture(`tests/fixtures/mind-map-text-cases.json`), 화면 확인은 `node qa/mind-map/local.mjs`(`QA_ORIGIN`으로 이미 띄운 dev 서버를 쓴다. 이 저장소에는 `start` 스크립트가 없어 `VITE_USE_MOCK_API=true npx vite --host 127.0.0.1 --port 4174`로 띄웠다)다. 캡처는 `qa/mind-map/screenshots/`에 남지만 `.gitignore`에 있어 커밋하지 않는다.

## 화면이 정한 것

정한 표는 Y3 계획의 "이 계획이 정한 것"이다. 아래는 그 가운데 폰 단추 줄을 잰 결과와 저장 줄이다(근거 기록은 ui-design README의 "마인드맵" 절).

- **폰의 동작 단추 줄(390px)**: 일곱 단추(하위 가지, 같은 단계, 글 고치기, 체크박스, 접기, 삭제, 되돌리기)를 아이콘 위·글 아래(11.5px)로 한 줄에 둔다. 이 저장소에서 다시 잰 값은 단추 줄 356px, 단추마다 폭 48px·높이 50px, 글 모두 한 줄, 가장 긴 글이 42.5px로 단추 안쪽에 들어간다. 그래서 글을 숨기지 않았다. 375px에서는 단추 46px로 글이 안쪽 여백에 1.5px, 360px에서는 43px로 0.5px 걸쳐 여유가 거의 없다(여전히 한 줄).
- **좁은 PC 창**: 캔버스 폭이 1,000px 미만이면 단추 옆 단축키(`kbd`)를 숨긴다.
- **미니 플레이어**가 떠 있으면 단추 줄을 PC 24px, 폰 32px 올린다(`MiniPlayerBar.css`의 아래 여백과 같이 바뀌어야 한다).
- **폰의 위 막대**: 첫 줄에 `← 홈`·제목·저장 상태, 둘째 줄에 숫자.
- **오늘 화면의 카드**: "오늘의 작업"은 제자리, "오늘의 일정"은 두 칸일 때만 카드 높이 + 간격만큼 내려간다.
- **저장**: 위 "저장" 절과 같다. 화면 확인의 `leave-fails` 단계가 떠나는 순간의 저장을 모두 500으로 만들어 본다.

## 잘라내기·복사·붙여넣기 (2026-11-21)

정한 것과 재어 본 값은 ui-design README의 "잘라내기·복사·붙여넣기에서 정한 것"이 원본이다. 요약:

- 고른 상태에서 `Ctrl`/`⌘` `X`·`C`·`V`, 또는 가지 메뉴(PC 오른쪽 단추, 터치 500ms 길게 누르기). 단추 줄에는 넣지 않았다(열 개면 390px 폰과 900~1,280px PC에서 글이 잘린다).
- 고른 가지의 마지막 하위 가지로 아래 가지까지 붙이고(체크·접힘 그대로, id는 새로), 한도를 넘으면 하나도 붙이지 않는다. 주제는 복사만 된다.
- 시스템 클립보드에는 들여 쓴 목록 글을 쓰고, 단축키 붙여넣기는 다른 앱의 글을 줄마다 가지로 읽는다.
- 서버 계약은 그대로다. 화면이 만든 나무를 통째로 저장할 뿐이다.
- 서비스 워커 캐시는 `pinit-cache-v41`로 올렸다.
- 검증: 단위 테스트(`tests/mind-map-clipboard.test.mjs`, 키맵), 화면 확인의 `clipboard` 단계(mock, Chromium). Safari·Firefox와 실제 폰의 길게 누르기는 확인하지 않았다.

## 여러 가지 묶어 옮기기와 오른쪽 단추 화면 이동 (2026-11-21)

유지관리자 요청이다. 설계는 pinit-docs의 `docs/superpowers/specs/2026-11-21-mind-map-multi-select-design.md`, 계획은 같은 저장소의 `docs/superpowers/plans/2026-11-21-mind-map-multi-select.md`다. 서버 계약은 그대로이고 화면이 바꾼 나무를 통째로 저장한다.

**바뀐 마우스 동작**

- 빈 곳을 왼쪽 단추로 끌면 범위 선택이다.
  - 사각형에 겹치는 보이는 가지를 고른다.
  - `Shift`를 누르고 끌면 이미 고른 가지에 더한다.
- `Shift`+누르기와 `Ctrl`+누르기(Mac은 `⌘`)는 가지를 하나씩 더하거나 뺀다.
- 고른 가지 가운데 하나를 끌면 함께 옮긴다.
  - 고른 가지의 아래 가지는 위 가지를 따라간다.
  - 놓는 자리에 깊이 우선 차례로 나란히 들어간다.
  - 한 번 놓기가 되돌리기 한 번이다.
  - 하나라도 깊이 한도를 넘으면 하나도 옮기지 않는다.
- 여러 개를 고른 채 지우기·잘라내기·복사는 고른 위 가지 모두에 한다. 복사는 주제가 고른 것에 있으면 주제 하나다.
- 다른 명령은 주 가지 하나만 남기고 한다: 방향키, `Tab`·`Enter`, 글 고치기, 체크, 접기, 되돌리기, 붙여넣기, `Esc`.
- 화면 이동은 오른쪽·가운데 단추 끌기다. 가지 위에서 시작해도 화면 이동이다. Mac의 `Ctrl`+누르기는 오른쪽 단추로 친다.
- 가지 메뉴는 오른쪽 단추를 끌지 않고 뗄 때 연다. 그사이 브라우저가 보내는 `contextmenu`는 막기만 한다.
- 안드로이드 길게 누르기는 지금처럼 바로 연다.
- 키보드 메뉴 키(`Shift`+`F10`)로는 이전에도 지금도 가지 메뉴가 열리지 않는다. 초점이 캔버스에 있어 가지를 찾지 못하기 때문이다.
- Windows는 오른쪽 단추를 뗀 뒤에 `contextmenu`를 보낸다. 그래서 오른쪽 단추로 끌다가 캔버스 밖에서 떼도 문서에서 그 이벤트를 막는다. 캔버스 밖을 누르거나 키를 치면 더는 막지 않는다.
- 터치·펜은 그대로다. 빈 곳을 끌면 화면 이동이고, 여러 가지를 고르는 길은 없다.
- 서비스 워커 캐시는 `pinit-cache-v42`로 올렸다.

**검증**

- 단위 테스트: `tests/mind-map-tree.test.mjs`, `-editor`, `-clipboard`, `-keymap`
- 화면 확인(mock, Chromium 헤드리스, Linux)
  - `multi-select` 단계(PC): 범위 선택, 빈 범위로 고른 것 줄이기, 묶어 끌기와 되돌리기, `Shift`+누르기, `Esc`, 캔버스 밖으로 늦게 온 `contextmenu` 막기(합성 이벤트), 가지 위 오른쪽 단추 끌기(메뉴 안 열림), 오른쪽 단추 누르기(메뉴 하나)
  - `pan-zoom` 단계(PC): 왼쪽 끌기는 화면을 옮기지 않고 오른쪽 끌기가 옮김
  - 폰 단계는 그대로 통과
- 확인하지 않았다
  - Windows·Mac의 오른쪽 단추. 그 운영체제들은 `contextmenu`가 오는 때가 다르다.
  - Mac 트랙패드의 두 손가락 누르기 끌기
  - Safari·Firefox
  - 로그인한 운영 화면

**두 저장소의 차이**

- 이 변경은 `pinit-ui-design`에 하지 않았다. 그 저장소를 붙이는 권한을 받지 못했다.
- 그래서 아래 "같게 두는 방법"의 비교는 마인드맵 파일과 `public/sw*`에서 차이를 낸다.
- ui-design에 같은 바이트로 옮길 때까지 이 저장소가 원본이다.

## 범위 선택이 한 박자 늦게 고르던 문제 (2026-11-21)

**증상**

- 운영에서 빈 곳을 끌어 범위를 고르면, 골라진 가지가 상자를 한 박자 늦게 따라왔다.
- 넓게 끌었다가 좁게 되돌리면, 상자는 좁은데 넓을 때 걸린 가지가 골라진 채 남았다.

**원인**

- 리뷰 반영 때 넣은 건너뛰기 검사가, 다시 그린 상태(훅의 `latest`)와 비교해 "고른 것이 바뀌는지"를 판정했다.
- 다시 그리기가 포인터를 따라오지 못한 사이에는 그 상태가 지난 것이다. 그래서 마지막 변경을 "바뀐 것 없음"으로 보고 보내지 않았다.

**고친 것**

- 범위 선택·하나씩 고르기는 늘 보낸다.
- `dispatch`가 편집기의 최신 상태 기준으로 바뀌었는지를 돌려준다. 바뀌었을 때만 화면 따라가기 표시를 둔다.
- 서비스 워커 캐시는 `pinit-cache-v43`이다.

**검증**

- 화면 확인 `multi-select` 단계에 넣은 시험: 포인터 이동을 한 작업 안에 몰아 보내 다시 그리기가 끼어들지 못하게 한 뒤, 넓게 끌었다가 주 가지만 덮게 되돌린다. 주 가지 하나만 남아야 한다.
- 고치기 전에는 이 시험이 실패했다. 걸렸던 가지가 남았다.

## 끄는 것이 포인터보다 한 박자 늦게 그려지던 문제 (2026-11-21)

**증상**

- 유지관리자가 운영에서 알렸다. 마우스로 빠르게 끌면 범위 상자가 한 박자 늦게 만들어지고 뚝뚝 끊겨 보였다.
- 화면 이동과 가지를 끄는 유령 상자도 같은 방식으로 늦었다.

**원인**

- React는 포인터 이동(`pointermove`)과 휠에서 바꾼 상태를 그 자리에서 그리지 않고 다음 작업으로 미룬다.
- 브라우저는 포인터 이동을 그 프레임을 그리기 직전에 보낸다. 그래서 미룬 그리기는 늘 다음 프레임에 나온다.
- 그 그리기도 무거웠다. 포인터 이동마다 모든 가지를 다시 그리고 모든 가지의 크기를 다시 쟀다.

**고친 것**

- 포인터 이동과 휠의 화면 변경을 그 이벤트 안에서 바로 그린다(`flushSync`, `useCanvasPointer`).
- 바로 그리는 값이 싸도록 세 가지를 바꿨다.
  - 가지(`MindMapNodeView`)는 받은 값이 같으면 다시 그리지 않는다(`memo`). 캔버스는 가지에 넘기는 함수를 늘 같은 것으로 둔다.
  - 선과 가지 목록(`MindMapWorld`)은 내용이 바뀔 때만 다시 만든다.
  - 가지 크기는 배치·쓰기·글꼴·캔버스 크기가 바뀔 때만 다시 잰다. 선택과 화면 이동·확대는 가지 크기를 바꾸지 않는다.

**이 방식이 치르는 값**

- 그리기가 느려지면 늦게 그려지는 대신 입력이 밀린다(프레임이 빠진다). 그래서 위의 "싸게 그리기"가 함께 있어야 한다.
- 가지에 넘기는 값이 그릴 때마다 새로 만들어지면 `memo`가 조용히 듣지 않는다. 틀린 동작은 아니고 다시 느려진다.
- 선택·화면 위치·테마가 가지 크기를 바꾸는 CSS(예: 고른 가지의 굵은 글씨)를 더하면, 다시 재지 않아 배치가 어긋난다. 그런 CSS를 더할 때는 `MindMapCanvas`의 재는 조건(`measuredFor`)에 그 값을 넣어야 한다.

**잰 값** (헤드리스 Chromium, mock, 끄는 동안 그리기 직전에 포인터와 화면을 견줌)

| 조건 | 고치기 전 | 고친 뒤 |
|---|---|---|
| 포인터가 움직인 프레임 가운데 늦게 그려진 것 | 범위 상자 89/90, 화면 이동 90/91 | 0 |
| 개발 서버, 가지 426개, CPU 4배 느리게, 화면 이동 프레임 간격 | 보통 100~200ms, 최대 450ms | 보통 17ms, 최대 50ms |
| 같은 조건, 화면 이동 60번 동안 가지 크기 읽기 | 약 20,000번 | 0 |
| 운영 빌드, 가지 426개, CPU 4배 느리게 | 화면 이동 때 가끔 50~117ms | 17ms(범위 선택 최대 33ms) |

**검증**

- 화면 확인의 `drag-latency` 단계(PC)를 더했다. 범위 상자·화면 이동·유령 상자가 포인터와 같은 프레임에 그려지는지, 고른 가지가 상자와 맞는지 프레임마다 본다.
- 이 단계는 고치기 전에 실패했다(40번 움직임 모두 늦음).
- 실제 기기(GPU가 있는 브라우저)에서는 재지 않았다.

## 두 저장소를 같게 두는 방법

화면 코드는 `pinit-ui-design`에서 고치고 이 저장소로 같은 바이트로 옮긴다. 같음 확인(두 저장소를 나란히 두고):

```sh
UI=../pinit-ui-design; FE=.
# 마인드맵 파일마다
(cd $UI && git ls-files src/features/mind-map src/mocks/mindMap.ts 'tests/mind-map-*' tests/fixtures qa/mind-map | grep -v screenshots) |
  while read f; do cmp -s "$UI/$f" "$FE/$f" || echo "DIFF $f"; done
diff -rq $UI/src $FE/src; diff -rq $UI/public $FE/public; diff -rq $UI/tests/support $FE/tests/support
cmp ../pinit-monolith/modules/task/src/test/resources/mind-map/text-normalization-cases.json $FE/tests/fixtures/mind-map-text-cases.json
```

모두 출력이 없어야 한다. 2026-11-20 이 저장소의 `qa`를 마친 뒤 ui-design `677f731`과 비교해 출력이 없었다.

## 검증한 것과 하지 않은 것

**검증한 것은 mock API 위에서다.** 운영 서버나 BE 배포 상태에 대한 확인이 아니다.

- `node --test --test-concurrency=1`, `npm run lint`, `npm run build`.
- `node qa/mind-map/local.mjs`를 이 저장소의 dev 서버(mock 켜짐)에 돌렸다. PC 1280×860과 폰 390×800 두 뷰포트에서 모든 단계가 끝까지 갔고 기대하지 않은 console error와 가로 넘침이 없었다. 기대한 오류 기록은 일부러 실패시킨 저장·읽기와 mock의 없는 진행 중 일정 404뿐이다.
- ui-design에 남은 같은 이름의 캡처(데스크톱 42장)와 견주면 39장이 바이트까지 같고 3장(`desktop-drag-between-held-dark`, `desktop-save-failed-state`, `-dark`)이 다르다. 저장 실패 두 장은 ui-design 캡처가 mock을 BE 문구에 맞추기(`677f731`) 전의 것이라 이유 문구가 `마인드맵을 저장하지 못했어요.`와 `일시적인 문제로 처리하지 못했어요. …`로 갈린다. 드래그 한 장은 다시 찍어 확인하지 않았다(같은 코드이므로 환경의 시점 차이로 본다).

**확인하지 않았다**(유지관리자가 BE 운영 반영 뒤 실제 기기와 브라우저로 확인하길 요청하는 항목이다. 통과로 쓰지 않는다):

- 실제 한글 입력기. 조합 중 `Enter`·`Tab`·`Esc`와 고른 상태에서 바로 한글 치기는 `isComposing`·keyCode 229 키 이벤트로 시험했을 뿐이다.
- 실제 폰의 손가락 끌기와 두 손가락 확대(Chromium에 CDP 터치 이벤트를 보내 시험했을 뿐이다).
- 탭을 닫을 때(`pagehide`)와 창이 숨을 때의 keepalive 저장과 64KB 한도. 저장기 테스트로만 확인했다.
- Firefox와 Safari. Chromium에서만 걸었다.
- 페이지를 떠났다가 저장 응답이 오기 전에 돌아오는 경합. 저장기 테스트(`tests/mind-map-saver.test.mjs`)로만 확인했다.
- MCP 동의 화면의 마인드맵 문구. mock에 OAuth 동의 경로가 없어 화면 확인에서 지나가지 못했고 단위 테스트로만 확인했다.
- 실제 `/v2/mind-map` 서버. 계약은 코드를 읽어 견줬을 뿐 호출하지 않았다.

## 구현 위치

`src/features/mind-map/`(`api/`, `model/`, `hooks/`, `components/`, `pages/MindMapPage.tsx`, `paths.ts`), mock `src/mocks/mindMap.ts`, 테스트 `tests/mind-map-*.test.mjs`, 화면 확인 `qa/mind-map/local.mjs`. 메뉴·홈 카드·설정 줄은 각각 사이드바, 오늘 화면, 설정 화면에 걸려 있다.
