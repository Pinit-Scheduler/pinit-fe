# Motion contract

Pinit is a planner where you pin work into time. Its motion is steady, precise and quietly satisfying. Motion is short and decelerating. It never bounces or loops, and every movement explains a change the person caused or is waiting for.

The one signature moment is completing a task or schedule. The box fills with the accent, the tick draws like a pen stroke, and a strike line runs left to right across the title. Then the row settles into the muted completed style. Reopening reverses this quickly.

[flicker-audit.md](flicker-audit.md) lists what used to flicker, how it was fixed and what is still open. This page is the contract that keeps it fixed.

## Tokens

The tokens are defined once, in `src/shared/styles/motion.css`, which `src/main.tsx` imports before any feature CSS. `src/shared/motion/tokens.ts` mirrors the values that code needs to wait for or play an animation. A test keeps the two files in step.

| Token | Value | Use |
|---|---|---|
| `--motion-ease` | `cubic-bezier(0.2, 0, 0, 1)` (`MOTION_EASE`) | Everything that enters or changes |
| `--motion-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Things that leave |
| `--motion-fast` | 120ms (`MOTION_FAST_MS`) | Hover, press, reopen, small color changes |
| `--motion-base` | 180ms (`MOTION_BASE_MS`) | Fades, backdrops, fills |
| `--motion-enter` | 240ms (`MOTION_ENTER_MS`) | Panels, rows and pages entering |
| `--motion-exit` | 160ms (`MOTION_EXIT_MS`) | Anything leaving; delayed unmounts wait this long |
| `--motion-distance` | 8px (`MOTION_DISTANCE_PX`; 0 under reduced motion) | Travel of a rise or drop |
| `--motion-press-scale` | 0.98 (1 under reduced motion) | `:active` scale of buttons, chips, rows and cards |
| `--motion-press-scale-small` | 0.94 (1 under reduced motion) | `:active` scale of icon buttons, compact tiles and the completion check |
| `--motion-stagger` | 24ms (`MOTION_STAGGER_MS`) | Delay between rows that arrive together |
| `--motion-stagger-section` | 40ms | Delay between the few sections of a page or modal |
| `--motion-flash` | 1200ms (`MOTION_FLASH_MS`) | Highlight on a row that changed |
| `--motion-strike-delay` | 80ms (`MOTION_STRIKE_DELAY_MS`) | The strike line starts this long after the check |
| `--motion-status-delay` | 150ms | Wait before a loading indicator appears |
| — | 480ms (`COMPLETION_HOLD_MS`) | A just-completed row keeps its place this long before a refresh may remove it (strike delay + enter + exit) |

Shared keyframes live only in `motion.css`: `motion-fade-in`, `motion-fade-out`, `motion-rise-in`, `motion-rise-out`, `motion-drop-in`, `motion-sheet-in`, `motion-sheet-out` and `modalSlideUp` (modal panels, twice the distance). Never define a keyframe with one of these names anywhere else; a test fails if you do.

## The render rule

Every screen that loads data renders like this:

```tsx
isInitialLoading ? <StatusPanel variant="loading" title="…" />
: error && data === undefined ? <StatusPanel variant="error" title={error} action={retry} />
: <Content data={data} aria-busy={isRefreshing || undefined} />
```

- **Loading** shows only when there is no data at all for the current key, on a first load or a new filter, date or space. A refetch never swaps content for a placeholder.
- **Refreshing** leaves the content mounted. Show it only as `aria-busy`, or with a quiet sign in a header. Never dim or blank the list.
- **Error with data on screen**: keep the content and show the server's message inline or as a toast. Error text belongs to the backend: pass `error` through unchanged and do not reword it.
- **Never show another key's data.** If the date changes from the 4th to the 5th, the 4th's rows must not render under the 5th's heading. Stale data for the same key is fine.

## Which primitive, when

| You need | Use | Path |
|---|---|---|
| Data that refetches on changes | `useRevalidatingQuery` | `src/shared/hooks/useRevalidatingQuery.ts` |
| A listener for task/schedule changes | `onDataChanged` (or `onTaskChanged`, `onScheduleChanged`) | `src/shared/utils/events.ts` |
| A modal or popover that should fade out | `usePresence` plus `Modal closing` | `src/shared/motion/usePresence.ts`, `src/shared/components/common/Modal.tsx` |
| A list where rows are added or removed | `useListPresence` plus `presenceProps` | `src/shared/motion/useListPresence.ts` |
| A completion checkbox | `CompletionCheck` plus `.motion-strike` | `src/shared/components/motion/CompletionCheck.tsx` |
| A list rendered as `<ul>` whose rows come and go | `PresenceList` | `src/shared/components/motion/PresenceList.tsx` |
| A quiet "saved" tick | `SavedMark` | `src/shared/components/motion/SavedMark.tsx` |
| A loading, error or empty state | `StatusPanel` (the delay and fade are built in) | `src/shared/components/common/StatusPanel.tsx` |
| A number that changes in place | `useTweenedNumber`, or `TweenedNumber` (rounds unless given `format`) | `src/shared/motion/useTweenedNumber.ts`, `src/shared/components/motion/TweenedNumber.tsx` |
| An entrance only for content the screen waited for | `useArrival` plus `data-arrive` | `src/shared/motion/useArrival.ts` |
| Animate only a change made while something is on screen | `useChangedWhileMounted` | `src/shared/motion/useChangedWhileMounted.ts` |
| Replay a rise on content that changed in place | `playRise` | `src/shared/motion/playRise.ts` |
| A link that opens a route surface | `surfaceLinkClick(open, path)` (`isPlainLeftClick` for other links) | `src/shared/routing/linkClick.ts` |
| A toast | `useToast().addToast` (enter and exit are built in) | `src/shared/contexts/ToastContext.tsx` |
| Route surfaces, tab changes, scroll reset | Nothing. The shell does it | `src/app/App.tsx`, `AppShell.tsx`, `RouteSurface.tsx` |

### Data: `useRevalidatingQuery`

```ts
const { data, error, isInitialLoading, isRefreshing, refetch, setData } =
  useRevalidatingQuery(
    `today/${dayKey}@${zoneId}/${spaceId ?? 'all'}`, // the key names everything the fetch depends on
    (signal) => fetchToday(dayKey, { signal }),
    {
      invalidateOn: ['task', 'schedule'], // coalesced events
      group: 'today/',                   // optional: an event also marks other cached days stale
      shouldRefetch: (batch) => true,    // optional filter, e.g. ignore other tasks' ids
      refetchOnFocus: false,
      errorMessage: '오늘 일정을 불러오지 못했어요.', // this screen's sentence; the default is '불러오지 못했어요.'
    },
  )
