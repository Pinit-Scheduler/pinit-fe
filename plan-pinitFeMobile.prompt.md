핀잇 일정 관리 FE – 모바일 탭 네비게이션 및 일정 UX 확장 계획

---

- [x] 1. 전체 모바일 화면 구조(상단 헤더 + 하단 탭) 및 라우팅 재설계
- [x] 2. 일정 도메인/폼/상태 모델 재정비 (주간 뷰, 미완료 배너, 파란 점 반영)
- [x] 3. Asia/Seoul 타임존 및 날짜 포맷 처리 전략(주간 단위 연산 중심)
- [x] 4. 전역 상태 관리와 훅 설계 (`currentWeekStart`, `selectedDate`, presence/overdue 요약)
- [x] 5. 일정 목록 탭(주간 날짜 스트립 + 파란 점 + 상단 배너) 상세 설계
- [x] 6. 일정 상세/수정 화면(모바일 전체 화면 오버레이) 설계
- [x] 7. 일정 추가 탭(중앙 탭) 폼/검증/저장 후 이동 설계
- [x] 8. 일정 의존성 선택 UX(특정 날짜 기준) 및 간단 프론트 검증
- [ ] 9. “동시에 하나의 일정만 실행” 제약을 고려한 상태/버튼 UX 설계
- [ ] 10. 통계 탭(그래프 중심) 레이아웃 및 데이터 모델 설계
- [ ] 11. 통계용 도넛/막대 그래프 컴포넌트 및 변환 유틸 설계
- [x] 12. 상단 우측 설정 화면/버튼 설계
- [ ] 13. API 클라이언트/에러 처리/에러 메시지 정책
- [ ] 14. 프론트 검증 vs 백엔드 검증 책임 분리 원칙 정리
- [x] 15. 날짜/시간 유틸, 주간/일간 포맷터, 파서 설계
- [x] 16. 공통 UI 컴포넌트(TopBar, BottomTabBar, WeeklyDateStrip 등) 설계
- [ ] 17. 로딩/에러/비어있는 상태 UX 및 배너/알림 UX 설계
- [ ] 18. 기본 테스트 전략(유틸/훅/컴포넌트) 개요

---

## 1. 전체 모바일 화면 구조(상단 헤더 + 하단 탭) 및 라우팅 재설계

모바일 우선 레이아웃과 하단 3탭(일정 / 일정 추가 / 통계), 상단 우측 설정 버튼을 기준으로 전체 페이지 구조를 정의한다.

### 세부 계획
- [ ] 상단/하단 공통 레이아웃 정의
    - 상단: `TopBar`
        - 좌측: 현재 화면 타이틀 또는 뒤로가기 버튼
        - 중앙: 탭별 컨텍스트(날짜/기간 등) 표시 영역
        - 우측: 톱니바퀴 설정 버튼(대부분 화면에서 공통으로 노출)
    - 중앙: 현재 탭/화면 컨텐츠
    - 하단: `BottomTabBar`
        - 탭 3개: 일정 목록, 일정 추가, 통계
- [ ] 라우팅 구조
    - 루트:
        - `/` → `/app/schedules` 로 리다이렉트
    - 상위 레이아웃 라우트:
        - `/app` : `AppShell` (TopBar + BottomTabBar + Outlet)
            - `/app/schedules` : **일정 목록 탭** (주간 날짜 스트립 + 리스트)
            - `/app/new` : **일정 추가 탭** (생성 폼)
            - `/app/statistics` : **통계 탭** (그래프)
            - `/app/settings` : **설정 페이지** (설정 전용 화면)
    - 상세/수정 라우트(모바일 전체 화면 오버레이 형태):
        - `/app/schedules/:scheduleId` : 일정 상세 화면
        - `/app/schedules/:scheduleId/edit` : 일정 수정 화면
- [ ] 상세/수정 화면에서의 상단/하단 처리
    - `TopBar`:
        - 좌: 뒤로가기(←)
        - 중앙: “일정 상세” 또는 “일정 수정” 타이틀
        - 우: 설정 버튼 유지 여부는 옵션 (1차 버전에는 유지해도 됨)
    - `BottomTabBar`:
        - 상세/수정 화면에서도 계속 노출(언제든 다른 탭으로 이동 가능) 또는 숨김(일정에 집중) 중 선택
        - 계획 상 1차는 **계속 노출**을 기본으로 두고, 나중에 숨기고 싶으면 레이아웃 옵션으로 조정 가능하게 설계

