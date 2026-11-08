# Pinit FE 작업 안내

## 공통 문서 탐색

- 작업 시작 시 [pinit-docs의 AI 개발 작업 시작점](https://github.com/Pinit-Scheduler/pinit-docs/blob/main/docs/start-here.md)을 실제로 읽고, 작업에 관련된 원본 문서만 추가로 조회한다. 다른 저장소의 문서는 링크만으로 자동 로드되지 않는다.
- 원격으로는 접근 권한이 있는 GitHub 연결에서 `Pinit-Scheduler/pinit-docs`, `docs/start-here.md`, `main`을 지정해 읽는다. 현재 사용하는 메인 계정은 `GoGradually`이며 공통 문서 저장소는 비공개다.
- 같은 상위 폴더에 체크아웃했다면 `../pinit-docs/docs/start-here.md`를 읽을 수도 있다. 실제 경로·origin·브랜치·커밋과 로컬 변경을 확인하고, 필요한 갱신 중 기존 변경을 보존한다.
- 읽지 못하면 시도한 경로와 미확인 범위를 알린다. 독립적으로 가능한 작업은 계속하되, 확인하지 못한 계약·설계를 추정해 변경하지 않는다.

## 이 저장소의 원본 안내

- 구현과 실행·테스트 방법은 [README](README.md), 관련 코드와 `docs/`를 기준으로 확인한다.
- 기존 [Copilot 안내](.github/copilot-instructions.md)와 [역할별 에이전트 문서](docs/agents/README.md)를 보존하고 작업에 맞게 따른다.
- FE↔BE 변경은 [검증 책임](docs/validation-guidelines.md)과 [워크스페이스 설계·API·배포 기록](docs/workspace-ui-rollout.md)의 범위·상태를 확인한다. 기록된 계획이나 검증을 현재 배포 상태로 간주하지 않는다.
- 공통 구조·용어·계약·흐름·중요 결정이 바뀌면 코드 변경과 함께 `pinit-docs`의 갱신 필요성을 확인한다. 구현 상세와 실행·검증 방법의 원본은 이 저장소에 유지한다.
