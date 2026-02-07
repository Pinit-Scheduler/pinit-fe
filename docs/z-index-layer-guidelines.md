# z-index 레이어 가이드

## 목적
- 레이어 충돌(모달 오버레이가 네비게이션/플로팅 UI를 덮지 못하는 문제)을 방지한다.
- 컴포넌트별 매직 넘버 사용을 줄이고 전역 기준을 유지한다.

## 전역 변수 기준
- 위치: `src/index.css`
- 값:
  - `--z-topbar`: 상단 바
  - `--z-mini-player`: 미니 플레이어
  - `--z-bottom-tab`: 하단 탭 바
  - `--z-bottom-tab-fab`: 하단 탭 플로팅 추가 버튼
  - `--z-modal-backdrop`: 모든 기본 모달 백드롭
  - `--z-toast`: 토스트

## 사용 규칙
- 새로운 고정 레이어/모달을 추가할 때 하드코딩 숫자 대신 `var(--z-...)`만 사용한다.
- 기본 모달은 `--z-modal-backdrop`을 사용한다.
- 중첩 모달이 필요한 경우에만 `calc(var(--z-modal-backdrop) + 1)`처럼 최소 증분을 사용한다.

## 기본 우선순위
- `topbar < mini-player < bottom-tab < modal-backdrop < toast`