---

## 2. 일정 도메인/폼/상태 모델 재정비 (주간 뷰, 미완료 배너, 파란 점 반영)

백엔드 스키마(일정/통계)를 기반으로, 모바일 주간 뷰·파란 점·미완료 배너를 구현하기 위한 FE 전용 타입/모델을 정리한다.

### 세부 계획
- [ ] API 일정 타입 매핑
    - `ScheduleResponse`를 래핑한 FE 타입 `Schedule` 정의
        - `id`, `title`, `description`, `date`, `deadline`, `importance`, `urgency`, `taskType`, `state` 등
        - `date`, `deadline`는 Asia/Seoul datetime 문자열 (예: `2025-11-28T09:00:00+09:00[Asia/Seoul]`)
- [ ] 폼 전용 모델
    - `ScheduleFormValues`
        - `title: string`
        - `description: string`
        - `date: Date` (또는 date string + time string 조합, KST 기준)
        - `deadline: Date | null`
        - `importance: 1..9`
        - `urgency: 1..9`
        - `taskType: 'DEEP_WORK' | 'QUICK_TASK' | 'ADMIN_TASK' | ...`
        - 의존성 관련: `prevIds: number[]`, `nextIds: number[]`
- [ ] 주간/배너/파란 점 상태 모델
    - `currentWeekStart: Date` (KST 기준, 주의 첫날)
    - `selectedDate: Date` (항상 `currentWeekStart ~ +6` 사이)
    - `DateSchedulePresence` (파란 점용):
        - `type DateSchedulePresence = Record<string /* 'YYYY-MM-DD' */, boolean>`
    - `OverdueSummary` (미완료 과거 일정 배너용):
        - `hasOverdue: boolean`
        - `count?: number`
        - `earliestDate?: string /* 'YYYY-MM-DD' */`

---

## 3. Asia/Seoul 타임존 및 날짜 포맷 처리 전략(주간 단위 연산 중심)

모든 날짜/시간 처리는 Asia/Seoul을 기준으로 하고, 주간 뷰/파란 점/과거 일정 판단에 사용한다.

### 세부 계획
- [ ] 타임존 기준
    - FE 전체에서 **Asia/Seoul**을 기준 타임존으로 사용
    - 브라우저 로컬 타임존과 관계없이, 일정 날짜/시간은 모두 KST로 해석/표시
- [ ] 날짜/시간 유틸 함수 (개념)
    - `toSeoulDate(dateLike): Date` : 입력을 Asia/Seoul 기준 날짜 객체로 정규화
    - `formatDate(dateLike): string` : `'YYYY-MM-DD'`
    - `formatDateTimeWithZone(dateLike): string` : 백엔드 요구 포맷 (`YYYY-MM-DDTHH:mm:ss+09:00[Asia/Seoul]`)
    - `getWeekStart(dateLike): Date` : KST 기준으로 해당 날짜가 속한 주의 시작일 계산
    - `addDays(dateLike, offset: number): Date` : 주간 이동에 사용
- [ ] 주간 뷰와 파란 점 계산 시 활용
    - `currentWeekStart`를 기준으로 `days = [0..6].map(d => addDays(currentWeekStart, d))` 형태로 7일 계산
    - 각 날짜를 `formatDate`로 `'YYYY-MM-DD'` 문자열로 변환해 presence/overdue 판단에 사용

---

## 4. 전역 상태 관리와 훅 설계 (`currentWeekStart`, `selectedDate`, presence/overdue 요약)

서버 상태(일정/통계)와 UI 상태(주간/선택일/배너)를 분리하고, 이를 훅으로 캡슐화한다.

### 세부 계획
- [ ] 서버 상태 라이브러리(예: React Query) 사용 전제
    - 일정/통계를 `useQuery`/`useMutation`으로 관리
- [ ] 전역/페이지 레벨 UI 상태
    - `useScheduleViewState` (또는 유사한 훅)
        - `currentWeekStart`
        - `selectedDate`
        - `setCurrentWeekStart`, `setSelectedDate`
    - 상태 변경 규칙:
        - 앱 초기 진입 시: `currentWeekStart = getWeekStart(todayKST)`, `selectedDate = todayKST`
        - 주 전환 시: `currentWeekStart = currentWeekStart + offset * 7일`
        - 날짜 선택 시: `selectedDate = clickedDate`