```

- `errorMessage` is the action sentence passed to `getRequestFailureMessage`: the server's message wins when there is one, and the sentence plus a retry hint covers a failure without one.

- `data` belongs to the key. When the key changes to one that is not cached, `data` is `undefined` and `isInitialLoading` is true. When it changes to a cached key, the cached data shows at once and `isRefreshing` is true while it revalidates.
- The cache is module-level and scoped by account. Going back to a screen shows its last data straight away. It is cleared when the signed-in member or the display zone changes.
- A response that started before an invalidation is dropped, so data from before a mutation cannot reappear.
- `refetch()` forces a fresh read. `setData(update)` patches the cached value, for example for an optimistic toggle in a list.
- Pass `null` as the key to load nothing.

### Events: one notification per action

`dispatchTaskChanged` and `dispatchScheduleChanged` fire plain window events. Subscriptions are coalesced: every event dispatched in the same task, including after `await`s inside it, reaches each listener as one call at the end of the task.

```ts
useEffect(() => onDataChanged(({ tasks, schedules }) => reload()), [reload])     // both kinds, one call
useEffect(() => onTaskChanged((detail, details) => …), [])                      // detail = fields all events share
```

- A listener that reacts to both kinds uses `onDataChanged`, not `onTaskChanged` plus `onScheduleChanged`. Otherwise it reloads twice.
- If you need per-event information such as `reason` or `taskId`, read the `details` array or the batch. `detail` keeps only the fields that every batched event shares.
- After a dispatch, do not also call `refetch()`. The event already does that.
- Only real data changes dispatch. `useActiveSchedule` does not fire `task:changed`.
- The realtime stream refetches once after every successful connect, the first one included. The server starts a new connection at its latest change (pinit-monolith PR #237), so changes committed between a view's first read and the connect are not replayed, and a reconnect may have missed some in the gap. That refetch goes through the same 150 ms debounce as live events, so it is one refetch per (re)connect.
- The stream skips the global refetch for the echo of a save this client just made: `dispatch*Changed` with an id records the save, and `takeLocalEcho` matches one server event to it.

### Surfaces and modals

The route surfaces (`/app/tasks/:id`, `/app/tasks/new`, `/app/schedules/...`) are handled for you:

- **Desktop:** the backdrop fades in and the panel rises.
- **Mobile (under 900px):** the panel slides up as a sheet.
- **Close:** close, Escape, a click on the backdrop and browser back all play the exit before unmounting. Focus returns to the opener as the exit starts. The scroll lock and the shell's `inert` are released in the same frame.
- **Moving between surfaces:** going from detail to edit, or from task 5 to task 6, keeps the same surface and crossfades only the page inside. Do not add a `key` to `RouteSurface`.
- **Opening:** use `useRouteSurfaceNavigation().open(path)`. For a `<Link>` that should stay a real link, add `onClick={surfaceLinkClick(open, path)}`. A plain link keeps the last page behind the surface, but only `open()` records where to return to.
- **Closing after a replace:** a surface reached by a replace navigation from a page (the onboarding tour does this) took that page's history entry. Closing it goes to that page with a replace instead of stepping back past it (`surfaceCloseAction` in `routeSurfaceState.ts`).

For your own `Modal`, keep it mounted through its exit:

```tsx
const presence = usePresence(selectedTask)             // or usePresence(isOpen)
return presence.mounted && presence.value ? (
  <Modal closing={presence.closing} onClose={() => setSelectedTask(null)} …>
    {presence.value.title}                               {/* last value stays during the exit */}
  </Modal>
) : null
```

- `Modal` adds `data-motion-surface`, `data-state` and `inert`. The exit animation comes from `motion.css`; your modal CSS keeps its own entrance (`motion-fade-in` on the backdrop, `modalSlideUp` on the panel).
- Pass `usePresence` a stable value: state, a prop or a memoized object. An object literal built during render loops.
- Replace `if (!isOpen) return null` inside a modal component with `usePresence(isOpen)`.
- Pass `sheet` to `Modal` if it should slide up as a sheet on mobile.

### Lists: `useListPresence`

```tsx
const rows = useListPresence(data?.tasks, (task) => task.id, { resetKey: filterKey })
return (
  <ul className="task-page__list">
    {rows.map(({ key, item, phase }) => (
      <li key={key} {...presenceProps(phase)}>
        <WorkspaceTaskCard task={item} … />
      </li>
    ))}
  </ul>
)
```

- Pass `undefined` while the first load is pending. The first list it receives is the baseline and does not animate.
- **Inserted rows** rise in over 240ms. **Removed rows** fade out where they were over 160ms, ignore input and are hidden from assistive tech.
- A refetch that returns the same ids animates nothing, so animations never replay.
- Change `resetKey` (filter, sort, date, space) to start a new baseline instead of animating the whole swap.
- Never put `animation:` on a list container or a page root. It replays on every remount.
- The rows that stay do not glide into the gap a removed row leaves. They move up when it unmounts. There is no FLIP layout animation yet.

### Completion: `CompletionCheck` and `.motion-strike`

`WorkspaceTaskCard` is the reference implementation. It toggles optimistically, rolls back on error and never dims while a save is pending.

```tsx
const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null)
const shownDone = optimisticDone ?? done
const toggle = async () => {
  if (lock.current) return                 // re-entry guard instead of disabled
  lock.current = true
  setOptimisticDone(!done)
  try { /* save, setTask(saved), dispatch */ }
  catch (e) { setError(serverMessage(e)) } // optimistic value is cleared below: the check rolls back
  finally { lock.current = false; setOptimisticDone(null) }
}

