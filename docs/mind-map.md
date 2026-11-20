# 마인드맵

## 계약 대조

2026-11-20, pinit-monolith 브랜치 `claude/dreamy-gauss-ln9kc1`, 커밋 `f7dfcbd`(`docs(mind-map): Y2 기록의 열린 항목을 최종 리뷰 반영에 맞춘다`, Y1·Y2 구현과 최종 리뷰 반영 포함)의 서버 코드를 읽어 `/v2/mind-map…`의 경로, 본문, 오류 모양, 문구를 mock(`src/mocks/mindMap.ts`)과 화면의 API 모듈(`src/features/mind-map/api/mindMapApi.ts`)에 줄마다 견줬다. 대조는 코드와 서버 시험(`MindMapControllerV2IntegrationTest`)을 읽어서 했고 실제 서버에 연결해 부르지는 않았다. 다른 것은 ui-design `claude/dreamy-gauss-ln9kc1`의 `677f731`(`fix(mind-map): mock을 BE 계약에 맞춘다`)에서 고쳐 이 저장소로 같은 바이트로 옮겼다. 아직 구현되지 않아 대조하지 못한 항목은 없다.

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
