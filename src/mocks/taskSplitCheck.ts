import type {
  DraftPiece,
  SplitCheck,
  SplitCheckPiece,
  SplitDraftAction,
  SplitFieldError,
  SplitOrderChoice,
  SplitPiece,
} from '../features/task-split/api/splitProposals'

/**
 * 초안 검사(ADR-0035 §8.3)의 개발용 계산. 서버 `SplitDraftCheck`·`SplitGraph`·`SplitFourHourRule`의 규칙과
 * `SplitErrorMessages`의 문구를 따른다. 순수 함수다.
 */

export type StoredExclusion = NonNullable<SplitPiece['exclusion']>

const TITLE_MAX = 20
const DESCRIPTION_MAX = 2000
const MINUTES_MIN = 5
const MINUTES_MAX = 1440
const LIMIT_MINUTES = 240
const DIFFICULTIES = [1, 2, 3, 5, 8, 13, 21]

const MESSAGES = {
  title: '제목은 1~20자로 입력해 주세요.',
  description: '설명은 1~2,000자로 입력해 주세요.',
  minutes: '예상 시간은 5분~24시간으로 넣어 주세요.',
  difficulty: '난이도는 1, 2, 3, 5, 8, 13, 21 중에서 골라 주세요.',
  dueRequired: '마감 날짜를 넣어 주세요.',
  dueOriginalPassed: '원본 마감이 지나 모든 마감은 원본 마감이어야 해요.',
  dueBeforeToday: '이미 지난 날짜예요. 오늘 이후로 넣어 주세요.',
  afterUnknown: '없는 조각은 이전 조각으로 고를 수 없어요.',
  afterCycle: '이전 조각을 따라가면 이 조각으로 돌아와요. 순서를 고쳐 주세요.',
}

const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
/** 문구와 후보에 되풀이하는 제목. 없으면 빈 글, 제목 한도보다 길면 잘라 말줄임표를 붙인다. */
const echoTitle = (title: unknown) => {
  const text = typeof title === 'string' ? title : ''
  if (text.length <= TITLE_MAX) return text
  // 한도 자리가 서로게이트 쌍의 가운데면 그 글자 앞에서 자른다(서버 `SplitDraftCheck.echoTitle`).
  const high = text.charCodeAt(TITLE_MAX - 1)
  const end = high >= 0xd800 && high <= 0xdbff ? TITLE_MAX - 1 : TITLE_MAX
  return `${text.slice(0, end)}…`
}
const dueAfterOriginal = (originalDue: string) => `원본 마감(${monthDay(originalDue)})보다 늦을 수 없어요.`
const dueBeforePrevious = (title: unknown, due: string) =>
  `이전 조각 "${echoTitle(title)}"(${monthDay(due)})보다 빨라요.`
const dueAfterNext = (title: unknown, due: string) =>
  `다음 조각 "${echoTitle(title)}"(${monthDay(due)})보다 늦어요.`

/** `YYYY-MM-DD`로 읽을 수 있는 날짜만. 읽을 수 없으면 마감 없음으로 본다(서버 `dateOrNull`). */
const dateOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? value
    : null
}

const validMinutes = (minutes: unknown): minutes is number =>
  Number.isInteger(minutes) && (minutes as number) >= MINUTES_MIN && (minutes as number) <= MINUTES_MAX
const validDifficulty = (difficulty: unknown): difficulty is number =>
  DIFFICULTIES.includes(difficulty as number)
/**
 * Java `String.isBlank`(`Character.isWhitespace`): 줄 바꿈 없는 공백(U+00A0, U+2007, U+202F)과 BOM은 공백이 아니다.
 * JS `trim()`은 둘 다 지우므로 쓰지 않는다.
 */
const isJavaWhitespace = (code: number) =>
  (code >= 0x09 && code <= 0x0d) ||
  (code >= 0x1c && code <= 0x20) ||
  code === 0x1680 ||
  (code >= 0x2000 && code <= 0x200a && code !== 0x2007) ||
  code === 0x2028 ||
  code === 0x2029 ||
  code === 0x205f ||
  code === 0x3000
const isBlank = (text: string) => [...text].every((char) => isJavaWhitespace(char.charCodeAt(0)))
const validText = (text: unknown, max: number) =>
  typeof text === 'string' && !isBlank(text) && text.length <= max

/** 계수가 정확히 1이면 그대로, 아니면 5분 단위로 올려 5분~24시간으로 자른다. 계수는 정수로 바꿔 곱한다. */
const calibrated = (minutes: number, factor: number) => {
  const scaled = Math.round(factor * 10000)
  if (scaled === 10000) return minutes
  const steps = Math.ceil((minutes * scaled) / (5 * 10000))
  return Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, steps * 5))
}

