# 작업 쪼개기 브라우저 확인

모든 데이터는 mock이고 실제 서버를 부르지 않는다. 스크립트가 `VITE_USE_MOCK_API=true`로 Vite 개발 서버를 `127.0.0.1:5197`에 띄우고, 개발 서버 안의 mock(`src/mocks/taskSplit.ts`, `taskSplitProposal.ts`, `notices.ts`)이 모든 `/v2/…` 요청에 답한다. 계정은 mock의 `demo` / `demo1234`다.

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix qa/browser
node qa/task-split/local.mjs
```

Playwright는 [qa/plan-integration](../plan-integration/README.md)과 같이 `qa/browser/package.json`에 고정한 의존성(`@playwright/test` 1.65.0)에서 먼저 찾는다. 그것이 설치돼 있지 않으면 이 환경이 이미 갖춘 `playwright` 모듈을 쓴다. Playwright와 그 버전에 맞는 Chromium을 이미 갖춘 환경이면 `qa/browser` 설치 없이도 돈다(지금 캡처는 이 길로 찍었다. `qa/browser` 설치와 `playwright install`은 하지 않았다). 브라우저는 `chromium.launch()`를 옵션 없이 부르므로 그 Playwright 버전의 Chromium이 있어야 한다(없으면 그 Playwright의 `playwright install chromium`으로 받는다. 설치된 Chrome을 쓰는 qa/plan-integration과 다른 점이다). 5197 포트가 비어 있어야 한다.

모바일(390×844, 손가락 입력)과 데스크톱(1280×800)마다 로그인하고 자동 준비를 끈 뒤(`__pinitMock.split.setAutoFinish(null)`) 화면의 링크와 버튼으로만 움직인다. 로그인 뒤에는 `page.goto`를 쓰지 않는다. 새로 읽으면 mock 상태가 처음으로 돌아가기 때문이다. 두 배율(`deviceScaleFactor: 2`)로 찍는다.

- 36단계마다 보여야 할 문구를 확인하고 `screenshots/{mobile|desktop}-{두 자리 번호}-{이름}.png`로 캡처한다. 01~12는 A단계, 13~36은 B단계다. 단계와 확인하는 것은 [docs/task-split.md](../../docs/task-split.md#화면으로-확인받을-것)에 있다.
- 15·17·19·29번은 어두운 테마로도 찍는다(`…-dark.png`, html의 `data-theme="dark"`).
- 덧붙인 캡처: `{viewport}-22-via-excluded-cycle.png`(순환이 생기는 후보), `desktop-17-piece-read-768.png`(600~899px에서 가운데 카드로 올라오는 조각 창).
- 단계마다 두 뷰포트 모두 페이지가 가로로 넘치지 않는지(`scrollWidth <= 뷰포트 너비`) 본다. 지도 상자 안의 스크롤은 페이지 너비에 들지 않는다.
- console error나 pageerror가 하나라도 있으면 실패로 끝난다. 예외는 `failNextApply`로 일부러 거부시킨 만들기 세 번(UNEXPECTED·ADMIN_ONLY·EXPIRED)의 응답을 앱의 HTTP 도우미가 남기는 `API Error` 기록이다. 그 창 안의 만들기 경로 기록만 `expected`로 따로 세고, 뷰포트마다 정확히 여섯 줄이어야 한다.
- 끝에 `note …` 줄로 리뷰가 브라우저에서 봐 달라고 한 측정값(종과 패널의 위치·색, 조각 창의 층과 초점, 늦게 생긴 알림의 종 숫자 변화 등)을 찍는다. `note … DEFECT`는 알려진 결함이다(보고서에 경로가 있다).

선택 환경 변수: `QA_VIEWPORT=mobile|desktop`(한 뷰포트만), `QA_VERBOSE=1`(측정값을 단계마다 찍는다), `QA_FAILED_DIR`(실패한 단계의 화면을 남길 폴더. 없으면 운영체제 임시 폴더).

실제 서버·인증·실시간 스트림·푸시·서비스 워커는 이 확인의 범위가 아니다.
