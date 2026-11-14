# 로그인 세션 갱신: 끝난 세션과 일시적 실패 구분

2026-11-14 기능 변경 기록이다. 구현 시작 기준은 `Pinit-Scheduler/pinit-fe@aa64333`(origin/master)다. 이 문서는 이 브랜치에서 확인한 코드와 로컬 검증을 기록하며 운영 배포를 뜻하지 않는다. 같은 증상의 BE 원인(refresh 쿠키의 `Max-Age` 누락, 같은 이름의 예전 쿠키가 먼저 읽히는 문제)은 pinit-monolith에서 따로 고친다.

## 토큰과 갱신

- 액세스 토큰은 `localStorage`의 `pinit.accessToken`, 리프레시 토큰은 httpOnly 쿠키 `refresh_token`이다. FE는 쿠키를 읽지 않고 `POST /v0/refresh`(`credentials: 'include'`)로 새 액세스 토큰을 받는다.
- 모든 갱신은 `src/shared/api/authSession.ts`의 `refreshSession()` 하나로 합류한다. 진행 중인 갱신이 있으면 같은 요청을 기다리고, 로그아웃 표시나 대기 중 다른 탭·로그인이 바꾼 토큰을 확인한다.

## 갱신 결과

`refreshSession()`은 이유를 담은 결과를 돌려준다.

| 결과 | 조건 | 저장된 토큰 |
| --- | --- | --- |
| `refreshed` | 토큰이 있는 성공 응답, 또는 대기 중 다른 곳에서 유효한 토큰이 저장됨 | 새 토큰 |
| `unauthorized` | `/refresh`가 401 또는 403으로 응답, 이 기기에서 로그아웃함, 대기 중 토큰이 지워짐 | 호출한 쪽이 지운다 |
| `transient` | 응답 없음(네트워크 오류·제한 시간 초과, `status: 0`), 5xx·429·그 밖의 실패 상태, 토큰 없는 성공 응답 | 그대로 둔다 |

`unauthorized`만 같은 토큰 기준으로 1초 동안 기억한다. `transient`는 기억하지 않으므로 일시적 실패가 로그아웃으로 바뀌지 않고, 다음 호출이 바로 다시 묻는다.

갱신 요청은 15초(`REFRESH_TIMEOUT_MS`) 안에 답이 없으면 `AbortController`로 끊고 `transient`(`status: 0`)로 돌려준다. 멈춘 연결이 부트 화면과 재시도를 붙잡지 않게 하기 위해서다. pinit-monolith `origin/main`(`2cc1f55a`)의 `MemberControllerV0.refresh`는 새 액세스 토큰(`LoginResponse`)만 돌려주고 `Set-Cookie`를 보내지 않으므로(쿠키는 로그인·소셜 로그인 등 다른 엔드포인트가 설정하고 로그아웃이 만료시킨다) 끊어도 잃는 쿠키가 없다.

`refreshAccessTokenFromCookie()`는 토큰 형태의 래퍼다. `refreshed`면 토큰, `unauthorized`면 `null`을 돌려주고 `transient`면 `RefreshUnavailableError`로 거절한다.

## 호출하는 곳

- **httpClient**: 만료 토큰의 사전 갱신과 401 뒤 갱신 모두, `transient`면 토큰을 지우지 않고 `status: 0`의 `ApiError`(네트워크 오류와 같은 형태)를 던진다. `unauthorized`면 기존처럼 토큰이 그대로일 때만 지우고 401을 던진다. 문구는 기존 규칙(오류 문구는 백엔드가 정하고, FE 고정 문구는 응답이 없을 때만 쓴다)을 따른다.
  - 갱신 요청에 응답이 없었으면(`status: 0`) 화면은 "인터넷 연결을 확인한 뒤 다시 시도해 주세요"를 쓴다.
  - 서버가 갱신 요청에 실패로 답했으면(5xx·429 등) `ApiError.responseStatus`에 그 상태를 담고, 메시지는 그 응답의 서버 문구(`getApiErrorMessage`, 없으면 빈 문자열)다. `readFailureMessage`·`getRequestFailureMessage`는 이를 서버 응답으로 보고 서버 문구를 그대로, 문구가 없으면 "잠시 후 다시 시도해 주세요"를 쓴다. `status`는 0이라 401·404 같은 상태별 처리에 닿지 않는다.
