# 마감 위험 예보 FE 계약과 검증

2026-11-09 기능 변경 기록이다. 구현 시작 기준은 `Pinit-Scheduler/pinit-fe@58e4c5816d3c3b80aaa383ae3ef91bf357eb33c5`다. 기존 공통 문서/그래프의 `d27098bfce1c845565176cb357017075d433d3ac` 이후 기본 브랜치 차이는 안내 문서였다. 이 문서는 이 브랜치에서 확인한 코드와 로컬 검증을 기록하며 운영 배포를 뜻하지 않는다.

## 사용자 흐름

- 하루 계획 상단의 **마감 전에 시간이 충분한지 예보 보기** → `/app/deadline-risk`에서 오늘부터 7일 또는 14일을 선택한다. 기존 계획 생성·승인 코드는 바꾸지 않는다.
- 상단에 개인 공간의 작업과 일정만 반영하며 팀·다른 공간의 작업과 일정은 포함하지 않는다고 표시한다. 모든 공간을 합친 가용 시간 예보가 아닌 **개인 공간 시나리오**다.
- 작업별 마감 기준, 필요한 시간, 사용 가능 시간의 **상한**, 부족한 시간과 이유를 읽는다. 선행 작업 링크와 작업 상세, 개인 공간의 하루 계획으로 이어진다. 작업 상세는 현재 예보를 background로 유지하므로 닫으면 예보로 돌아온다. 계획·빈 결과의 작업 목록 이동은 사용자가 버튼을 누를 때 기존 공간 선택 API로 개인 공간을 선택하고 프로젝트 필터를 비운 뒤 이동한다. 개인 공간 snapshot을 아직 읽지 못했으면 이 이동을 막으며 선택된 팀으로 대체하지 않는다.
- 조회 시각·종료 경계·서버 시간대·보정 적용 여부를 표시한다. 현재 기기의 시간대 대신 응답 `zoneId`로 모든 instant를 표시한다. `deadline`은 작업에 저장한 마감 날짜의 다음 자정이라는 **제외 경계**다. 화면에는 이 instant를 예보 시간대로 바꾸어 “마감 기준 … 전”으로 표시한다.
- 예보 자체는 작업·일정·설정을 쓰지 않는다. 보정 설정도 여기서 변경하지 않는다. 선행 작업을 공유하는 항목의 필요 시간은 겹치므로 전체 필요/부족 시간 합계를 만들지 않는다.

## HTTP 계약

`GET /v2/plans/deadline-risk?days=7` (`days`는 7 또는 14, 생략 시 서버 기본 7). 공유 `httpClient` 인증·오류 경로를 사용하며 회원 ID·현재 시각·시간대를 요청으로 지정하지 않는다. 서버의 인증 회원 설정과 조회 시각이 계산 기준이다. JSON 본문은 envelope 없이 다음 형태다.

공간 인자를 추가하지 않는다. BE의 목적·공간 통합에 맞춰 Task·Schedule·선행 메타데이터·시간 보정 표본은 인증 회원의 실제 개인 공간(`spaceId = -회원 ID`)과 `spaceId = null`이면서 생성자가 인증 회원인 기존 호환 행으로 제한한다. 다른 생성자가 만든 행도 내 개인 공간으로 이동했다면 포함하고, 내가 만든 행이라도 팀·다른 공간으로 이동했다면 제외한다. 개인 공간 안의 전체 작업이 대상이며 담당자별 필터를 합성하지 않는다. 팀·다른 공간의 일정 점유도 제외하므로 이 결과를 모든 공간의 통합 실행 가능 시간으로 해석하지 않는다. 범위 밖 선행 작업은 `UNKNOWN`으로 처리하고 그 ID·제목·시각을 응답에 노출하지 않는다. FE에 공간 선택이나 추가 요청 인자는 없다.

