// 개발용 온보딩 응답. 실제 콘텐츠는 백엔드 리소스(task 모듈 onboarding-guide.yml)에 있고,
// 여기서는 같은 10개 기능과 key·route·anchor·투어 문구를 쓰되 가이드 항목은 줄여 적는다.
// node:test가 그대로 불러오므로 import 없이 쓴다. 아래 타입은 OnboardingResponse와 구조만 맞춘 것이다.
// 자리표시({{…}})는 서버가 적재할 때 바꾸므로 이미 바뀐 값으로 적는다.

type FixtureGroup = { heading: string | null; items: string[] }
type FixtureGuide = { behavior: FixtureGroup[]; principle: FixtureGroup[]; usage: FixtureGroup[] }
type FixtureTour = { route: string; anchor: string; purpose: string; benefit: string }
type FixtureFeature = { key: string; title: string; revision: number; tour: FixtureTour | null; guide: FixtureGuide | null }
type FixtureResponse = { revision: number; acknowledgedRevision: number; pendingTour: string[]; features: FixtureFeature[] }

const items = (...values: string[]): FixtureGroup[] => [{ heading: null, items: values }]

export const onboardingFixture: FixtureResponse = {
  revision: 2,
  acknowledgedRevision: 0,
  pendingTour: [],
  features: [
    {
      key: 'today',
      title: '오늘',
      revision: 1,
      tour: {
        route: '/app/today',
        anchor: 'today.header',
        purpose: '오늘 잡힌 일정과 지금 바로 손댈 수 있는 작업을 한 화면에 모아 보여 줘요.',
        benefit: '앱을 열자마자 무엇부터 할지 정할 수 있어요.',
      },
      guide: {
        behavior: items('회원 시간대 기준 오늘(00:00~24:00) 일정과, 이전 작업이 하나도 연결되지 않은 미완료 작업을 최대 10개 보여 줘요.'),
        principle: items('이전 작업을 완료해도 연결이 남아 있으면 이 목록에 나오지 않아요.'),
        usage: items('작업의 "일정 배정"을 누르고 시작 시각을 골라요.', '"자동 계획"으로 하루 시간표를 제안받을 수 있어요.'),
      },
    },
    {
      key: 'tasks',
      title: '작업',
      revision: 1,
      tour: {
        route: '/app/tasks',
        anchor: 'tasks.header',
        purpose: '마감일·중요도·난이도·예상 시간을 붙여 해야 할 일을 모아 두는 곳이에요.',
        benefit: '할 일을 머릿속에 들고 다니지 않아도 되고, 마감이 가까운 일부터 보여요.',
      },
      guide: {
        behavior: items(
          '마감일, 중요도 1~9, 난이도(1·2·3·5·8·13·21), 예상 시간(5분~24시간, 선택)을 입력해요.',
          '제목은 1~20자, 설명은 1~100자예요.',
        ),
        principle: items(
          '목록은 마감일 빠른 순, 같으면 먼저 만든 순이에요.',
          '예상 시간을 비우면 난이도로 환산해요(1 → 15분, 2 → 30분, 3 → 45분, 5 → 1시간, 8 → 1시간 30분, 13 → 2시간, 21 → 3시간).',
          '완료한 작업은 마감일이 지나면 목록에서 빠지고 "작업 아카이브"로 가요.',
        ),
        usage: items('＋를 눌러 작업을 추가해요.', '체크로 완료하거나 되돌려요.'),
      },
    },
    {
      key: 'dependencies',
      title: '이전·다음 작업',
      revision: 1,
      tour: {
        route: '/app/tasks/new',
        anchor: 'task-form.dependencies',
        purpose: '먼저 끝내야 하는 작업과 그다음 작업을 서로 연결해요.',
        benefit: '순서가 꼬이지 않아요. 앞선 작업이 끝나야 다음 일정을 시작할 수 있고, 자동 배치도 이 순서를 지켜요.',
      },
      guide: {
        behavior: items('작업 폼에서 이전 작업과 다음 작업을 골라요.'),
        principle: items(
          '순환이 생기는 연결은 거부해요.',
          '연결된 일정은 이전 작업이 모두 완료돼야 시작할 수 있어요.',
          '자동 배치는 이전 작업 블록이 끝난 뒤에 다음 작업을 놓아요.',
        ),
        usage: items('작업 추가·수정 화면에서 이전 작업과 다음 작업을 선택해요.'),
      },
    },
    {
      key: 'schedules',
      title: '일정',
      revision: 1,
      tour: {
        route: '/app/schedules',
        anchor: 'schedules.week-strip',
        purpose: '작업을 실제로 할 시각에 배치하거나, 작업 없이 일정만 따로 만들어요.',
        benefit: '언제 무엇을 할지 주 단위로 한눈에 보고, 카드를 끌어 날짜를 쉽게 옮길 수 있어요.',
      },
      guide: {
        behavior: items('작업에서 일정을 배정하거나, 작업 없이 직접 만들어요. 유형은 집중·빠른·행정이에요.'),
        principle: items(
          '계획 길이는 5분~24시간이고, 비우면 작업의 예상 시간, 작업이 없으면 30분이에요.',
          '주는 월요일에 시작해요.',
          '직접 만든 일정은 서로 겹쳐도 돼요.',
        ),
        usage: items('주간 띠에서 날짜를 골라요.', '카드를 화면 왼쪽·오른쪽 끝으로 끌면 전날·다음 날로 옮겨져요.'),
      },
    },
    {
      key: 'schedule-run',
      title: '일정 실행',
      revision: 1,
      tour: {
        route: '/app/schedules',
        anchor: 'schedules.list',
        purpose: '일정을 시작·일시정지·완료하면서 실제로 쓴 시간을 기록해요.',
        benefit: '계획과 실제가 얼마나 다른지 알 수 있고, 기록한 시간이 통계에 그대로 쌓여요.',
      },
      guide: {
        behavior: items('상태는 시작 전 → 진행 중 → 일시정지·완료이고, 취소하면 시작 전으로 돌아가요.'),
        principle: items(
          '실제 시간은 시작부터 멈출 때까지의 구간을 더한 값이에요.',
          '한 번에 하나만 진행할 수 있고, 일시정지 중에도 그 자리를 차지해요.',
          '일시정지 상태에서는 다시 시작한 뒤에 완료할 수 있어요.',
        ),
        usage: items('카드의 상태 버튼과 화면 아래 미니 플레이어(▶ Ⅱ ✓ ✕)로 조작해요.'),
      },
    },
    {
      key: 'planner',
      title: '일정 자동 배치',
      revision: 1,
      tour: {
        route: '/app/plan',
        anchor: 'plan.controls',
        purpose: '마감·중요도·난이도·선후관계를 보고 하루 시간표를 대신 짜서 제안해요.',
        benefit: '빈 시간에 무엇을 넣을지 고민하지 않아도 돼요. 고른 블록만 승인하면 일정이 되고, 승인 전에는 아무것도 바뀌지 않아요.',
      },
      guide: {
        behavior: items(
          '날짜(오늘 이후)와 마감 범위를 고르면 시간표를 제안해요.',
          '블록을 고르고 시각·유형을 바꿔 승인하면 일정이 돼요.',
        ),
        principle: [
          {
            heading: '후보',
            items: ['미완료이고 일정이 없으며, 마감이 계획일 + 마감 범위(기본 7일, 0~30일) 안에 있는 작업이에요.'],
          },
          { heading: '우선순위', items: ['필수 → 마감 빠른 순 → 중요도 높은 순 → 난이도 높은 순 → 먼저 만든 순이에요.'] },
          {
            heading: '시간창과 기존 일정',
            items: [
              '기상 07:00부터 취침 23:00까지이고, 오늘이면 지금부터예요.',
              '진행 중인 일정은 남은 시간만큼, 최소 15분 자리를 차지해요.',
            ],
          },
          { heading: '하루 목표', items: ['하루 목표는 4시간이에요. 필수 작업만 목표를 넘을 수 있어요.'] },
          {
            heading: '배치 방법',
            items: [
              '블록 사이를 10분 비우고, 시작 시각은 5분 단위예요.',
              '난이도 5 이상이면 집중, 미만이면 빠른 작업으로 제안해요.',
            ],
          },
          { heading: '승인과 재검사', items: ['승인 전에는 아무것도 저장하지 않아요. 승인할 때 다시 검사해요.'] },
          { heading: '배치하지 못한 이유', items: ['맞는 빈 시간이 없음 / 하루 목표를 넘음 / 이전 작업이 놓이지 않음'] },
        ],
        usage: items(
          '오늘 또는 일정 화면에서 "자동 계획"을 눌러요.',
          '날짜와 범위를 골라요.',
          '블록을 고르고 고친 뒤 "선택한 블록으로 일정 만들기"를 눌러요.',
        ),
      },
    },
    {
      key: 'statistics',
      title: '통계',
      revision: 1,
      tour: {
        route: '/app/statistics',
        anchor: 'statistics.cards',
        purpose: '이번 주에 집중 작업과 행정 작업에 실제로 쓴 시간을 보여 줘요.',
        benefit: '지난주와 비교해 시간을 어디에 쓰고 있는지 돌아볼 수 있어요.',
      },
      guide: {
        behavior: items('월요일에 시작하는 주의 집중 작업, 행정 작업, 총 작업 시간을 보여 주고, 지난주와 비교해요.'),
        principle: items(
          '완료한 일정의 실제 실행 시간만 세요. 계획 길이는 세지 않아요.',
          '빠른 작업은 총합에만 들어가요.',
          '일정의 계획 시작일이 속한 주에 집계해요.',
        ),
        usage: items('지난 주·다음 주로 이동하고 새로고침해요.'),
      },
    },
    {
      key: 'routines',
      title: '생활 시간',
      revision: 1,
      tour: {
        route: '/app/settings',
        anchor: 'settings.routines',
        purpose: '식사·수면처럼 매일 반복되는 쉬는 시간을 요일별로 등록해요.',
        benefit: '자동 배치가 그 시간을 비워 두고 계획해요. 점심시간에 일이 잡히지 않아요.',
      },
      guide: {
        behavior: items('설정의 "생활 시간"에서 아침·점심·저녁·수면을 켜거나 "직접 추가"로 시간을 넣어요.'),
        principle: items(
          '생활 시간은 자동 배치에서 이미 있는 일정처럼 비워 두는 시간이에요.',
          '수면을 하나라도 등록하면 계획 시간창이 계획한 날 하루 전체가 돼요.',
        ),
        usage: items('설정 → "생활 시간"에서 항목을 켜고 시각·길이·요일을 고른 뒤 저장해요.'),
      },
    },
    {
      key: 'recurrence',
      title: '반복',
      revision: 2,
      tour: {
        route: '/app/settings',
        anchor: 'settings.recurrences',
        purpose: '주간 회의나 운동처럼 반복되는 일을 한 번만 등록해요.',
        benefit: '회차가 일정과 작업에 알아서 생기고, 자동 배치도 그날의 회차를 챙겨요.',
      },
      guide: {
        behavior: items('일정이나 작업을 만들 때 "반복"을 켜면 반복으로 만들어요.'),
        principle: items('"이번 및 이후"는 고른 회차부터, "전체"는 반복 전체를 바꿔요.'),
        usage: items('설정 → "반복 관리"에서 반복 목록을 보고 고치거나 끝낼 수 있어요.'),
      },
    },
    {
      key: 'notifications',
      title: '알림',
      revision: 1,
      tour: {
        route: '/app/settings',
        anchor: 'settings.push',
        purpose: '일정이 시작할 시각이 되면 이 기기로 푸시 알림을 보내요.',
        benefit: '앱을 열어 두지 않아도 일정 시작을 놓치지 않아요.',
      },
      guide: {
        behavior: items('설정에서 이 기기의 브라우저 푸시를 켜요.'),
        principle: items(
          '시작 전 일정의 시작 시각이 되면 푸시를 보내요. 미리 알림은 없어요.',
          '기기마다 따로 구독하고, 보내지 못하면 최대 5회 다시 보내요.',
        ),
        usage: items('설정 → 브라우저 푸시 알림을 켜고 브라우저 권한을 허용해요.'),
      },
    },
    {
      key: 'ai-connection',
      title: 'AI 연결',
      revision: 1,
      tour: {
        route: '/app/settings',
        anchor: 'settings.ai-connection',
        purpose: 'Claude 같은 AI 앱이 핀잇의 작업과 일정을 조회하고 관리하도록 연결해요.',
        benefit: '"내일 오전에 보고서 쓸 시간 잡아 줘"처럼 말로 부탁할 수 있어요. 권한은 직접 고르고 언제든 끊을 수 있어요.',
      },
      guide: {
        behavior: items('설정의 AI 연결 주소를 AI 앱에 커넥터로 추가하고, 핀잇에 로그인해 권한을 골라요.'),
        principle: items(
          '기본 권한은 읽기·쓰기예요. 삭제 권한은 동의 화면에서 직접 체크해야 생겨요.',
          '삭제는 미리보기를 보고 승인하는 2단계예요.',
        ),
        usage: items('설정 → AI 연결 → 주소 복사 → AI 앱에 추가해요.', '"연결된 앱"에서 연결을 끊을 수 있어요.'),
      },
    },
    {
      key: 'onboarding',
      title: '온보딩 다시 보기',
      revision: 1,
      tour: {
        route: '/app/settings',
        anchor: 'settings.onboarding',
        purpose: '이 안내는 설정 → 온보딩에서 언제든 다시 볼 수 있어요.',
        benefit: '기능마다 동작 원리와 사용 방법을 자세히 정리해 두었어요.',
      },
      guide: null,
    },
  ],
}