<CompletionCheck
  checked={shownDone}
  disabled={!allowedByServer}              // permission only, never `pending`
  onChange={() => void toggle()}
  label={title + (shownDone ? ' 완료 취소' : ' 완료')}
  shape="round"                            // or "square"
/>
<button className="…__title"><span className="motion-strike" data-done={shownDone || undefined}>{title}</span></button>
```

- `.motion-strike` goes on an **inline** element that wraps the text. The line is the inline's background, sized from 0 to 100%. Unlike a `scaleX` pseudo-element, it follows wrapped lines, and task titles wrap.
- Mute the row with a `color` transition (`var(--motion-base) var(--motion-ease)`) on the completed class. Never fade the row's opacity, and never change its height.
- Tune the look with custom properties: `--check-size`, `--check-accent`, `--check-line`, `--check-surface` and `--check-mark`.
- `ScheduleCard` and the mini player read the state from `actions.currentState`, not from the prop, so a completion shows before the save lands. While any schedule saves, `actions.isLocked` makes every card ignore presses; no control is disabled or dimmed for it.

### StatusPanel, toasts and numbers

- **`StatusPanel` loading** stays invisible for 150ms, then fades in. A fast load shows nothing. Error and empty states fade in at once.
- **Toasts** drop in from the top and fade out on dismiss. A repeated message updates the toast already on screen instead of popping a new one.
- **`useTweenedNumber(value)`** returns a number that glides to the new value over 240ms. Round or format it yourself. Use it for counts and totals that change while the person watches, not for every number on the screen.

## Tab changes and scroll

- **Tab change:** the sidebar and bottom-tab links call `tabLinkClick(path)` (`src/shared/routing/viewTransitionNavigation.ts`). Only `.app-shell__content` crossfades: the old page fades out and the new page rises in. The sidebar, top bar, bottom tab, mini player and toasts keep their own view-transition names and stay still.
- **Why not `viewTransition` on a link:** every page renders inside descendant `<Routes>`. There, react-router's `Link` and `NavLink` use the plain navigator, which silently drops `viewTransition`. To animate another link, give it `onClick={tabLinkClick(path)}`, which uses the data router's navigate.
- **No View Transitions support:** the content fades up with the Web Animations API instead.
- **Back and forward:** browser back and forward between tabs, and programmatic `navigate()` calls, change the page with no transition.
- **Scroll:** a new background page starts at the top. Opening a surface keeps the page's scroll.

## Time zone changes

A new display zone (from `useMemberZoneSync` or a settings save) resets zone-scoped state in place. Only an account change re-keys the providers.

- `useTimePreferences().zoneKey` (zone id plus offset) changes with the zone.
- The query store is cleared in the render that sees the new zone. `TaskCacheProvider` and `ScheduleCacheProvider` empty themselves through `resetKey`; the running schedule is kept. `ScheduleViewStateProvider` goes back to today.
- Only the page remounts: AppShell's `Outlet` and the surface `Routes` are keyed by `zoneKey`, because pages keep zone-derived `useState`. The shell, the mini player and the realtime connection stay mounted.
- Any `useRevalidatingQuery` caller must live inside a page or a surface. A subscriber in the shell would keep a cleared entry.

## Do

- Animate only `transform`, `opacity`, `color`, `background`, `border-color` and `stroke`. List the properties you transition by name.
- Use the tokens. Use fast for feedback, enter for arrivals and exit for departures.
- Tie every animation to a change the person made or is waiting for.
- Keep content mounted through refreshes. Unmount only when the data for the current key has actually gone.

## Don't

- Don't use `transition: all`, bouncy or overshooting curves, or loops (`infinite`) on anything that is not live.
- Don't animate `width`, `height`, `top`, `left`, `margin` or large blurs.
- Don't put a mount animation on a page root or list container.
- Don't re-key a subtree to restart an animation.
- Don't disable controls while a save is pending just to block double clicks. Use a ref lock.
- Don't add another `@keyframes` with a shared name, or a new motion library.
- Don't reword server error messages.

## Reduced motion

- **One mechanism, in `motion.css`:** under `prefers-reduced-motion: reduce` every animation and transition is cut to 0.01ms, `--motion-distance` goes to 0 and both press scales to 1. An element whose fade should stay sets `--motion-keep-animation` or `--motion-keep-transition` to the duration it keeps, inside its own reduced-motion block; no `!important`. Every element resets both to 0.01ms (zero specificity, so any opt-in wins on the element itself), so the element's children stay cut; the `@property` registration with `inherits: false` is a second guard for browsers that support it.
- **Sheets:** `motion-sheet-in` and `motion-sheet-out` travel the full panel height, not `--motion-distance`, so under reduced motion a mobile sheet uses `motion-fade-in` and `motion-fade-out` instead. A keyframe that moves by a fixed amount must get the same treatment wherever its duration is restored. A test checks the shared rules.
- **Completion:** the tick fades in whole instead of drawing, and the strike line appears with a color fade.
- **New primitives:** keep the same rule. Opacity fades stay, movement goes. Never rely on an animation event to unmount: the presence hooks use timers.

## Checking a change

- Run `npm run lint`, `npm test` and `npm run build`. The tests run hooks and render markup without a DOM; stylesheet rules (tokens, named transitions, no loops, reduced motion) are read from the CSS files.
- Run the app in mock mode (`VITE_USE_MOCK_API=true` in `.env.local`, then `npm run dev`; sign in as `demo` / `demo1234`). Create, complete, reopen and delete something on the page. Nothing should blink, and a list should never show "불러오는 중" after its first load.
- In the console, `__pinitMock.setLatency(400)` slows every mocked response (it survives a reload), and `__pinitMock.remote.completeTask(id)` (or `reopenTask`, `renameTask`, `createTask`, `deleteTask`) makes a teammate's change arrive over SSE.
- Repeat with reduced motion turned on.