```json
{
  "generatedAt": "2026-11-09T00:00:00Z",
  "zoneId": "Asia/Seoul",
  "days": 7,
  "horizonEnd": "2026-11-15T15:00:00Z",
  "calibrationApplied": false,
  "assumptions": ["입력된 예상 시간과 회원 설정을 사용해요."],
  "limitations": ["한 가지 순서로 배치를 검토하며 최적해를 보장하지 않아요."],
  "items": [{
    "taskId": 41,
    "title": "금요일 제출",
    "deadline": "2026-11-13T15:00:00Z",
    "status": "SHORTAGE",
    "requiredMinutes": 300,
    "availableMinutes": 120,
    "shortageMinutes": 180,
    "predecessorTaskIds": [10],
    "reasons": ["생활 시간과 기존 일정으로 시간이 부족해요."],
    "suggestedFinish": null,
    "recurrenceSeriesId": null
  }]
}
```

예시의 날짜·숫자는 화면 계약을 설명하는 fixture다. 서버에서 생성한 실사용 예보나 운영 데이터가 아니다.

| 값 | 의미와 표시 |
| --- | --- |
| `generatedAt` / `horizonEnd` | UTC offset/Z가 있는 instant. 종료는 회원 시간대의 오늘+days 자정(제외)이다. |
| `requiredMinutes` | 해당 작업과 미완료 선행 체인의 남은 시간. 체인 안의 공유 선행 작업은 1회만 센다. 범위 밖/미조회 선행이 있어 `UNKNOWN`이면 확인된 개인 범위의 시간만 포함하며, 미확인 선행의 추가 시간은 빠진다. 화면은 `UNKNOWN` 숫자를 숨긴다. |
| `availableMinutes` | 해당 체인이 마감 전 쓸 수 있는 시간의 상한과 필요 시간 중 작은 값. 생활 시간·고정 일정·일일 목표를 반영하고, 체인의 이미 연결된 예약은 1회 포함한다. 실제 배치 성공 시간이나 아무 때나 쓸 수 있는 시간의 보장은 아니다. |
| `shortageMinutes` | `max(requiredMinutes - availableMinutes, 0)`. `AT_RISK`에서도 0일 수 있다. |
| `predecessorTaskIds` | 미완료 선행 체인 ID. 화면은 응답에 없는 제목을 추정하지 않고 작업 링크를 제공한다. |
| `reasons` / `assumptions` / `limitations` | 서버가 보내는 설명을 React text로 표시한다. HTML로 삽입하지 않는다. |
| `suggestedFinish` | 가정에 맞는 배치를 찾은 `FEASIBLE`에서만 예상 종료로 표시한다. 자동 일정 생성이 아니다. |
| `recurrenceSeriesId` | 생성된 반복 Task 회차 표시. 아직 생성되지 않은 반복 회차를 FE에서 합성하지 않는다. |

| 상태 | 화면 정책 |
| --- | --- |
| `FEASIBLE` | “가정 안에서 배치 가능”. 순서·연속 슬롯을 지키는 배치를 찾았지만 실제 완료를 보장하지 않는다고 설명한다. |
| `SHORTAGE` | “시간 부족”. 상한부터 필요 시간보다 부족하다는 설명과 상세·계획 링크를 제공한다. |
| `AT_RISK` | “배치 확인 필요”. 연속 슬롯·순서·공동 경쟁으로 이번 순서에서 배치를 찾지 못한 것으로, 다른 배치 가능성을 남긴다. 불가능 증명이나 성공 확률로 바꾸지 않는다. |
| `OVERDUE` | “마감 지남”. 기한을 이미 넘긴 미완료 작업으로 마감·남은 작업 검토를 안내한다. |
| `UNKNOWN` | “계산 확인 필요”. 숫자 용량은 숨기고 정보·선행 관계 확인을 안내한다. |

