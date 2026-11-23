# Pinit 앱 (iOS · Android)

Expo(React Native) 앱이다. 로그인, 오늘, 일정, 작업과 상태 변경은 앱이 직접 그리고, 그보다 깊은 화면은 웹 앱을 WebView로 연다.

범위, 앱과 웹 사이의 약속, 실행 방법, 확인한 것과 확인하지 못한 것은 [docs/native-app.md](../docs/native-app.md)에 있다.

```bash
npm install
npm run mock-api          # 모의 API (demo / demo1234)
EXPO_PUBLIC_API_BASE_URL=http://localhost:8787 npm run web
npm run typecheck && npm run lint && npm test
```

| 폴더 | 내용 |
| --- | --- |
| `src/app` | 화면(expo-router). `(tabs)`는 아래 탭, `webview`는 웹 화면 |
| `src/session` | 로그인 상태와 기기 저장소. 토큰은 `vault.ts`만 읽고 쓴다 |
| `src/api` | 서버 요청과 응답 타입 |
| `src/bridge` | WebView 안의 웹과 주고받는 메시지 |
| `src/data` | 조회, 최신 일정·작업, 상태 변경 |
| `src/ui` | 화면 조각과 색 |
| `tests` | 의존성 없는 규칙의 테스트 |