/** 조각 그래프. 간선은 `after`에서 없는 키를 뺀 것이고, 목록의 순서는 모두 받은 순서다. */
const graphOf = (pieces: DraftPiece[]) => {
  const keys = pieces.map((piece) => piece.key)
  const byKey = new Map(pieces.map((piece) => [piece.key, piece]))
  const order = new Map(keys.map((key, index) => [key, index]))
  const edges = new Map<string, string[]>()
  const unknown = new Map<string, string[]>()
  for (const piece of pieces) {
    const after = [...new Set(piece.after)]
    edges.set(piece.key, after.filter((key) => byKey.has(key)))
    unknown.set(piece.key, after.filter((key) => !byKey.has(key)))
  }
  const selected = (key: string) => byKey.get(key)!.selected

  const reaches = (from: string, target: string) => {
    const visited = new Set([from])
    const pending = [...edges.get(from)!]
    while (pending.length) {
      const current = pending.pop()!
      if (current === target) return true
      if (!visited.has(current)) {
        visited.add(current)
        pending.push(...edges.get(current)!)
      }
    }
    return false
  }

  const nearestSelected = (key: string) => {
    const found = new Set<string>()
    const visited = new Set([key])
    const pending = [...edges.get(key)!]
    while (pending.length) {
      const current = pending.pop()!
      if (visited.has(current)) continue
      visited.add(current)
      if (selected(current)) found.add(current)
      else pending.push(...edges.get(current)!)
    }
    return [...found].sort((a, b) => order.get(a)! - order.get(b)!)
  }
  const before = new Map(keys.map((key) => [key, selected(key) ? nearestSelected(key) : []]))

  const stages = new Map<string, number>()
  const onStack = new Set<string>()
  const stageOf = (key: string): number => {
    const known = stages.get(key)
    if (known !== undefined) return known
    onStack.add(key)
    let stage = 0
    for (const previous of before.get(key)!)
      if (!onStack.has(previous)) stage = Math.max(stage, stageOf(previous) + 1)
    onStack.delete(key)
    stages.set(key, stage)
    return stage
  }
  for (const key of keys) if (selected(key)) stageOf(key)

  return {
    before: (key: string) => before.get(key)!,
    stage: (key: string) => stages.get(key) ?? null,
    unknownAfter: (key: string) => unknown.get(key)!,
    inCycle: (key: string) => reaches(key, key),
    orderChoices: (key: string): SplitOrderChoice[] => {
      if (!selected(key)) return []
      const direct = edges.get(key)!
      const nearest = before.get(key)!
      return keys
        .filter((candidate) => candidate !== key && selected(candidate))
        .map((candidate) => {
          const link = direct.includes(candidate)
            ? 'DIRECT'
            : nearest.includes(candidate)
              ? 'VIA_EXCLUDED'
              : 'NONE'
          return {
            key: candidate,
            title: echoTitle(byKey.get(candidate)!.title),
            link,
            blocked: link !== 'DIRECT' && reaches(candidate, key),
          }
        })
    },
  }
}

const hasOwn = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key)

const dueErrorOf = (due: string | null, today: string, originalDue: string, duePassed: boolean) => {
  if (due === null) return MESSAGES.dueRequired
  if (duePassed) return due === originalDue ? null : MESSAGES.dueOriginalPassed
  if (due > originalDue) return dueAfterOriginal(originalDue)
  return due < today ? MESSAGES.dueBeforeToday : null
}

/**
 * 전제: 조각 key가 겹치지 않고 `after`·`selected`가 있다(핸들러가 먼저 거른다). `storedExclusions`는 저장된 제안에서
 * `exclusion`이 있던 조각만 든다. 결과의 조각은 받은 순서다.
 */
