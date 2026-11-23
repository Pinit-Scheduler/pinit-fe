# Pinit FE

## 개발 서버 실행
```bash
npm install
npm run dev
```

`.env` 파일에 `VITE_API_BASE_URL` 환경변수를 지정하면 로컬 프록시 없이 API 호출을 테스트할 수 있습니다.

## 기능 변경 문서

- [마감 위험 예보: 읽기 전용 화면·API 계약·로컬 검증](docs/deadline-risk.md) — `/app/deadline-risk`, 7일/14일 예보. 운영 배포 상태와 구분합니다.
- [로그인 세션 갱신: 끝난 세션과 일시적 실패 구분](docs/auth-session-refresh.md) — `/v0/refresh`의 401/403만 로그아웃, 그 밖의 실패는 토큰을 두고 재시도. 운영 배포 상태와 구분합니다.
- [작업 쪼개기: 맡기기·잠긴 원본·보관함(A단계)](docs/task-split.md) — `/v2/task-splits…`, 동의·확인 창·접수, 보관함에서 취소·버리기. mock에서 확인했고 운영 배포 상태와 구분합니다.
- [마인드맵: 페이지·홈 카드·저장과 충돌](docs/mind-map.md) — `/app/mind-map`, 계정당 한 장. mock에서 확인했고 운영 배포 상태와 구분합니다.
- [핀잇 앱(iOS·Android): 기본 화면은 네이티브, 깊은 화면은 웹뷰](docs/native-app.md) — `mobile/`의 Expo 앱과 웹의 앱 내 동작(`src/shared/native/`). 기기에서는 실행해 보지 않았고 스토어 배포도 없습니다.

## Mock API (OpenAPI 기반 요약)
- `.github/openapi-*.json` 스펙을 기반으로 인증(v0), 작업/일정/통계(v1), 알림(v0) 엔드포인트를 프런트 내부에서 가로채는 모크를 추가했습니다.
- 개발 모드에서만 동작하며 `VITE_USE_MOCK_API=true`를 `.env.local` 등에 추가한 뒤 `npm run dev`를 실행하면 활성화됩니다.
- 기본 계정: `demo / demo1234` (토큰은 클라이언트에서 생성된 JWT 모양 문자열), 초기 일정/작업/통계/푸시 구독 플로우가 포함되어 있습니다.
- 이메일 인증 코드는 메일 대신 브라우저 콘솔(`[mock] … 인증 코드`)에 남습니다. `demo`는 이메일(`demo@example.com`)이 등록돼 있고, `pinit / pinit`은 없어 로그인하면 이메일 등록 화면으로 갑니다. 모크 상태는 새로고침하면 처음으로 돌아갑니다.
- 로그인하면 모크 refresh 쿠키가 남고 로그아웃하면 지워집니다. `__pinitMock.setRefreshFailure('network' | 'unavailable')`로 세션 갱신 실패를 재현하고 `null`로 되돌립니다([세션 갱신](docs/auth-session-refresh.md#모크-api)).
- 작업 쪼개기(`/v2/task-splits…`)는 요청 상태마다 fixture 작업을 깔아 둡니다. `__pinitMock.split`(`fixtures`, `requests`, `finish`, `settings`, `setAutoFinish`)으로 요청을 끝내고 스위치·동의·횟수를 바꿉니다([작업 쪼개기](docs/task-split.md#mock)).
- 쪼개기 제안 만들기의 거부는 `__pinitMock.split.failNextApply('EXPIRED' | 'ADMIN_ONLY' | 'UNEXPECTED')`로 다음 한 번을 재현합니다. 알림함(`/v2/notifications/notices…`)은 준비·실패 알림을 깔아 두고, 요청이 끝나면 1.5초 뒤 새 알림을 만듭니다([작업 쪼개기](docs/task-split.md#mock)).
- 마인드맵(`/v2/mind-map…`)은 demo 계정에 예시 맵을 깔아 둡니다. `__pinitMock.mindMap`(`failNextSave`, `failNextLoad`, `remoteEdit`, `withdraw`)으로 저장 실패·응답 잃음·다른 기기의 변경·탈퇴한 회원의 처음 저장을 재현합니다([마인드맵](docs/mind-map.md#mock-사용법)).
- 실서버를 사용하려면 플래그를 제거하거나 `false`로 두면 됩니다.

## 기능 변경 문서

- [오늘 남은 일정 다시 짜기](docs/day-replanning.md): 기존 일정의 변경 전후 미리보기와 선택 적용, 보호·실패·캐시 갱신 정책.