- **AuthGuard**: `src/features/auth/utils/sessionRestore.ts`의 `startSessionRestore()`로 갱신한다. `unauthorized`만 토큰을 지우고 `/login`으로 보낸다. `transient`면 부트 화면(`AuthBoot`)에 머물며 1초·2초·4초… 최대 30초 간격으로 다시 시도하고, `online`, 페이지가 다시 보일 때(`visibilitychange`), 창 `focus`에는 바로 다시 시도한다. 두 번째 실패부터 "로그인 상태를 확인하지 못해 다시 연결하고 있어요." 문구와 **다시 시도** 버튼을 보여 준다. 실패 응답 본문에 서버 문구가 있으면(`status >= 400`, `getApiErrorMessage`) 그 문구를 대신 보여 준다. 계정 조회(`fetchAccount`)의 401 처리에는 갱신 실패가 `status: 0`으로 오므로 닿지 않는다.
- **AppShell**: 마운트할 때 토큰이 없으면 같은 재시도를 화면 표시 없이 진행한다. `unauthorized`만 로그인으로 보낸다.
- **LandingPage(`/`, manifest `start_url`)**: 저장된 토큰이 없고 로그아웃 표시가 없으면 소개 화면을 바로 그리면서 한 번 갱신을 묻는다. `refreshed`일 때만 `/app/schedules`로 `replace` 이동한다. 그 밖에는 소개 화면에 머문다. 공유 갱신은 소개 화면을 떠난 뒤에도 토큰을 저장하므로, 답이 오기 전에 로그인·회원가입 화면으로 옮겨 갔다면 그 화면에서도 `/app/schedules`로 보낸다. 다른 화면으로 옮겨 갔으면 이동하지 않는다. 토큰 저장으로 계정 키가 바뀌어 화면 트리가 다시 마운트되므로, 그 사이 로그인·회원가입 양식에 입력하던 값은 남지 않는다.
- **실시간 스트림(`realtime.ts`)**: `null`(끝난 세션)이면 연결을 멈추고, `RefreshUnavailableError`면 기존 backoff(1초부터 최대 30초)로 다시 연결한다. 토큰은 지우지 않는다.

서비스 워커 캐시는 `pinit-cache-v33`으로 올렸다.

## 모크 API

`VITE_USE_MOCK_API=true`에서 로그인·소셜 로그인은 모크 refresh 쿠키(`localStorage`의 `pinit.mock.refreshCookie`)를 남기고 로그아웃은 지운다. 쿠키가 없으면 `/v0/refresh`는 401이다. 개발자 도구에서 `__pinitMock.setRefreshFailure('network')`(응답 없음) 또는 `'unavailable'`(502 페이지)로 갱신 실패를 재현하고 `null`로 되돌린다. 이 값은 새로고침해도 남는다.

## 검증

- `npm test`: `tests/auth-category-refresh.test.mjs`(401/403·네트워크·5xx·429·토큰 없는 성공의 분류, 실패 캐시, 동시 호출, 제한 시간 초과), `tests/http-client-errors.test.mjs`(일시적 실패에 토큰 유지·`status: 0`, 갱신 응답의 서버 문구, 끝난 세션에 토큰 삭제), `tests/auth-session-restore.test.mjs`(backoff·즉시 재시도, AuthGuard의 머무름/로그인 이동, 계정 조회 401 경계, 랜딩 이동, 랜딩을 떠난 뒤의 이동), `tests/workspace-spaces.test.mjs`(실시간 재연결), `tests/motion-auth.test.mjs`(부트 화면 문구).
- `npm run lint`, `npm run build`(`tsc -b` 포함).
- 실제 브라우저·PWA에서의 동작과 운영 서버 응답은 이 브랜치에서 확인하지 않았다.