export const computeSplitCheck = (input: {
  pieces: DraftPiece[]
  storedExclusions: Record<string, StoredExclusion>
  factors: Record<string, number>
  originalDueDate: string
  today: string
  adminOnly: boolean
  action?: SplitDraftAction
}): SplitCheck => {
  const { pieces, storedExclusions, factors, originalDueDate, today } = input
  const graph = graphOf(pieces)
  const byKey = new Map(pieces.map((piece) => [piece.key, piece]))
  const duePassed = today > originalDueDate
  const dues = new Map(pieces.map((piece) => [piece.key, dateOrNull(piece.dueDate)]))
  const dueErrors = new Map(
    pieces.map((piece) => [
      piece.key,
      piece.selected ? dueErrorOf(dues.get(piece.key)!, today, originalDueDate, duePassed) : null,
    ]),
  )

  // 마감 순서: 바로 앞 조각 A와 이 조각 B의 마감이 A > B면 양쪽에. 어느 한쪽의 마감에 이미 오류가 있으면 그 쌍은 보지 않는다.
  const beforePrevious = new Map<string, string>()
  const afterNext = new Map<string, string>()
  for (const next of pieces) {
    const nextDue = dues.get(next.key)!
    if (!next.selected || dueErrors.get(next.key) !== null) continue
    for (const previousKey of graph.before(next.key)) {
      const previous = byKey.get(previousKey)!
      const previousDue = dues.get(previousKey)!
      if (dueErrors.get(previousKey) !== null || !(previousDue! > nextDue!)) continue
      if (!beforePrevious.has(next.key))
        beforePrevious.set(next.key, dueBeforePrevious(previous.title, previousDue!))
      if (!afterNext.has(previousKey)) afterNext.set(previousKey, dueAfterNext(next.title, nextDue!))
    }
  }

  let selectedCount = 0
  let totalMinutes = 0
  let overCount = 0
  let problemCount = 0
  const checks: SplitCheckPiece[] = pieces.map((piece) => {
    const calibratable = validMinutes(piece.minutes) && validDifficulty(piece.difficulty)
    const shownMinutes = calibratable
      ? calibrated(piece.minutes, factors[String(piece.difficulty)] ?? 1)
      : typeof piece.minutes === 'number'
        ? piece.minutes
        : 0
    const over = calibratable && shownMinutes >= LIMIT_MINUTES
    const errors: SplitFieldError[] = []
    if (piece.selected) {
      if (!validText(piece.title, TITLE_MAX)) errors.push({ field: 'title', message: MESSAGES.title })
      if (!validText(piece.description, DESCRIPTION_MAX))
        errors.push({ field: 'description', message: MESSAGES.description })
      if (!validMinutes(piece.minutes)) errors.push({ field: 'minutes', message: MESSAGES.minutes })
      if (!validDifficulty(piece.difficulty))
        errors.push({ field: 'difficulty', message: MESSAGES.difficulty })
      const dueError = dueErrors.get(piece.key) ?? beforePrevious.get(piece.key) ?? afterNext.get(piece.key)
      if (dueError) errors.push({ field: 'dueDate', message: dueError })
    }
    const afterError = graph.unknownAfter(piece.key).length
      ? MESSAGES.afterUnknown
      : graph.inCycle(piece.key)
        ? MESSAGES.afterCycle
        : null
    if (afterError) errors.push({ field: 'after', message: afterError })
    if (piece.selected) {
      selectedCount += 1
      totalMinutes += shownMinutes
      if (over) overCount += 1
    }
    if (errors.length) problemCount += 1
    const stored = hasOwn(storedExclusions, piece.key) ? storedExclusions[piece.key] : undefined
    return {
      key: piece.key,
      shownMinutes,
      over,
      stage: graph.stage(piece.key),
      before: graph.before(piece.key),
      errors,
      warnings:
        piece.selected && stored?.reason === 'DUPLICATES_OPEN'
          ? [
              {
                kind: 'OVERLAPS_OPEN_TASK',
                evidenceTaskId: stored.evidenceTaskId,
                evidenceTitle: stored.evidenceTitle,
              },
            ]
          : [],
      orderChoices: graph.orderChoices(piece.key),
    }
  })

  const cannotApplyReason = input.adminOnly
    ? 'ADMIN_ONLY'
    : selectedCount === 0
      ? 'NOTHING_SELECTED'
      : problemCount > 0
        ? 'HAS_PROBLEMS'
        : null
  const { action } = input
  return {
    pieces: checks,
    selectedCount,
    totalMinutes,
    overCount,
    problemCount,
    canApply: cannotApplyReason === null,
    cannotApplyReason,
    emptyReason:
      selectedCount > 0
        ? null
        : pieces.every((piece) => hasOwn(storedExclusions, piece.key))
          ? 'ALL_EXCLUDED_BY_AI'
          : 'ALL_REMOVED_BY_MEMBER',
    accepted: !action
      ? null
      : action.type !== 'CONFIRM'
        ? true
        : checks.filter((c) => c.key === action.key).every((c) => c.errors.length === 0),
    limits: {
      titleMax: TITLE_MAX,
      descriptionMax: DESCRIPTION_MAX,
      minutesMin: MINUTES_MIN,
      minutesMax: MINUTES_MAX,
      dueMin: duePassed ? originalDueDate : today,
      dueMax: originalDueDate,
    },
  }
}
