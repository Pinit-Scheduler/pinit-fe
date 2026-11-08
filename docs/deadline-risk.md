# 마감 위험 예보 FE 계약과 검증

2026-11-09 기능 변경 기록이다. 구현 시작 기준은 `Pinit-Scheduler/pinit-fe@58e4c5816d3c3b80aaa383ae3ef91bf357eb33c5`다. 기존 공통 문서/그래프의 `d27098bfce1c845565176cb357017075d433d3ac` 이후 기본 브랜치 차이는 안내 문서였다. 이 문서는 이 브랜치에서 확인한 코드와 로컬 검증을 기록하며 운영 배포를 뜻하지 않는다.

## 사용자 흐름

- 하루 계획 상단의 **마감 전에 시간이 충분한지 예보 보기** → `/app/deadline-risk`에서 오늘부터 7일 또는 14일을 선택한다. 기존 계획 생성·승인 코드는 바꾸지 않는다.
- 작업별 마감 기준, 필요한 시간, 사용 가능 시간의 **상한**, 부족한 시간과 이유를 읽는다. 선행 작업 링크와 작업 상세, 하루 계획 링크로 이어진다. 작업 상세는 현재 예보를 background로 유지하므로 닫으면 예보로 돌아온다.
- 조회 시각·종료 경계·서버 시간대·보정 적용 여부를 표시한다. 현재 기기의 시간대 대신 응답 `zoneId`로 모든 instant를 표시한다. `deadline`은 작업에 저장한 마감 날짜의 다음 자정이라는 **제외 경계**다. 화면에는 이 instant를 예보 시간대로 바꾸어 “마감 기준 … 전”으로 표시한다.
- 예보 자체는 작업·일정·설정을 쓰지 않는다. 보정 설정도 여기서 변경하지 않는다. 선행 작업을 공유하는 항목의 필요 시간은 겹치므로 전체 필요/부족 시간 합계를 만들지 않는다.

## HTTP 계약

`GET /v2/plans/deadline-risk?days=7` (`days`는 7 또는 14, 생략 시 서버 기본 7). 공유 `httpClient` 인증·오류 경로를 사용하며 회원 ID·현재 시각·시간대를 요청으로 지정하지 않는다. 서버의 인증 회원 설정과 조회 시각이 계산 기준이다. JSON 본문은 envelope 없이 다음 형태다.

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
| `requiredMinutes` | 해당 작업과 미완료 선행 체인의 남은 시간. 체인 안의 공유 선행 작업은 1회만 센다. |
| `availableMinutes` | 해당 체인이 마감 전 쓸 수 있는 시간의 상한. 생활 시간·고정 일정·일일 목표를 반영하고, 체인의 이미 연결된 예약은 1회 포함한다. 실제 배치 성공 시간이나 아무 때나 쓸 수 있는 시간의 보장은 아니다. |
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
- 위 단위/hook/VM 검증은 실제 서버·DB·인증 브라우저 왕복의 성공 증거가 아니다. 브라우저 fixture 검증 결과는 별도 기록하며 운영 배포·실사용 예보 정확도·성공 확률은 검증하지 않았다.

구현 진입점은 `src/features/deadline-risk/`이고 기존 파일은 route 1개, 제목 1개, PlanPage 진입 링크 1개 및 SW no-store 정책만 추가했다. graph snapshot은 기존 기준을 유지하며 이 신규 API와 페이지를 포함하지 않는다.
