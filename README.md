# Pinit FE

## 개발 서버 실행
```bash
npm install
npm run dev
```

`.env` 파일에 `VITE_API_BASE_URL` 환경변수를 지정하면 로컬 프록시 없이 API 호출을 테스트할 수 있습니다.

## 기능 변경 문서

- [마감 위험 예보: 읽기 전용 화면·API 계약·로컬 검증](docs/deadline-risk.md) — `/app/deadline-risk`, 7일/14일 예보. 운영 배포 상태와 구분합니다.

## Mock API (OpenAPI 기반 요약)
- `.github/openapi-*.json` 스펙을 기반으로 인증(v0), 작업/일정/통계(v1), 알림(v0) 엔드포인트를 프런트 내부에서 가로채는 모크를 추가했습니다.
- 개발 모드에서만 동작하며 `VITE_USE_MOCK_API=true`를 `.env.local` 등에 추가한 뒤 `npm run dev`를 실행하면 활성화됩니다.
- 기본 계정: `demo / demo1234` (토큰은 클라이언트에서 생성된 JWT 모양 문자열), 초기 일정/작업/통계/푸시 구독 플로우가 포함되어 있습니다.
- 실서버를 사용하려면 플래그를 제거하거나 `false`로 두면 됩니다.