- [ ] 주간 파란 점용 훅
    - `useWeeklySchedulePresence({ weekStart })`
        - 내부에서 `weekDays` 7개를 계산하여, 각 날짜에 대해 일정이 하나 이상 있는지 판단
        - 1차 버전: 각 날짜에 대해 `/schedules?date=YYYY-MM-DD` 호출 후 length>0 검사
        - 결과를 `Record<'YYYY-MM-DD', boolean>` 형태로 반환
- [ ] 미완료 과거 일정 배너용 훅
    - `useOverdueSchedulesSummary()`
        - KST 기준 오늘 이전의 일정 중, `state !== COMPLETED` 인 것이 있는지 검사
        - 성능을 위해 1차는 “최근 N일(예: 7~14일)” 기준으로 제한하고, 나중에 summary API가 생기면 전체 과거로 확장
        - `{ hasOverdue, count, earliestDate }` 반환

---

## 5. 일정 목록 탭(주간 날짜 스트립 + 파란 점 + 상단 배너) 상세 설계

핵심 화면인 일정 목록 탭을, 모바일 주간 뷰/배너/파란 점/드래그 전환을 모두 반영해 설계한다.

### 세부 계획
- [ ] 레이아웃 구조 (`SchedulesTab`)
    1. 상단 `TopBar`
        - 좌: “일정” 타이틀
        - 중앙: 오늘 날짜 또는 선택된 날짜 표시(선택 사항)
        - 우: 톱니바퀴(설정) 아이콘 → `/app/settings`로 이동
    2. (조건부) 미완료 과거 일정 배너
        - `useOverdueSchedulesSummary()` 결과 `hasOverdue === true` 일 때만 렌더
        - 텍스트 예:
            - `count` 있을 때: “이전 날짜에 아직 완료되지 않은 일정이 {count}개 있어요.”
            - 없을 때: “이전 날짜에 아직 완료되지 않은 일정이 있어요.”
        - 탭 동작:
            - `earliestDate`가 있다면: 해당 날짜가 속한 주를 `currentWeekStart`로 설정하고, `selectedDate = earliestDate`로 복귀
    3. 주간 날짜 스트립 (`WeeklyDateStrip`)
        - 현재 주 7일만 렌더: `weekStart = currentWeekStart`, `days = [0..6]`
        - 각 날짜 셀에 대해:
            - 날짜 텍스트(예: “28”)
            - 파란 점: `presenceMap['YYYY-MM-DD'] === true` 이면 셀 아래에 작은 파란 점 표시
            - 선택된 날짜는 배경/테두리 강조
        - 상호작용:
            - 날짜 탭: `onSelectDate(date)` → `selectedDate` 업데이트
            - 수평 스와이프 제스처:
                - 왼쪽 스와이프 → 다음 주 (`onChangeWeek(+1)`)
                - 오른쪽 스와이프 → 이전 주 (`onChangeWeek(-1)`)
                - 임계값(예: 화면 너비의 20~30%) 이상에서만 주 전환
    4. 일정 리스트
        - `selectedDate` 기준 `/schedules?date=YYYY-MM-DD` 조회 결과 렌더
        - 각 일정 카드:
            - 제목/타입/중요도/긴급도/상태 뱃지
            - 시간/마감일(필요 시)
            - 클릭 시 `/app/schedules/:id` 상세로 이동
    5. 빈 상태/로딩/에러 UX
        - 로딩: 리스트의 스켈레톤 아이템
        - 비어있음: “이 날짜에 등록된 일정이 없습니다. 일정 추가 탭에서 새 일정을 만들어 보세요.”
        - 에러: 에러 메시지 + 재시도 버튼

- [ ] `WeeklyDateStrip` 제스처 처리 상세
    - 제스처 대상: 주간 날짜 스트립 전체 영역
    - 로직:
        - onDragStart: 시작 좌표 기록
        - onDragMove: x/y 이동량 측정, 수평 우선 여부 판단
        - onDragEnd:
            - `abs(deltaX) >= threshold` 이고 `abs(deltaX) > abs(deltaY)` 인 경우에만 스와이프 인정
            - `deltaX < 0` → 다음 주, `deltaX > 0` → 이전 주
    - 주 전환 시 상태 업데이트:
        - 상위에서 `onChangeWeek(offset)` 구현:
            - `currentWeekStart = addDays(currentWeekStart, offset * 7)`
            - `selectedDate` 정책:
                - 기본: 기존 `selectedDate`의 요일 인덱스를 유지해 새 주의 같은 요일로 이동
                - 단순화가 필요하면 새 주의 첫날(weekStart)을 선택하는 정책으로 변경 가능 (문서에 두 가지 옵션 중 기본값 명시)
    - 파란 점/리스트와의 연동:
        - `currentWeekStart` 변경 → `useWeeklySchedulePresence` 재호출 → 새 주에 대한 presenceMap
        - `selectedDate` 변경 → 해당 날짜 `/schedules` 재조회