서버의 완료/진행 중 남은 시간, 연결 예약 중복 차감, 선행 체인, 연속 슬롯, 날짜 예외, 일일 목표, 보정·반복·경계 정책은 [BE 원본 계약](https://github.com/Pinit-Scheduler/pinit-monolith/tree/codex/deadline-risk)과 [공통 설계 변경](https://github.com/Pinit-Scheduler/pinit-docs/blob/codex/deadline-risk-docs/docs/design/deadline-risk.md)을 함께 검토한다. 위 브랜치 링크는 검토용이며 최종 근거 커밋은 공통 문서에서 고정한다.

## 갱신·오류·캐시

- 요청에는 `cache: 'no-store'`와 `AbortSignal`을 전달한다. `public/sw.js`도 no-store 요청은 가로채지 않아, 같은 origin API를 사용하더라도 cache-first 예보를 반환하지 않는다. worker cache와 constants import query는 v25→v26으로 함께 올려 활성화 시 이전 캐시를 정리한다. 새 worker 적용 후의 코드 정책이며, 기존 설치본의 업데이트 완료는 별도 배포 검증 범위다.
- 기간·시간대·재조회 revision이 바뀌면 이전 결과를 즉시 숨긴다. 이전 요청을 취소하고 늦은 성공/실패가 새 결과를 덮지 않도록 cleanup에서 배제한다.
- 작업/일정 변경 이벤트와 창 focus, 사용자의 **다시 조회**로 갱신한다. 과거 결과를 오류 fallback으로 계속 보여 주지 않는다. 실패하면 지속 오류와 다시 조회 버튼을 제공한다. 정기 polling이나 background 알림은 없다.
- 조회 후 흐른 시간은 자동으로 재계산되지 않는다. 화면에 기준 시각을 남기고 다시 조회할 때 반영한다고 설명한다.

## 화면 체계와 React 검토

기존 workspace 색상·Pretendard·여백을 사용한다. `#f4f6fa` 배경, `#fff` 표면, `#202a3c` 본문, `#626e80` 보조 글자, `#345ce5` 링크와 기존 다크 모드 토큰을 그대로 따른다. 숫자는 필요/상한/부족의 비교에만 쓰고, 순서 없는 지표 카드나 새 차트 체계는 추가하지 않는다. 제목·설명·기준·작업 행·가정과 한계 순서의 왼쪽 정렬이다.

React 검토에서는 effect 정리와 요청 경합, 기간/시간대 변경 직후 오래된 결과 배제, text 렌더링, 실제 label/select 연결, status/alert, 키보드 focus, 모바일 wrap을 확인했다. 사용자가 여는 가정 details와 기존 테마를 따르며 새 자동 애니메이션은 없다.

## 로컬 검증과 미확인

- `npm ci --ignore-scripts`: 완료. lockfile 변경 없음. 기존 dependency audit은 22개 취약점(1 low/4 moderate/15 high/2 critical)을 보고했다. 이번 기능과 무관한 자동 dependency 변경은 하지 않았다.
- `node --test tests/deadline-risk.test.mjs tests/service-worker-offline.test.mjs`: 26/26 통과.
- `npm test`: 227/227 통과. 실제 component 정적 렌더의 5시간/2시간/3시간, 0분 부족인 `AT_RISK`, `UNKNOWN` 숫자 숨김, 서버 시간대 자정 표시, 선행 링크, 요청 no-store, 기간/시간대·늦은 응답·실패·이벤트·unmount를 검사한다. SW 테스트는 실제 worker를 VM에서 실행한다.
- `npm run lint`: 통과. baseline-browser-mapping 데이터 갱신 안내가 남는다.
- `npm run build`: 통과. 기존 단일 bundle의 500kB 초과 경고가 남는다.
- 개인 공간 범위 문구 보완 후 `node --test tests/deadline-risk.test.mjs`: 9/9 통과, `git diff --check` 통과. 새 정적 렌더 검사는 예보가 아직 로딩 중이어도 개인 공간만 반영하고 팀·다른 공간 작업/일정을 제외한다는 상단 안내가 보이는지 확인한다. 이 문구 보완에서 기존 전체 테스트·lint/build·아래 브라우저 검증은 반복하지 않았다.
- 위 단위/hook/VM 검증은 실제 서버·DB·인증 브라우저 왕복의 성공 증거가 아니다. 브라우저 fixture 검증 결과는 별도 기록하며 운영 배포·실사용 예보 정확도·성공 확률은 검증하지 않았다.

### 브라우저 합성 응답 검증

2026-11-09 로컬 Vite와 headless Chrome에서 다음 흐름을 확인했다. 브라우저 시간대는 `America/Los_Angeles`, 응답 시간대는 `Asia/Seoul`로 달리 설정했다. 모든 API 요청은 로컬 합성 응답으로 가로채고 GET 이외의 요청과 외부 호스트는 차단했다. 운영 데이터·실제 인증 서버·DB는 사용하지 않았다.

- 다섯 상태 표시, 5시간 필요/2시간 상한/3시간 부족, 서울 09:00 기준 시각.
- 가정과 한계 펼치기, 14일 요청·응답, 선행 작업 링크.
- 작업 상세의 제목·설명 로드와 뒤로 가기를 통한 예보 복귀.
- 503 이후 이전 숫자 제거, 재조회로 빈 결과 표시, 다시 정상 결과 표시.
- 390px 화면 가로 넘침 없음, 작업 행의 시간·이유·링크 확인, 계획 화면 이동 및 예보 진입 링크로 복귀.
- React Router가 처리한 렌더 예외와 처리되지 않은 브라우저 예외 0건. 의도한 503 및 개발 모드의 취소 요청 로그는 실패 처리 검증 중 발생한다.

재현 스크립트는 `scripts/deadline-risk-browser-smoke.mjs`다. 별도 터미널에서 `VITE_USE_MOCK_API=false`로 `npm run dev -- --host 127.0.0.1 --port 4187 --strictPort`를 실행한다. Chrome 설치와 선택 검증 의존성 `playwright`가 필요하다. 프로젝트의 제품 의존성을 바꾸지 않으려면 별도 임시 폴더에 `npm install --no-save --ignore-scripts playwright`로 준비하고 `DEADLINE_RISK_PLAYWRIGHT_MODULE`을 해당 `playwright/index.mjs`의 `file:///` URL로 지정한다. 프로젝트에서 import 가능한 기존 Playwright가 있다면 이 변수는 생략한다. `node scripts/deadline-risk-browser-smoke.mjs`를 실행하면 `.cache/deadline-risk-browser/`에 결과 JSON과 화면을 만든다. `DEADLINE_RISK_BASE_URL`과 `DEADLINE_RISK_QA_DIR`로 로컬 주소·출력 위치를 바꿀 수 있다. 스크립트의 합성 응답은 실제 BE 계산이나 배포 환경 E2E를 검증하지 않는다. 실제 SW 실행은 이 스크립트에 포함하지 않고 위 VM 테스트에서 따로 검증한다.

## 최신 공간 UI master 통합 검증 — 2026-11-09

공간 UI가 병합된 `Pinit-Scheduler/pinit-fe@c064de4a2a3a66bd190671e7853810c7d242996c`를 격리 기능 브랜치에 일반 merge했다. 통합 커밋은 `9ff4d357bdff8d20809b8949f0098156d7c8f9bd`, 후속 코드·테스트 근거는 `8dfdc33ed509451bc968917be27ce00e0df374fd`다. 파일 충돌 없이 합쳐졌으며, 기본 브랜치나 운영 배포를 변경한 작업이 아니다. 위 초기 검증 기록을 이 통합 리비전의 결과로 바꾸지 않는다.

- 기존 [하루 계획 API](https://github.com/Pinit-Scheduler/pinit-fe/blob/c064de4a2a3a66bd190671e7853810c7d242996c/src/features/planner/api/plans.ts#L22)는 현재 선택 공간·프로젝트를 읽는다. 예보의 일반 `/app/plan` 링크는 팀 선택을 그대로 이어갈 수 있어 [명시적 개인 공간 이동](https://github.com/Pinit-Scheduler/pinit-fe/blob/8dfdc33ed509451bc968917be27ce00e0df374fd/src/features/deadline-risk/pages/DeadlineRiskPage.tsx#L15) 버튼으로 바꿨다. 서버 snapshot에 실제 개인 공간이 있을 때만 [기존 `selectSpace`](https://github.com/Pinit-Scheduler/pinit-fe/blob/c064de4a2a3a66bd190671e7853810c7d242996c/src/features/spaces/store.ts#L60)를 호출한다. 이는 계정별 세션의 보기 설정이며 작업·일정 저장이 아니다. 예보를 읽는 것만으로 팀 선택을 바꾸지 않는다.
- [작업 상세 GET](https://github.com/Pinit-Scheduler/pinit-fe/blob/c064de4a2a3a66bd190671e7853810c7d242996c/src/features/tasks/api/tasks.ts#L188)은 선택된 팀 query 없이 `/v2/workspace/tasks/{id}`의 실제 ID·권한·버전 wrapper를 읽는다. 예보의 작업/선행 링크는 이 경로와 background 복귀를 유지한다. 최신 캐시는 새 metadata의 접근 제거·버전 정책을 사용한다. 상세 조회 자체가 과거 예보 시점의 소속을 고정하는 것은 아니다.
- 상위 [공간 context](https://github.com/Pinit-Scheduler/pinit-fe/blob/8dfdc33ed509451bc968917be27ce00e0df374fd/src/features/spaces/SpaceChrome.tsx#L144)도 이 화면에서는 “개인 공간 · 마감 위험 예보”로 표시하고, 선택된 팀의 목적/프로젝트 설명을 예보 범위처럼 표시하지 않는다. 공간 전환기는 유지한다.
- 새 `WorkspaceRealtime`의 `workspaceChanged`는 기존 `task:changed`/`schedule:changed`를 보내므로 [예보 훅](https://github.com/Pinit-Scheduler/pinit-fe/blob/8dfdc33ed509451bc968917be27ce00e0df374fd/src/features/deadline-risk/hooks/useDeadlineRisk.ts#L19)의 무효화·재조회와 연결된다. 공간 선택·프로젝트 선택 이벤트도 같은 경로를 쓴다. 예보 API에는 공간/프로젝트 인자를 추가하지 않았다.

검증 결과:

- `node --test --test-concurrency=1` (Node heap 256MB): 통합 및 개인 이동 보완 후 266/266 통과. 이후 개인 공간 미조회 guard와 context 표시 회귀를 추가하고 `node --test tests/deadline-risk.test.mjs`로 최종 12/12 통과했다. 최종 추가 검사 뒤 전체 검사를 반복한 결과로 268개 통과를 주장하지 않는다.
- `npm run lint`: 통과. 최종 브라우저 스크립트 보완 뒤 해당 파일의 ESLint도 통과. 기존 baseline-browser-mapping 데이터 나이 안내는 남는다.
- `npm run build`: TypeScript·Vite 통과, 350개 모듈. JS 731.50kB(압축 226.10kB), CSS 177.94kB(압축 29.10kB). 500kB 청크 안내를 숨기지 않았다.
- 최신 `scripts/deadline-risk-browser-smoke.mjs`로 localhost Vite `4189`/headless Chrome 합성 응답 검증: 9개 흐름 검사, 가로챈 GET 37개, React 처리/uncaught 예외 0. 팀 공간 선택을 유지한 개인 예보, 실제 workspace Task wrapper 상세와 뒤로 가기, 로컬 SSE `changed` frame에 따른 예보 title 재조회, 사용자 클릭 후 개인 `spaceId=-7`·프로젝트 인자 없는 계획 요청을 확인했다. 다섯 상태·오류/빈 결과·14일·서버 시간대·390px 가로 넘침 없음도 유지했다. SSE 요청 시작 대기는 10초로 제한한다.
- `.cache/deadline-risk-browser-workspace/result.json`과 화면은 로컬 산출물이며 브라우저 증거 폴더 prefix를 ignore했다. `git diff --check` 통과, `.cache` tracked 파일 0개. 로컬 합성 응답은 실제 BE의 SSE 발생, DB 계산, 운영 인증·배포 또는 설치된 SW 업데이트 완료를 검증하지 않는다.

구현 진입점은 `src/features/deadline-risk/`이다. 기존 route·제목·PlanPage 진입 링크·SW no-store 정책에 더해 최신 공간 UI의 context 표시를 이 개인 예보 범위에 맞췄다. graph snapshot은 기존 기준을 유지하며 이 신규 API·페이지와 최신 공간 UI 관계를 포함하지 않는다.
