# 작업 쪼개기 브라우저 확인

모든 데이터는 mock이고 실제 서버를 부르지 않는다. 스크립트가 `VITE_USE_MOCK_API=true`로 Vite 개발 서버를 `127.0.0.1:5197`에 띄우고, 개발 서버 안의 mock(`src/mocks/taskSplit.ts`)이 모든 `/v2/…` 요청에 답한다. 계정은 mock의 `demo` / `demo1234`다.

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix qa/browser
node qa/task-split/local.mjs
```

Playwright는 [qa/plan-integration](../plan-integration/README.md)과 같이 `qa/browser/package.json`에 고정한 의존성(`@playwright/test` 1.65.0)에서 먼저 찾는다. 그것이 설치돼 있지 않으면 이 환경이 이미 갖춘 `playwright` 모듈을 쓴다. Playwright와 그 버전에 맞는 Chromium을 이미 갖춘 환경이면 `qa/browser` 설치 없이도 돈다. 브라우저는 `chromium.launch()`를 옵션 없이 부르므로 그 Playwright 버전의 Chromium이 있어야 한다(없으면 그 Playwright의 `playwright install chromium`으로 받는다. 설치된 Chrome을 쓰는 qa/plan-integration과 다른 점이다). 5197 포트가 비어 있어야 한다.

모바일(390×844)과 데스크톱(1280×800)마다 로그인하고 자동 준비를 끈 뒤(`__pinitMock.split.setAutoFinish(null)`) 화면의 링크와 버튼으로만 움직인다. 새로 읽으면 mock 상태가 처음으로 돌아가기 때문이다. 단계마다 보여야 할 문구를 확인하고 `screenshots/{mobile|desktop}-{두 자리 번호}-{이름}.png`로 캡처한다. 모바일에서는 가로로 넘치지 않는지도 본다. console error나 pageerror가 하나라도 있으면 실패로 끝난다.

단계와 확인하는 문구는 [docs/task-split.md](../../docs/task-split.md#화면으로-확인받을-것)에 있다. B단계는 이 파일의 `step(page, viewport, name, run)` 도우미로 뒤 흐름을 잇는다.

실제 서버·인증·실시간 스트림·푸시는 이 확인의 범위가 아니다.