---

## 6. 일정 상세/수정 화면(모바일 전체 화면 오버레이) 설계

일정 카드 클릭 시 열리는 상세 화면과, 그 안에서 진입하는 수정 화면을 모바일 전체 화면 기준으로 설계한다.

### 세부 계획
- [ ] 일정 상세 페이지 (`ScheduleDetailPage`)
    - 진입: `/app/schedules/:id`
    - 상단 `TopBar`
        - 좌: 뒤로가기(이전 화면/목록으로)
        - 중앙: “일정 상세”
        - 우: 설정 버튼(1차 버전에선 유지)
    - 본문 구성:
        - 일정 기본 정보: 제목, 타입, 상태 뱃지
        - 시간 정보: 계획일/마감일(Asia/Seoul 포맷), 추정/실제 소요 시간
        - 중요도/긴급도 표시
        - 의존성 정보(선행/후행 일정 요약 목록, 추후 확장)
    - 하단 액션 버튼(고정 바 또는 본문 하단)
        - “시작”, “일시중지”, “완료”, “취소”, “수정”, “삭제”
- [ ] 일정 수정 페이지 (`ScheduleEditPage`)
    - 진입: 상세 화면에서 “수정” 버튼 클릭
    - `ScheduleForm`을 `edit` 모드로 재사용
    - 상단 `TopBar`:
        - 좌: 뒤로가기
        - 중앙: “일정 수정”
        - 우: 설정(옵션)
    - 저장 시:
        - `PATCH /schedules/:id`
        - 성공 후:
            - “수정되기 전 존재했던 날짜”로 돌아가서 그 날짜의 `/schedules` 다시 조회

---

## 7. 일정 추가 탭(중앙 탭) 폼/검증/저장 후 이동 설계

하단 중앙 탭에서 언제든 새 일정 생성 폼으로 진입할 수 있도록 하고, 저장 후 일정 목록으로 자연스럽게 돌아오게 한다.

### 세부 계획
- [ ] `ScheduleCreateTab` 구성 (`/app/new`)
    - 상단 `TopBar`:
        - 좌: “일정 추가” 타이틀
        - 중앙: (선택한 기준 날짜가 있다면 표시)
        - 우: 설정 아이콘
    - 본문: `ScheduleForm` (create 모드)
        - 필수 필드: 제목, 타입, 설명, date, deadline, 중요도, 긴급도
        - 옵션: 예상 시간, 의존성(1차에서 생략 or 단순화 가능)
- [ ] 프론트 검증(기본 수준)
    - 필수값: 제목/설명/date/type/importance/urgency
    - date/deadline 관계: deadline이 date보다 이전이면 에러
    - 중요도/긴급도: 1~9 범위로 제한
- [ ] 저장 동작
    - `POST /schedules`
    - 성공 시:
        - “메인 일정 목록 탭으로 자연스럽게 돌아가야 한다”는 요구 반영:
            - `/app/schedules`로 navigate
            - 새로 생성된 일정의 `date`를 기준으로:
                - `currentWeekStart = getWeekStart(newDate)`
                - `selectedDate = newDate`
            - 해당 날짜의 `/schedules` 재조회 → 목록에서 새 일정 확인 가능

---

## 8. 일정 의존성 선택 UX(특정 날짜 기준) 및 간단 프론트 검증

특정 날짜에 존재하는 일정을 기준으로 사전/사후 일정을 선택하고, 프론트에서는 자기 자신/중복/양방향 선택 정도만 검증한다.

