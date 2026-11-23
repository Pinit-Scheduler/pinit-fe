# 핀잇 앱(iOS·Android): 기본 화면은 네이티브, 깊은 화면은 웹뷰

- 작성일: 2026-11-23
- 상태: **구현.** 앱 코드는 `Pinit-Scheduler/pinit-ios`와 `Pinit-Scheduler/pinit-android`에 있고(두 저장소에 같은 코드), 이 저장소에는 웹 쪽 코드만 있다. 처음에는 이 저장소의 `mobile/`에도 앱 사본이 있었으나 2026-11-23에 지웠다. 실제 기기·시뮬레이터에서는 한 번도 실행하지 않았다. 스토어 빌드·배포도 없다. 아래 [확인한 것과 확인하지 못한 것](#확인한-것과-확인하지-못한-것)을 구분해 읽는다.
- 근거: [소셜 로그인 설계 §1](https://github.com/Pinit-Scheduler/pinit-docs/blob/main/docs/projects/social-login-google-apple/README.md)의 결정(크로스플랫폼 네이티브 렌더링, 깊은 화면만 웹뷰, Capacitor 폐기)과 유지관리자 요청(2026-11-23: 제안한 범위대로 시작, 홈 화면 위젯은 구조만 대비).
- 기준 소스: FE `9449108e`, BE `pinit-monolith@f89e0697`(계약 확인용으로 읽기만 함), 문서 `pinit-docs@805dfa7f`.

## 무엇이 어디에 있나

| 위치 | 내용 |
| --- | --- |
| `pinit-ios`·`pinit-android` 저장소 | Expo SDK 58(React Native 0.88) 앱. 두 저장소의 코드가 같다. 아래에서 "앱 저장소"라고 하면 이 둘이다 |
| `src/shared/native/` | 웹이 앱의 WebView 안에서 돌 때의 동작 |
| `tests/native-shell.test.mjs`, 앱 저장소의 `tests/` | 두 쪽의 규칙 테스트 |

두 앱 저장소에 있던 기존 Capacitor 앱은 이 앱으로 바뀌었다. 그 앱의 번들 ID·아이콘·푸시 설정은 가져오지 않았다.

## 화면 나누기

| 앱이 직접 그림 | 웹뷰로 엶 |
| --- | --- |
| 로그인(아이디·비밀번호) | 회원가입, 비밀번호 찾기, 이메일 등록 |
| 아래 탭, 진행 중 일정 컨트롤 바 | 일정·작업의 상세, 추가, 수정 |
| 오늘: 오늘 일정, 오늘 마감 작업, 바로 시작할 수 있는 작업 | 하루 계획, 마감 위험 예보, 작업 맵, 통계, 마인드맵, 스페이스, 쪼개기, 설정 |
| 일정: 주간 날짜 띠와 그날 일정 | 월간 달력, 시간 옮기기, 스페이스별 일정 |
| 작업: 진행 중·완료 목록 | 검색·필터·정렬, 스페이스별 작업 |
| 상태 변경: 일정 시작·일시정지·재개·완료·취소, 작업 완료·완료 취소 | |

앱 화면의 조회는 웹 '오늘'과 같다. **모든 스페이스에서 내게 배정된 것**만 본다(`mine=true`). 스페이스·프로젝트를 골라 보는 목록은 웹뷰의 일정·작업 화면에서 한다.

상태 변경 규칙은 웹과 같다.

- 버튼은 서버의 `allowedActions`로만 켠다. 요청에는 받은 `version`을 `expectedVersion`으로 돌려보낸다.
- 버전이 어긋난 409는 최신 내용을 다시 받아 보여 주고 자동으로 다시 보내지 않는다.
- 실패 문구는 서버 문구를 그대로 쓴다(진행 중인 다른 일정이 있을 때의 409 `STATE_CONFLICT` 포함).

## 로그인과 세션

- `POST /v0/login`의 access token은 응답 본문, refresh token은 쿠키로 온다. 쿠키는 OS의 쿠키 저장소가 들고 `/v0/refresh`에 실린다. 백엔드는 바꾸지 않았다.
- 기기에 저장하는 로그인 정보는 앱 저장소의 `src/session/vault.ts` 한 파일만 읽고 쓴다(iOS 키체인, Android 키스토어).
- 앱용 본문 토큰 API(소셜 로그인 설계 §7.4)는 아직 없다. 생기면 `vault.ts`의 저장 타입에 refresh token을 더하고 `store.ts`의 로그인·갱신·로그아웃 요청만 바꾼다.
- 네이버 로그인은 앱에 없다. 네이버로만 가입한 회원은 지금 앱에 로그인할 수 없다(설계 §7.4의 제약 그대로).

### 홈 화면 위젯 대비(구조만)

위젯은 앱과 다른 프로세스에서 돌고 Swift·Kotlin으로 따로 짠다. 이번에 한 것은 위젯이 로그인 정보를 읽을 자리를 한 곳으로 모은 것뿐이다.

- iOS: `vault.ts`의 저장 옵션에 키체인 공유 그룹(`accessGroup`)을 넣고 위젯 타깃에 같은 그룹을 준다.
- 위젯이 스스로 토큰을 갱신하려면 refresh token이 쿠키가 아니라 저장소에 있어야 한다. 즉 본문 토큰 API(§7.4)가 먼저다.
- 위젯 코드, App Group 설정, 위젯 타깃은 만들지 않았다.

## 앱과 웹 사이의 약속

웹은 User-Agent 끝의 `PinitApp/`으로 앱 안인 것을 안다. 메시지 정의는 앱 저장소의 `src/bridge/protocol.ts`와 `src/shared/native/nativeShellRules.ts`에 한 벌씩 있다. 한쪽을 바꾸면 다른 쪽도 바꾼다.

| 웹 → 앱 | 언제 | 앱이 하는 일 |
| --- | --- | --- |
| `close` | 첫 화면으로 연 상세·폼을 닫음, 첫 화면에서 상단 뒤로 | WebView 화면을 닫는다 |
| `route` | 웹이 `/`, `/login`, `/app`, `/app/today`로 가려 함 | 오늘이면 오늘 탭으로. 로그인이면 서버에 세션을 확인한 뒤 끝났을 때만 로그아웃 |
| `logout` | 설정에서 로그아웃을 누름 | 서버 로그아웃과 기기 정리 |
| `refresh` | 웹의 access token이 만료됨 | 갱신해서 같은 `id`로 답한다 |

앱 안에서 웹이 달라지는 점:

- 아래 탭을 숨기고 상단 뒤로 버튼을 항상 보여 준다.
- 세션 갱신을 `/v0/refresh` 쿠키 요청 대신 앱에 맡긴다(`setRefreshTransport`). WebView의 쿠키 저장소가 앱과 같다고 기대하지 않는다.
- 서비스 워커를 등록하지 않는다.
- 온보딩 투어를 띄우지 않는다. 투어는 웹 화면을 옮겨 다니는데 그중 오늘 화면은 웹에 없다. 띄우지 않으므로 확인도 보내지 않아, 서버의 `pendingTour`는 남는다.
- `/app/schedules/new?date=YYYY-MM-DD`로 날짜를 받는다(웹에서는 그대로 `location.state`를 쓴다).

앱은 WebView를 열 때 자기 access token을 웹의 `localStorage`에 넣는다. 로그아웃 상태면 지운다. 앞 회원의 토큰이 WebView에 남아 다른 회원 화면이 보이는 일을 막는다. 웹 앱 출처가 아니면 넣지 않는다. 다른 출처의 링크는 WebView에서 열지 않고 기기 브라우저로 넘긴다.

## 실행

아래 명령은 앱 저장소(`pinit-ios` 또는 `pinit-android`)의 루트에서 실행한다.

```bash
npm install
```

백엔드 없이 네이티브 화면만 돌려 볼 때(계정 `demo` / `demo1234`):

```bash
npm run mock-api
```

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:8787 npm run web
```

브라우저 미리보기에는 WebView가 없어 웹뷰 화면은 자리 표시만 나온다. 기기에서는 개발 빌드로 실행한다. 아래 두 명령은 이 작업에서 실행해 보지 못했다(Mac·Android SDK 필요).

```bash
npx expo run:ios
```

```bash
npx expo run:android
```

환경 변수(없으면 운영 값):

| 이름 | 기본값 |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | `https://mono.pinit.go-gradually.me` |
| `EXPO_PUBLIC_WEB_BASE_URL` | `https://pinit.go-gradually.me` |

검사:

```bash
npm run typecheck && npm run lint && npm test
```

## 확인한 것과 확인하지 못한 것

2026-11-23, 리눅스 컨테이너에서 확인했다.

**확인함**

- 앱: 타입 검사, lint, 규칙 테스트 28개 통과. Android·iOS용 JS 번들이 만들어진다(`expo export`).
- 네이티브 화면을 브라우저 미리보기(react-native-web)와 모의 API로 실행: 로그인 실패 문구, 로그인, 오늘·일정·작업·더보기, 일정 시작 거절(409 문구 표시)·일시정지·재개·완료·즉시 완료, 작업 완료, 주 이동, 완료 필터, 로그아웃.
- 웹의 앱 내 동작을 Chromium에서 앱 User-Agent와 가짜 메시지 통로로 실행(웹 mock API): 22개 항목. `/login`·`/app/today` 넘김, 아래 탭 숨김, 뒤로·닫기의 `close`, 웹 안 이동 뒤 뒤로는 웹에 머묾, 토큰 없이 열면 `refresh`를 보내고 앱의 답으로 로그인, 로그아웃을 앱에 넘김, 세션 종료 통지, `?date=`, 앱 밖 브라우저는 그대로.
- 웹: 기존 테스트 전체와 새 테스트, lint, 빌드 통과.

**확인하지 못함**

- iOS·Android 기기나 시뮬레이터에서의 실행 전부. 네이티브 빌드(Xcode·Gradle)도 하지 않았다.
- 실제 WebView에서의 동작: 메시지 통로, 페이지 스크립트 전 토큰 주입 시점, 쿠키 공유(`sharedCookiesEnabled`), 키보드·안전 영역, 가장자리 쓸기, Android 뒤로 버튼.
- 실제 백엔드와의 통신. 응답 모양은 `pinit-monolith` 소스와 웹 코드로 맞췄고, 모의 API는 그 모양을 흉내 낸 것이다.
- 쿠키에 기대는 웹 화면(비밀번호 변경, 소셜 회원의 탈퇴 재인증)이 WebView에서 되는지. iOS에서 쿠키 공유가 안 되면 이 화면들만 실패한다.
- 화면 낭독기, 큰 글자, 가로 화면, 태블릿.

## 하지 않은 것

- 푸시 알림. 웹은 서비스 워커로 받는데 앱에는 없다. FCM·APNs 설정 파일이 필요하다.
- 번들 ID. 앱 저장소 `app.json`의 `me.gogradually.pinit`은 **임시값**이다. 기존 스토어 앱을 잇는다면 그 앱의 ID로 바꿔야 한다.
- 딥링크(초대 링크 `/spaces/join/:token` 등), 오프라인 캐시, 위젯, Google·Apple·네이버 로그인.
- 앱 화면의 스페이스·프로젝트 필터, 일정 드래그, 작업의 일정 배정(상세 웹뷰에서 한다).
- 웹 테마를 수동으로 바꿨을 때의 맞춤. 앱 화면은 기기 설정을 따른다.
- `pinit-docs` 갱신. 구조가 바뀌었으므로 `docs/start-here.md`에 이 문서 행을 더하고 `docs/design/frontend.md`를 고칠 필요가 있다.