### 세부 계획
- [ ] 의존성 섹션 UX
    - 폼 내 “이전에 해야 하는 일정 / 이후에 해야 하는 일정” 섹션
    - 기준 날짜 선택(또는 기본값: 현재 일정의 `date`의 날짜 부분)
    - 해당 날짜의 일정 목록 조회: `/schedules?date=YYYY-MM-DD`
    - 후보 목록에서 사전/사후로 구분해 선택:
        - 한 일정 카드에 대해 “이전”/“이후” 토글 중 하나만 선택 가능
- [ ] 프론트 검증
    - 자기 자신 일정은 후보에서 제외
    - 중복 선택 방지(Set 자료구조 사용)
    - 양방향 선택 방지:
        - A를 “이전”으로 선택한 상태에서 다시 “이후”로 선택하려 하면 경고/선택 취소
    - 기준 날짜 이후 일정은 후보에서 제외하거나 선택 불가 처리
- [ ] 백엔드 검증 위임
    - 순환 의존성/그래프 검증, 정합성은 모두 백엔드 책임
    - 백엔드에서 400/409 에러로 돌려줄 경우, 상단 배너/필드 에러로 메시지만 잘 표시

---

## 9. “동시에 하나의 일정만 실행” 제약을 고려한 상태/버튼 UX 설계

사용자는 동시에 단 하나의 일정만 실행할 수 있고, 정합성은 백엔드가 강하게 검증한다. FE는 버튼 상태/배너 수준으로 보조한다.

### 세부 계획
- [ ] 상태 값에 따른 버튼 활성 규칙(프론트)
    - `state === 'IN_PROGRESS'` 인 일정에는 “시작” 버튼 비활성 또는 숨김, “완료/일시중지/취소”만 표시
    - `state === 'COMPLETED'` 인 일정에는 “시작/완료/취소” 버튼 비활성/숨김
    - `state === 'PENDING'` 인 일정에는 “시작” 활성, “완료” 비활성 등
- [ ] 진행 중 일정 표시
    - 오늘 또는 현재 주의 일정 중 `IN_PROGRESS` 상태가 있으면:
        - 일정 목록 탭 상단/헤더 부근에 “현재 진행 중: XX” 배너/칩 표시 (옵션)
- [ ] 동시 실행 제약과 UX
    - 기본적으로는 백엔드가 “이미 진행 중인 일정이 있음” 에러를 반환
    - FE는 해당 에러 메시지를 토스트/배너로 표시
    - 필요하다면, `IN_PROGRESS` 일정이 하나라도 있다면 다른 일정들의 “시작” 버튼을 비활성화하고 툴팁으로 이유 안내

---

## 10. 통계 탭(그래프 중심) 레이아웃 및 데이터 모델 설계

`/statistics` 응답을 기반으로, 주간 딥워크/행정/총 시간을 그래프로 시각화하는 통계 탭을 설계한다.

### 세부 계획
- [ ] `StatisticsTab` 레이아웃 (`/app/statistics`)
    - 상단 `TopBar`:
        - 좌: “통계” 타이틀
        - 중앙: 현재 기준 주(예: “이번 주”) 또는 주간 네비게이션
        - 우: 설정 버튼
    - 본문 구성:
        1. 요약 카드 구역
            - 이번 주 딥워크 시간
            - 이번 주 행정 작업 시간
            - 총 작업 시간
        2. 도넛 차트
            - 딥워크 vs 행정 작업 비율 시각화
        3. 막대 그래프
            - 이번 주 총 작업 시간 (혹은 요일별 분포, 추후 API에 따라)
- [ ] 통계 데이터 모델 (`WeeklyStatsView` 등)
    - `/statistics` 응답 →
        - `weekStart: Date`
        - `deepWorkMinutes: number`
        - `adminWorkMinutes: number`
        - `totalMinutes: number`
        - `deepWorkRatio`, `adminWorkRatio` 계산
- [ ] 기간 전환
    - 초기엔 `time` 파라미터를 “현재 시간”으로 고정해 “이번 주”만 보여주고,
    - 추후 `< 지난 주 / 다음 주 >` 네비게이션을 추가할 수 있도록 `useWeeklyStatistics` 훅의 인터페이스를 여유 있게 설계

---

## 11. 통계용 도넛/막대 그래프 컴포넌트 및 변환 유틸 설계

통계 데이터를 실제 그래프로 그리기 위해 입력 포맷과 유틸을 정의한다.

### 세부 계획
- [ ] 그래프 컴포넌트 인터페이스
    - `WorkTypeDonutChart`
        - props: `{ deepWorkMinutes, adminWorkMinutes }`
        - 내부에서 비율 계산 후, 도넛 차트 라이브러리에 전달
    - `WeeklyTotalBarChart`
        - props: `{ totalMinutes, deepWorkMinutes, adminWorkMinutes }`
        - 단일 막대 + 텍스트/범례로 구체 수치 표시
- [ ] 변환 유틸
    - `parseElapsedTimeToMinutes(elapsed: string): number`
        - `/statistics` 응답의 시간 문자열을 분 단위 숫자로 변환
    - `formatMinutesToHM(minutes: number): { hours: number; minutes: number }`
        - UI 표시에 사용

---

## 12. 상단 우측 설정 화면/버튼 설계

상단 우측에 설정 진입 버튼을 두고, `/app/settings`에서 알림/시간/통계 관련 옵션을 관리하는 구조를 정의한다.

### 세부 계획
- [ ] `SettingsPage` (`/app/settings`)
    - 상단 `TopBar`:
        - 좌: 뒤로가기
        - 중앙: “설정”
        - 우: (설정 아이콘은 숨김)
    - 본문 예시 섹션:
        - 알림 설정 (일정 시작/종료/마감 알림 토글)
        - 시간/통계 안내 (Asia/Seoul 기준 사용 설명, “이번 주” 기준 설명 등)
        - 향후 확장용 영역: 작업 타입 라벨 관리, 언어 설정 등
- [ ] `TopBar`의 설정 버튼 동작
    - 대부분의 탭/화면에서 우측 설정 버튼은 `/app/settings`로 navigate
    - 설정 화면에서만 비활성 또는 숨김 처리

---

## 13. API 클라이언트/에러 처리/에러 메시지 정책

도메인별 API 모듈과 에러 공통 처리 정책을 정의해 일정/통계/의존성/상태 변경을 일관성 있게 처리한다.

### 세부 계획
- [ ] `src/api/client.ts`
    - 기본 HTTP 클라이언트 래퍼
    - 공통 에러 타입: `{ code?: string; message: string; fieldErrors?: Record<string, string> }`
- [ ] 도메인 API 모듈
    - `src/api/schedules.ts`: 목록/상세/생성/수정/삭제/상태 변경/의존성 관련 호출
    - `src/api/statistics.ts`: 주간 통계 조회
- [ ] 에러 메시지 정책
    - 프론트 검증 실패: 폼 필드 하단/상단에 한국어 메시지 직접 표기
    - 백엔드 검증 실패: `ErrorResponse.message`를 기준으로 상단 배너/토스트에 노출
    - 409(충돌, 예: 동시 실행 제약/상태 전이 불가 등)에는 공통 프리픽스(“현재 상태에서는 이 동작을 할 수 없어요.”) 붙이기

---

## 14. 프론트 검증 vs 백엔드 검증 책임 분리 원칙 정리

사용자 경험을 해치지 않는 선에서만 프론트에서 검증하고, 비즈니스 규칙은 백엔드에 위임하는 원칙을 정리한다.

### 세부 계획
- [ ] 프론트 검증 범위
    - 필수 입력 여부, 기본 형식(날짜/숫자)
    - date/deadline 관계(마감일이 시작일보다 빠른지)
    - 중요도/긴급도 유효 범위 (1~9)
    - 의존성 선택 시:
        - 자기 자신/중복/단순 양방향 선택 방지
    - 버튼 활성/비활성 등 명백한 상태 기반 제약
- [ ] 백엔드 검증 범위
    - 일정 간 사이클/그래프 검증
    - “동시에 하나의 일정만 실행” 강제
    - 실제 가능한 시간대/중복 예약/권한 등 복잡한 도메인 규칙
- [ ] 에러 핸들링 연결
    - 프론트 검증 실패 시 서버 호출 자체를 막고, 즉시 폼 에러 표시
    - 서버 검증 실패 시 메시지를 받아 UX적으로 적절한 위치에 노출

---

## 15. 날짜/시간 유틸, 주간/일간 포맷터, 파서 설계

주간 뷰/파란 점/미완료 배너/통계 등 다양한 곳에서 일관되게 쓰일 날짜/시간 유틸을 정의한다.

### 세부 계획
- [ ] `src/utils/datetime.ts`에 공통 함수 정의
    - `getTodayKST(): Date`
    - `getWeekStart(date: Date): Date`
    - `getWeekDays(weekStart: Date): Date[] // 7일`
    - `toDateKey(date: Date): string // 'YYYY-MM-DD'`
    - `fromApiDateTimeKST(text: string): Date`
    - `toApiDateTimeKST(date: Date): string // '[Asia/Seoul]' 포함 포맷`
- [ ] 사용처
    - `SchedulesTab`: 주간 스트립, selectedDate, presence, overdue 판단
    - `ScheduleForm`: 초기값/제출 값 포맷 변환
    - `StatisticsTab`: weekStart 표시 및 기간 텍스트 구성

---

## 16. 공통 UI 컴포넌트(TopBar, BottomTabBar, WeeklyDateStrip 등) 설계

반복적으로 사용되는 레이아웃 및 입력/패턴을 컴포넌트로 분리해 재사용성을 높인다.

### 세부 계획
- [ ] `TopBar`
    - props: `{ title, showBack?, onBack?, showSettingsButton?, onSettings?, centerContent? }`
    - 각 탭/페이지에서 공통으로 사용
- [ ] `BottomTabBar`
    - 탭 정보: `{ key: 'schedules'|'new'|'statistics', icon, label, path }[]`
    - 현재 경로 기준 활성 탭 스타일링
- [ ] `WeeklyDateStrip`
    - props: `{ weekStart, selectedDate, presenceMap, onSelectDate, onChangeWeek }`
    - 수평 스와이프 제스처 처리 및 파란 점 표시 포함
- [ ] 기타 공통 컴포넌트
    - 상태 뱃지, 카드, 버튼, 인풋, 에러 메시지 영역 등

---

## 17. 로딩/에러/비어있는 상태 UX 및 배너/알림 UX 설계

상태에 따른 피드백(로딩/에러/empty)과 상단 배너/알림 UX를 일관되게 정의한다.

### 세부 계획
- [ ] 일정 목록 탭
    - 로딩: 날짜 스트립은 먼저 표시, 리스트는 스켈레톤
    - 비어있음: “이 날짜에 등록된 일정이 없습니다.” + 일정 추가 탭 유도 문구
    - 에러: 상단에 에러 배너 + 재시도 버튼
    - 미완료 과거 일정 배너: `hasOverdue` true일 때만, 짧은 안내와 탭 동작 정의
- [ ] 상세/수정/추가 폼
    - 저장 중: 버튼 로딩 상태, 중복 제출 방지
    - 저장 실패: 백엔드 메시지를 상단/필드별로 적절히 표시
- [ ] 통계 탭
    - 로딩: 그래프 스켈레톤
    - 데이터 없음: “해당 기간의 기록이 없습니다.” 메시지

---

## 18. 기본 테스트 전략(유틸/훅/컴포넌트) 개요

핵심 도메인(주간 날짜 계산, 파란 점, 미완료 배너, 스와이프 전환 등)에 대한 최소 테스트 전략을 정의한다.

### 세부 계획
- [ ] 유틸 테스트
    - `getWeekStart`, `getWeekDays`, `toDateKey` 등 주간 계산 로직 검증
    - Asia/Seoul 기준 날짜 변환/포맷 함수 검증
- [ ] 훅 테스트
    - `useWeeklySchedulePresence`: 주간 7일에 대해 presenceMap 생성 논리 검사(모킹된 API 사용)
    - `useOverdueSchedulesSummary`: 최근 N일 범위에서 미완료 일정 존재 여부 판단 로직 검증
- [ ] 컴포넌트 테스트
    - `WeeklyDateStrip`: 날짜 렌더, 파란 점 표시, 스와이프 제스처 시 onChangeWeek 호출 여부
    - `SchedulesTab`: 배너 표시 조건, 날짜 선택 시 목록 재조회 트리거 여부
    - `ScheduleForm`: 필수 필드 검증 및 submit 동작

---

이 계획은 모바일 탭 네비게이션, 상단 설정 버튼, 주간 날짜 스트립, 드래그 기반 주 전환, 파란 점, 미완료 과거 일정 배너, 통계 그래프까지 모두 반영한 핀잇 일정 관리 FE 구현용 설계 초안이다.
향후 실제 구현 단계에서 컴포넌트/훅/유틸 단위로 세분화하고, 백엔드 API 스펙이 구체화될 때마다 각 섹션을 구체적인 타입/엔드포인트/에러 코드 레벨로 업데이트하면 된다.
