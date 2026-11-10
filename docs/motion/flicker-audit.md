# Flicker and motion audit

Read-only audit of origin/master 5707165 (2026-11-10). Six readers, one per area. Paths are relative to the repo root.


## Area: routing

The routing and shell code does not remount the background page on tab changes or on surface open/close. The flicker comes from five things, in order of impact:

1. Surfaces appear and disappear in one frame, with a full-screen dim and blur, or an opaque white layer on mobile.
2. Each tab change swaps the whole page under `<Outlet/>` and never resets scroll.
3. Surfaces opened with a plain `<Link>` swap the background page to a different route.
4. A one-time full remount of the app happens when the server's time zone differs from the stored one.
5. Effect cleanups that run a frame late leave the bottom tab bar and mini player hidden for one extra frame after closing on mobile (suspected).

Paths are relative to `C:/Users/chkun/Documents/GitHub/pinit-fe-motion`. Versions checked: react-router 7.9.6, React 19.2. I read the react-router source in `node_modules` to confirm how it renders.

### Confirmed from code

**C1. Surfaces mount and unmount instantly, with nothing to fade.**
- **Where:**
  - `src/app/App.tsx:114-145` renders the surface `<Routes>` only while `surface` is true.
  - `src/shared/components/common/Modal.tsx:136-152` renders inline, with no portal, no open/closing state and no exit delay.
  - `src/shared/routing/RouteSurface.css:1-12` adds a full-viewport backdrop: `rgb(15 23 42/0.35)` plus `backdrop-filter: blur(2px)`.
  - `RouteSurface.css:125-130` makes the backdrop opaque `var(--c-surface)` on screens under 900px.
- **Effect:**
  - **Opening:** the whole app goes dim and blurred in one frame; on mobile it turns white in one frame.
  - **Closing:** `complete()` → `close()` (`src/shared/routing/RouteSurface.tsx:56-75`) → `navigate(-1)`. On popstate `surface` becomes false and the layer is removed in one frame.
  - On mobile this looks like a page swap.
- **Fix:**
  - Add an open/closing state to `RouteSurface`/`Modal`, with a backdrop opacity and blur fade and a panel scale/translate of about 150–200ms.
  - Delay unmounting until `animationend`/`transitionend`. One way: keep the last surface element in state during the exit, so `{surface && ...}` does not drop it immediately.
  - Alternatively, pass `viewTransition` to `open()`/`close()`. react-router's navigate supports this, and it uses `document.startViewTransition`.
  - On mobile, slide up/down instead of swapping in an opaque layer.

**C2. Tab navigation (`/app/today` → `/app/tasks`) remounts the page, not the shell.**
- **Where:**
  - `App.tsx:95-113`: the background `<Routes location={base}>` keeps the `AppShell` layout route mounted.
  - Only the child under `<Outlet/>` (`src/shared/components/layout/AppShell.tsx:189`) changes component type: `TodayPage` unmounts and `TaskListPage` mounts fresh.
  - react-router does not key `RenderedRoute` (`node_modules/react-router/dist/development/chunk-4WY6JWTD.mjs:5765`), so it is the component type change that triggers the remount.
- **Effect:**
  - The new page mounts with empty or loading state and fetches, giving a blank or loader frame, then the content.
  - There is no enter transition.
  - `TopBar` and `NavLink` keep their nodes; only text and class change.
- **Fix:**
  - Fade the content in on route change.
  - Make sure pages render from the cache (`TaskCacheContext`/`ScheduleCacheContext`) first instead of a loader. That is in the pages area.

**C3. Scroll position is never reset.**
- **Where:** the scroll container is `main.app-shell__content` (`AppShell.tsx:184`, `AppShell.css:22-30`, `overflow-y: auto`). It persists across tabs. There is no `ScrollRestoration`, `scrollTo` or `scrollTop` reset anywhere in `src`; I searched for all three.
- **Effect:** the new page renders at the previous page's `scrollTop`. When it goes from loader to content, the height changes, the browser clamps the scroll, and the content jumps.
- **Fix:** in `AppShell`, run a `useLayoutEffect` on the background pathname that sets `.app-shell__content` `scrollTop = 0`. Alternatively, save and restore scroll per `location.key`.

**C4. Surfaces opened with a plain `<Link>` (no `backgroundLocation`) swap the background page.**
- **Where:**
  - `App.tsx:70-81`: with no background state, `base` becomes a synthetic location with `pathname: surfaceFallback(...)` and `key: 'surface-base'`.
  - `surfaceFallback` is at `src/shared/routing/routeSurfaceState.ts:10-11`: `/app/tasks` or `/app/schedules`.
  - Offending links:
    - `src/features/task-map/TaskMapPage.tsx:359, 516, 704, 729`
    - `src/features/recurrence/pages/RecurrencesPage.tsx:265, 272`
    - `src/features/planner/pages/PlanPage.tsx:1048`
  - `DeadlineRiskItem` does pass `state={{backgroundLocation}}`, so it is fine.
- **Effect:**
  - On open, the background switches routes, e.g. from TaskMap to TaskListPage. That is a full page swap behind the 35% dim on desktop.
  - The sidebar and bottom-tab highlight and the TopBar title jump.
  - On close, `close()` finds no background and calls `navigate('/app/tasks', {replace:true})`, so the user lands on a different page than they started from.
  - The synthetic location is also a new object on every `WorkspaceRoutes` render.
- **Fix:**
  - Route these links through `useRouteSurfaceNavigation().open()`, or pass `state={{ backgroundLocation: location }}`.
  - As a fallback, when there is no background, use the last non-surface location instead of a fixed fallback pathname.
  - Memoize the synthetic location.

**C5. Changing the time zone remounts the whole router tree.**
- **Where:**
  - `App.tsx:203`: `TaskCacheProvider key={`${zoneId}:${actor ?? 'guest'}`}`.
  - `App.tsx:205`: `ScheduleViewStateProvider key={offsetMinutes}`.
  - Trigger: `src/features/settings/hooks/useMemberZoneSync.ts:13-23` runs once per `AppShell` mount. If the server zone differs from the one in localStorage, it calls `applyZone` (`src/shared/contexts/TimePreferencesContext.tsx:34-39`).
  - Also triggered by a settings save (`ProfileSettingRows.tsx:98`).
- **Effect:**
  - `RouterProvider` and everything below it remounts: `AppShell`, the page and the cache, all refetching.
  - This looks like a reload, typically right after login on a new device or after another device changed the zone.
  - `actor` does not change on token refresh, because the subject is the same and React bails out on the equal state. So this is not a per-navigation cause.
- **Fix:**
  - Hold the first paint until the profile zone is known; `isLoading` is hard-coded to `false` at `TimePreferencesContext.tsx:46`.
  - Or invalidate the caches instead of re-keying providers.
- **Status, 2026-11-10:** fixed. Only the account keys the providers now. A zone change clears the query store and the task and schedule caches in place (the running schedule is kept), and resets the schedule view to today in place. Only the page content remounts: AppShell's `Outlet` and the surface `Routes`, keyed by `zoneKey`. A full in-place reset with no remount at all is not safe, because date helpers read a module-level display zone and pages hold zone-derived `useState` (for example `ScheduleDependencyModal`'s selected date) without subscribing to the zone. The shell, mini player and realtime connection stay mounted. See `tests/motion-zone-reset.test.mjs`.

**C6. `key={location.pathname}` on `RouteSurface` forces the modal shell to remount (`App.tsx:84`).**
- **Effect:**
  - Detail → edit (`TaskDetailModal.tsx:328`, `ScheduleDetailModal.tsx:236`) and `/app/tasks/5` → `/app/tasks/6` remount the backdrop, header and footer.
  - The `Modal` effect pops and pushes its stack entry, toggles `body.style.overflow`, and moves focus.
  - The captured `opener` (`Modal.tsx:51-55`) is a node inside the old modal, so focus restoration on the final close fails.
  - Without the key, react-router would reuse `RouteSurface`, because `RenderedRoute` is unkeyed and only the inner page would remount.
- **Fix:**
  - Drop the key, or key by surface "session" instead of pathname, and reset `dirty`/`allowExitRef` on pathname change in an effect.
  - Then animate only the body content, e.g. a crossfade of `.route-surface__body`.

**C7. On initial entry from a public route, `AuthGuard` renders nothing.**
- **Where:** `src/features/auth/components/AuthGuard.tsx:8, 50`. `isReady` starts `false` and is set in `useEffect`. With an expired token it waits for the network refresh.
- **Effect:** one blank frame, or a blank screen until the refresh finishes, when entering from `/login` or `/`. It does not recur on `/app/*` navigation: the pathless layout route stays mounted and the `navigate` from the data router is stable.
- **Fix:** initialize with `useState(() => !isLoggedOut() && !!token && !isAccessTokenExpired(token))`, and show a skeleton instead of `null`.

**C8. Opening a surface the normal way, and the create flow, do not remount the background page.**
- **Open (`/app/tasks` → `open('/app/tasks/new')`):**
  - `base = safeBackground(state)`, a clone of `/app/tasks` taken from `history.state`.
  - It matches the same route and element, so `TaskListPage` stays mounted and only re-renders.
- **Re-render source:**
  - `<Routes location>` always wraps its output in a new `LocationContext` value with `navigationType: "POP"` (react-router source above, lines 5575-5592).
  - So every `useLocation` consumer in the background re-renders on each `WorkspaceRoutes` render.
  - `SpacesPage.tsx:363-369` keys an effect on `location.key`. It is stable here, because back-navigation restores the original key.
- **Create (`TaskCreatePage.tsx:127-129`):**
  - The page calls `setTask(created)` and `dispatchTaskChanged(created.id,'create')`, then `complete('/app/tasks')`, which does `navigate(-1)`.
  - The background reuses the same instance, and the surface is removed instantly (C1).
  - Then the realtime echo arrives: `WorkspaceRealtime.tsx:24` calls `workspaceChanged` after 150ms (`src/features/spaces/store.ts:239-243`).
  - That runs `reloadSpaces` plus `dispatchTaskChanged` and `dispatchScheduleChanged` again, which is a second refetch of every list.
  - If list pages show a loader on refetch, the list flickers twice. That is in the pages area and not verified here.

**C9. Layout shifts in the shell between routes and data loads.**
- `AppShell.tsx:187` shows `InstallBanner` only on `/app/today`, which moves content when entering or leaving Today.
- `SpaceContextBar` (`SpaceChrome.tsx:246-286`) renders different content per path, `null` on `/app/spaces`, and a `<details>` only after the spaces purpose has loaded.
- The `MiniPlayerBar` height feeds `--workspace-player-height` into the content's bottom padding (`AppShell.tsx:71-103`).
- **Fix:** reserve or min-height these slots, or animate them (height/opacity).

### Suspected (plausible, not verified at runtime)

**S1. The bottom tab bar and mini player flash after a surface closes (mobile).**
- **Why:**
  - react-router applies navigations inside `React.startTransition` (`chunk-4WY6JWTD.mjs:6229-6233`), so passive effects run after paint.
  - `RouteSurface`'s cleanup that removes `.app-shell[inert]` and `body[data-route-surface-input]` (`RouteSurface.tsx:127-136`) is a `useEffect`. The same goes for `Modal`'s `body.style.overflow` restore.
  - `AppShell.css:275-282` hides `.bottom-tab` and `.mini-player-wrapper` while that attribute is set, so for at least one painted frame after the modal is gone they are still hidden.
  - The `ResizeObserver` then updates `--workspace-player-height` a frame later, so the content padding jumps.
- **Fix:** use `useLayoutEffect` for these DOM side-effects, or drive them from CSS `:has()` alone. `body:has([role='dialog'] form)` already exists in the same rule.

**S2. The shell `MutationObserver` runs on every DOM mutation.**
- **Where:** `AppShell.tsx:92` observes the whole shell subtree with `childList: true, subtree: true`.
- **Effect:** on every mutation it disconnects and re-observes the `ResizeObserver` and calls `setProperty` on two CSS variables. That means extra style work during page swaps. This is a performance concern, not a proven flicker cause.

**S3. Desktop scrollbar shift.** `body.style.overflow='hidden'` (`Modal.tsx:64-67`) could shift layout if the body ever has a scrollbar. It probably does not, because `.app-shell` is 100dvh with overflow hidden.

**S4. `app-shell--editing` never activates for surfaces.** `AppShell.tsx:170`/`140` reads `pathname` from the background location, so the class is never set for surfaces. The mobile rules for it are dead for surfaces and only the body data attribute applies. This is harmless, but it is why S1 matters.

### Existing motion in this area
- There are no motion tokens: no `--motion`, `--ease` or `--duration`.
- There are no transitions or keyframes in `src/shared/routing/*.css` or `src/shared/components/layout/*.css`.
- The only animation is the spinner in `src/app/App.css:20, 33-40` (`app-loading-spin`). It is effectively dead, because `isLoading` is always `false`, so `InitialLoadingScreen` never renders.
- `src/index.css:95-103` has a global `prefers-reduced-motion` override (0.01ms) that will cover new animations automatically.
- `src/features/spaces/spaces.css:529` has a `transition: none`.
- Z-index tokens are in `src/index.css:15-21`: topbar 10, mini-player 90, bottom-tab 100, fab 110, modal-backdrop 200, onboarding 300, toast 999.
- No Suspense or lazy routes, so there are no fallbacks.
- No view transitions are used, though react-router 7.9.6 supports the `viewTransition` option.


## Area: data-loading

## Flicker audit: data fetching and loading states (pinit-fe-motion, read-only)

### Root cause

Almost every list or detail hook handles a refetch the same way it handles a first load. It sets a loading flag (or bumps a key that throws the old data away), and the page then shows the loading branch (`StatusPanel` or a "불러오는 중" placeholder) instead of the existing rows. Create, complete, update, delete and restore actions, realtime space events, and window focus all fire `task:changed` / `schedule:changed`. Every mounted hook hears these events, so each action briefly blanks one or more panels. Three things make it worse: the same action fires the events more than once, `useActiveSchedule` fires `task:changed` on every focus, and the day-list cache is lost when you leave the page.

Labels used below: **CONFIRMED** means read directly from the code. **SUSPECTED** means it follows from the code but I did not run the app.

### A. Refetch swaps existing content for a loading branch

**A1. useScheduleList (CONFIRMED, the main flash in the 일정 tab)**
- **Flag:**
  - `src/features/schedules/hooks/useScheduleList.ts:30-32`: `refetch()` empties the whole `cacheRef` and sets `{schedules: [], isLoading: true}`.
  - `:42`: after that, `isLoading: !cached` is always true, because the cache is now empty.
  - `:19`: `cacheRef` belongs to one mounted instance. Going back to `/app/schedules` always loads from nothing.
- **Trigger:** `:36` `onScheduleChanged(refetch)`.
- **Swap:** `src/features/schedules/pages/tab/SchedulesTabPage.tsx:170` and `:558-559`. The cards are replaced by `<StatusPanel variant="loading">` and the `ScheduleCard`s unmount. Also:
  - `:495` hides the hidden-count note.
  - `:348` turns drag off.
  - `ScheduleDependencyModal.tsx:36` uses the same hook.
- **Fix:**
  - Do not delete cache entries. Mark them stale with a generation number.
  - On refetch, keep the current key's `schedules` and return `isRefreshing: true` with `isLoading: false`.
  - On a date switch, show that date's stale entry if one exists. Leave the existing `sequence` guard as it is.
  - Move the day-list cache to module level or into `ScheduleCacheContext`, keyed by `${dateKey}@${zoneId}`, so it survives leaving the page.

**A2. useWeeklySchedulePresence (CONFIRMED)**
- **Flag:** `src/features/schedules/hooks/useWeeklySchedulePresence.ts:39`. `setIsLoading(true)` runs on every refetch (event at `:105`). It also runs on every date click, because `anchorDate` is in the deps at `:102` and the page passes `selectedDate` (`SchedulesTabPage.tsx:113`).
- **Swap:** `SchedulesTabPage.tsx:170` and `:558`. `isPresenceLoading ||` blanks the day list even when that day's data is cached and unchanged.
- **Fix:**
  - Remove `isPresenceLoading` from the day-list branch at `:558` and from `:170`. Presence only feeds the date-strip dots.
  - Show loading only when `loadedKey !== audienceKey`.
  - SUSPECTED: keying the deps on a week string instead of `anchorDate` would stop the refetch inside one week. This assumes the weekly API returns the same week for any date in it.

**A3. useOverdueSchedulesSummary (CONFIRMED, also causes a layout jump)**
- **Flag:** `src/features/schedules/hooks/useOverdueSchedulesSummary.ts:28`. `setIsLoading(true)` runs on every `schedule:changed` (`:82`).
- **Swap:** `SchedulesTabPage.tsx:355-356`. The banner, or nothing, is replaced by a `StatusPanel` titled "미완료 일정 정보를 불러오는 중", which pushes the whole page down and then back up.
- **Fix:** Show that panel only before the first load for the current audience. During a refresh, keep the previous `summary`.

**A4. useWeeklyStatistics (CONFIRMED)**
- **Flag:** `src/features/statistics/hooks/useWeeklyStatistics.ts:43`, on `schedule:changed` (`:88`).
- **Swap:** `SchedulesTabPage.tsx:419-420`. "이번 주 총 작업 X" becomes "불러오는 중...".
- **Fix:** Render the loading text only when `isLoading && !current`.

**A5. useScheduleDetail (CONFIRMED)**
- **Flag:** `src/features/schedules/hooks/useScheduleDetail.ts:43`. `setIsLoading(true)` runs on every `schedule:changed` (`:29`, where `refreshOnChange` defaults to true). `:55` also clears `schedule` on error.
- **Swap:** `src/features/schedules/components/modals/ScheduleDetailModal.tsx:114-128`. The whole modal body becomes "일정 정보를 불러오는 중...".
- **Triggers:**
  - MiniPlayerBar start/complete.
  - Realtime `workspaceChanged` (`src/features/spaces/store.ts:241-242`).
  - Space scope reload (`store.ts:160-161`).
- **Fix:** Set `isLoading` only when `schedule == null` or `numericId` changed. Expose `isRefreshing` for later refetches, and keep the last good `schedule` when a refresh fails.

**A6. TaskDetailModal (CONFIRMED, flashes itself when you complete a task in it)**
- **Flag:**
  - `src/features/tasks/components/TaskDetailModal.tsx:67`: every `task:changed` bumps `revision`.
  - `:82`: `setIsLoading(true)` runs even though `task` is already showing.
  - `:118`: `toggleCompletion` calls `setTask(next)` and then fires `task:changed`, so the modal refetches itself straight away.
- **Swap:** `:210-213`, "작업 정보를 불러오는 중...".
- **Fix:**
  - Use `if (!task) setIsLoading(true)`.
  - Ignore events whose `taskId` is a different task.
  - Skip the refetch when this modal sent the event with fresh data.

**A7. TaskListPage (CONFIRMED, two or more flashes per action)**
- **Flag:** `src/features/tasks/pages/TaskListPage.tsx:88-91`. `load(0, replace=true)` sets `loading = true`. It is called from:
  - `:173-175`, on both events.
  - `:168-171`, whenever the identity of `load` changes. `load` depends on `taskAssignments` (`:166`). The categories store reloads on `task:changed`, `schedule:changed` and window `focus` (`src/features/categories/store.ts:55-61`, `:70`). Each reload stores a new `taskAssignments` object (`:111-121`), so a second `load(0)` runs when the categories response arrives. A queued reload (`:140-142`) can add a third.
- **Swap:** `:278-281`. The list becomes the "작업을 불러오는 중..." placeholder, and `:268` hides the result summary.
- **Effect on cards:** `WorkspaceTaskCard` completing a task (`WorkspaceTaskCard.tsx:51-52`) fires both events. The card unmounts in the middle of its own action, so its pending and error state are lost.
- **Fix:**
  - Split `initialLoading`, which applies when filters or category change or `tasks` is empty, from `refreshing`.
  - On refresh, keep `tasks` and swap the data in when it arrives.
  - Read `taskAssignments` through a ref, or apply the category filter at render, so a category reload does not re-create `load`.
  - Merge duplicate events into one refetch.

**A8. TodayPage (CONFIRMED)**
- **Flag:** `src/features/today/pages/TodayPage.tsx:41-42`. `requestKey` includes the `refresh` counter, so `loading = loadedKey !== requestKey` becomes true in the same render as every event (`:80-88`). `assign` fires two events (`:95-96`), so the counter goes up twice.
- **Swap:** `:173-176` (tasks panel) and `:223-226` (schedules panel), both "불러오는 중…".
- **Fix:** Key `loadedKey` on the day only, so `initialLoading = loadedDayKey !== dayKey`, and track `refreshing` separately. Keep the `cancelled` guard.

**A9. useTaskGraph (CONFIRMED)**
- **Flag:**
  - `src/features/task-map/useTaskGraph.ts:18`: `revision` is part of the identity key, so `current` turns false at once (`:64-67`) and the data is dropped.
  - `:36`: progress updates also set `data: null`.
- **Swap:** `src/features/task-map/TaskMapPage.tsx:602-606`. The graph becomes a `StatusPanel`, and it remounts afterwards, so it loses its viewport and layout.
- **Fix:** Keep `revision` out of the identity key and keep the previous data while it reloads. Use the progress callback only on first load.

**A10. useDeadlineRisk (data drop CONFIRMED; how much the page blanks SUSPECTED, I only read lines 23-45 of the page)**
- **Flag:** `src/features/deadline-risk/hooks/useDeadlineRisk.ts`:
  - `:15`: `revision` is in the key.
  - `:35`: `forecast: null`.
  - `:56`: the old result is dropped.
  - `:23`: window `focus` also triggers it.
- **Effect:** `DeadlineRiskPage.tsx:24` sets `counts` to null during a refresh, and `:45` shows a status line.
- **Fix:** Same as A9.

**Hooks that already keep data during a refetch (use them as the reference):**
- `useMonthlySchedules`: it keeps `summaryByDate`, and `isLoading` only sets `aria-busy` (`MonthCalendar.tsx:71`).
- `useReport`: consumers guard with `isLoading && !data` (`PeriodSummarySection.tsx:29`, `PlanComparisonSection.tsx:57`, `RecurrenceStatsSection.tsx:12`, `TrendSection.tsx:19`).
- `WeeklyReviewSection`: guards with `isLoading && !review`.
- `RecurrencesPage`: it keeps `items` on reload and only nulls them when `status` changes (around `:78`).
- `TrashPage`: it keeps `contents`.

### B. Things that multiply the flashes (all CONFIRMED)

**B1. useActiveSchedule fires `task:changed` with no data change.**
- `src/features/schedules/hooks/useActiveSchedule.ts:46-48` calls `dispatchTaskChanged(taskId, 'active-schedule-loaded')` every time `loadActive` runs while an active schedule has a task.
- `loadActive` runs on window `focus`, `visibilitychange` and `schedule:changed` (`:56-59`). It also runs again whenever `pendingScheduleId` changes (`:67` deps), and that value flips during every schedule mutation through `beginMutation`/`endMutation`.
- It is mounted globally through `MiniPlayerBar` (`AppShell.tsx:191`).
- Result: every alt-tab, every return to the browser tab, and every schedule change makes TaskListPage, TodayPage, TaskDetailModal, the task map, useReport, deadline risk and the categories store all refetch. The pages from section A also show their loading state each time.
- **Fix:** Remove this dispatch, since `setSchedule` already updates the cache. Or fire it only when the detail's version or state actually changed.

**B2. One action sends several events.**
- Both events are fired back to back in:
  - `WorkspaceTaskCard.tsx:51-52`
  - `TodayPage.tsx:95-96`
  - `useTrashUndo.ts:28-29` and `:61-62`
  - `TaskDetailModal.tsx:147-148`
  - `spaces/store.ts:70-71`, `:76-77`, `:160-161`, `:241-242`
- The schedule-mutation chain does the same: `scheduleTaskSync.ts:20` fires `task:changed`, then `useScheduleActions.ts:120` fires `schedule:changed`.
- Each listener refetches once per event. A cancelled first request has already set its loading flag.
- **Fix:** Collect the events into one notification per tick (queueMicrotask or requestAnimationFrame), or deduplicate in the listeners.

**B3. SchedulesTabPage fetches twice for one move.**
- `handleMoveSchedule` (`:284-289`) and `handleShiftScheduleTime` (`:320-325`) fire `schedule:changed` and also call `refetchSchedules()` directly.
- So the day list, presence and monthly data each refetch twice.
- **Fix:** Rely on the event only.

**B4. The categories store resets when its last consumer unmounts (SUSPECTED).**
- `categories/store.ts:268-272` calls `resetCategories()` and sets `isLoading: true, hasLoaded: false`.
- If no consumer stays mounted across pages, category chips and filters show empty on each page change.

**B5. Minor items (SUSPECTED).**
- `ScheduleCacheContext.tsx:99` returns a new map even when the stored schedule is identical. `SchedulesTabPage.tsx:202-206` writes every list summary into the cache as a `ScheduleResponse` on each load. That causes extra re-renders, and a summary may replace a full detail record. This is not a visible flash.
- `ToastContext.tsx:69` removes a toast with the same message and adds it again under a new id, so a repeated toast remounts. `SchedulesTabPage.tsx:196-200` raises a toast for every error change.

### C. Proposed shared pattern

Write one hook, for example `useRevalidatingQuery(key, fetcher, { invalidateOn })`. It holds a snapshot `{ key, data, error, status }` and returns:
- `isInitialLoading = snapshot.key !== key && !cache.has(key)`. Only this shows a `StatusPanel` or skeleton.
- `isRefreshing = request in flight && data != null`. This drives a subtle sign only, such as `aria-busy`, a thin progress bar or a small spinner in the header, and never unmounts content.
- `data`: the current key's data, falling back to that key's stale cache entry. Never another key's data, which keeps the guard the existing comments ask for.
- `error`: on a refresh failure, keep `data` and show an inline or toast error.
- Invalidation bumps a revision number that is not part of the identity key, and marks cache entries stale without deleting them. Keep the cache at module level or in a context so it survives navigation.
- Events are merged once per tick (see B2).

Render rule for every page: `isInitialLoading ? <StatusPanel loading/> : error && !data ? <Error/> : <Content data={data} busy={isRefreshing}/>`.

### D. Existing motion in this area

- **Toast.css:** no transition or animation. Toasts appear and disappear abruptly.
- **SchedulesTabPage.css:**
  - `.schedules-tab__list` has `animation: fadeIn 220ms` (`:50`). The later `.fade-slide` rule (`fadeSlideHorizontalForward 240ms`, around `:179`) overrides it, and it plays only on mount, so the loading swap inside is abrupt.
  - `.schedules-tab__weekly-stats` uses `fadeSlideIn 220ms` (`:157`), but no `fadeSlideIn` keyframes are defined in this file. It may live elsewhere; I did not check.
  - `.week-transition` / `--forward` / `--backward` use `fadeSlideHorizontalForward` / `fadeSlideHorizontalBackward` at 240ms (`:167-181`). The keyframes are at `:183` and `:194`, and `fadeIn` is at `:205`. These replay on purpose, because the wrappers are keyed by week (`SchedulesTabPage.tsx:400`, `:417`).
  - The edge hint has `transition: opacity/transform 180ms` (`:104-106`).
- **Global:** `src/index.css:95-102` sets animation and transition durations to 0.01ms under `prefers-reduced-motion`.
- **Motion tokens:** none. No `--motion`, `--duration` or `--ease` variables exist anywhere in `src`.


## Area: pages

## Page-level flicker audit (pages area): pinit-fe-motion @ 5707165

The flicker comes from one pattern repeated across pages. Every `task:changed` or `schedule:changed` event, and every remount after a screen change, sets a loading flag. Many pages treat that flag as "show the placeholder instead of the list", so the list blinks out. When the list comes back, its CSS entry animation (opacity 0 → 1) plays again, which makes the blink worse. Several pages also receive more than one event per mutation, so they blank twice.

Paths are relative to `C:/Users/chkun/Documents/GitHub/pinit-fe-motion/`. Each finding is marked CONFIRMED (follows directly from the code) or SUSPECTED (depends on timing or server behaviour I could not see).

### 1. TaskListPage (`src/features/tasks/pages/TaskListPage.tsx`): the worst offender

**A. CONFIRMED: a refetch blanks the whole list.**
- `load(0, replace=true)` calls `setLoading(true)` (L88-89).
- The render then swaps the list for the placeholder `작업을 불러오는 중...` (L278-281).
- Both event types trigger `load(0)` (L172-180), so any task or schedule change anywhere blanks the list.
- The filter summary row is hidden while loading (L268, `filtered && !loading && !error`), so the layout jumps too.
- **Fix:** keep `loading` for the first load only (`loading && tasks.length === 0`). Add a separate `refreshing` flag that keeps the current list on screen, set `aria-busy`, and swap the data in when it arrives. Render the summary row from the last known `total` while refreshing.

**B. CONFIRMED: creating a task blanks the list twice, and focusing the window blanks it too.**
- The `load` deps are `[params, category, taskAssignments, setTask]` (L166), and the effect at L168-171 reruns whenever `load` changes identity.
- `taskAssignments` comes from `useCategories()`. The categories store builds a brand-new state object on every reload (`src/features/categories/store.ts` L111).
- That store reloads on every task or schedule event and on window `focus` (store.ts L55-61, L70).
- So after `TaskCreatePage` fires `dispatchTaskChanged(created.id,'create')` (TaskCreatePage.tsx L128):
  1. The listener at L173 runs `load(0)`: first blank.
  2. Categories reload, `taskAssignments` gets a new reference, `load` changes, and `load(0)` runs again: second blank.
- Simply refocusing the browser window also blanks the list. This happens even with `category === 'all'`, where `taskAssignments` is not used at all.
- **Fix:** drop `taskAssignments` from the `load` deps. Either read it through a ref, or move the project filter out of `load` into a `useMemo` over `tasks` (L129-133). Only refetch when `category !== 'all'` and the assignments' content actually changed.

**C. CONFIRMED mechanism, timing-dependent: returning to the Tasks screen can blank the list.**
- Most `useCategories` consumers are on the Tasks page itself (TaskListPage, CategoryFilter, TaskEditPage; ScheduleEditPage and TaskMapPage are the others).
- `WorkspaceTaskCard` and `ScheduleCard` do not import categories. So moving from Tasks to Today normally drops the consumer count to 0, which calls `resetCategories()` and empties the assignments (store.ts L266-272).
- On return, the list loads with `{}`, then the categories snapshot arrives, `load` changes identity, and the list blanks and reloads.
- If the task search finishes before `/projects/snapshot`, you see list → blank → list.
- **Fix:** the same fix as B. Also, don't reset the categories store when the consumer count reaches 0; keep the cached snapshot for the session.

**D. CONFIRMED: two events per mutation means two fetches.**
- The page listens to both `onTaskChanged` and `onScheduleChanged` (L174-175).
- `selectSpace`, `selectProject` and `workspaceChanged` dispatch both events (`src/features/spaces/store.ts` L70-71, L76-77, L241-242).
- The first request is aborted, but the loading state is set again each time.
- **Fix:** run the refresh through a microtask, `requestAnimationFrame` or a short debounce so it happens once per tick.

**E. CONFIRMED: the list's entry animation plays again on every refetch.**
- `.task-page__list` has `animation: fadeSlideIn 220ms` (TaskPages.css L96). The list only exists in the non-loading branch (L295), so each reload unmounts it and the remount starts from opacity 0.
- `.task-page` has `fadeIn 220ms` (CSS L6) on every route mount.
- **Fix:** keep the list container mounted. Animate only newly inserted items (for example, a class applied by id on the first appearance of that id), not the container.

**Keys:** cards are keyed by `task.id` (L298). OK.

### 2. TodayPage (`src/features/today/pages/TodayPage.tsx`)

**A. CONFIRMED: any task or schedule event blanks both panels.**
- `requestKey = day + ':' + refresh` and `loading = loadedKey !== requestKey` (L41-42).
- Any event calls `setRefresh(x+1)` (L80-88), which makes `loading` true immediately.
- The tasks panel then shows `작업을 불러오는 중…` (L173-176) and the schedules panel shows `일정을 불러오는 중…` (L223-226).
- So creating a task also blanks the schedule panel, while the header count `{schedules.length}개` (L220) keeps showing the old number.
- **Fix:** track the loaded day separately. Show the placeholder only when `loadedDay !== todayKey`, meaning a first load or a date change. For `refresh` bumps, keep the current data and only set `aria-busy`.

**B. SUSPECTED: realtime echo causes a second blank.**
- `WorkspaceRealtime` (`src/features/spaces/WorkspaceRealtime.tsx` L21-24) calls `workspaceChanged` 150 ms after any space event, which dispatches both events again.
- If the server echoes the user's own mutation back, Today, Tasks and Schedules all blank a second time about 150 ms after the save.
- **Fix:** skip the `workspaceChanged` event dispatch when the event's resource was mutated locally within the last N ms (or when the actor is the current user), or make every listener use the stale-while-revalidate behaviour above.

**Keys:** OK (`t.id` at L112, `s.id` at L233). The `due` and `ready` arrays are separate children, so duplicate ids across them do not collide. There is no CSS animation in `TodayPage.css`.

### 3. SchedulesTabPage (`src/features/schedules/pages/tab/SchedulesTabPage.tsx`)

**A. CONFIRMED: the day list blanks when the weekly-presence fetch is loading.**
- The list condition is `isPresenceLoading || isScheduleLoading` (L558, and also L170).
- `useWeeklySchedulePresence` sets `isLoading(true)` on every fetch (`hooks/useWeeklySchedulePresence.ts` L39). Its deps include `anchorDate` = `selectedDate` (L102).
- So clicking another day in the same week, or any `schedule:changed` (L104-107), replaces the list with a loading `StatusPanel`.
- **Fix:** use only `isScheduleLoadingRaw && schedules.length === 0` for the list. Key the presence fetch on the week, not on `anchorDate`.

**B. CONFIRMED: `useScheduleList.refetch` throws away the visible rows.**
- `refetch` sets `schedules: [], isLoading: true` (`hooks/useScheduleList.ts` L30-33) and clears the cache.
- It subscribes to `onScheduleChanged` (L36), so creating, moving or deleting a schedule empties the list before the refetch finishes.
- **Fix:** keep the current `snapshot.schedules` during a refetch (`{...prev, isLoading: true}`) and only mark them stale.

**C. CONFIRMED: moves and deletes refetch twice.**
- `handleMoveSchedule` dispatches `schedule:changed` (L284-288) and then also calls `refetchSchedules()`, `refetchOverdue()` and `refetchWeeklyStats()` (L289-291). `handleShiftScheduleTime` does the same (L320-325).
- All of those hooks already subscribe to the event. Together with the three refetches inside `refetchSchedules` (L172-176), each hook gets two or more loading cycles.
- `handleDelete` (L257-258) has no dispatch, so it is fine.
- **Fix:** remove the explicit refetches when a dispatch has already been sent.

**D. CONFIRMED: the overdue banner area jumps.**
- When `isOverdueLoading` is true, `<StatusPanel variant="loading">` replaces the banner, or appears where nothing was (L355-356).
- `useOverdueSchedulesSummary` sets `isLoading(true)` on every `schedule:changed` (`hooks/useOverdueSchedulesSummary.ts` L28, L81-84).
- The whole page shifts vertically on every mutation.
- **Fix:** show the loading state only before the first load (`loadedKey === null`). Otherwise keep the last summary.

**E. CONFIRMED: the weekly stats text flips.**
- It shows `이번 주 총 작업 시간을 불러오는 중...` whenever `isWeeklyStatsLoading` (L419-420).
- `useWeeklyStatistics` sets loading on every schedule event (`src/features/statistics/hooks/useWeeklyStatistics.ts` L43, L87-90).
- **Fix:** use `isWeeklyStatsLoading && !weeklyStats`.

**F. On returning to the tab:** every hook keeps per-instance state (for example, `cacheRef` in `useScheduleList` L19), so each visit starts all five sections in a loading state. **Fix:** move the caches to module level or a shared query cache.

**Animations here:**
- `.schedules-tab` uses `fadeIn 220ms` (CSS L50).
- The week strip and the stats block are keyed per week (L400, L417) and remount with `fadeSlideHorizontalForward`/`Backward 240ms` (CSS L167-203). This is intentional.
- The list uses `.fade-slide` plus `week-transition--{dir}` (L522-526). `.fade-slide` comes later in the file (CSS L179), so it always plays Forward, and only on mount.
- The weekly stats block also has `fadeSlideIn` (CSS L157).
- The drag edge has `transition: opacity/transform 180ms` (CSS L104).

**Keys:** OK (`schedule.id` at L570).

### 4. PlanPage (`src/features/planner/pages/PlanPage.tsx`)

- **Good:** the plan stays on screen during refresh (`isLoading && !plan`, L773), and `useDayPlan` does not null the plan before a refetch.
- **CONFIRMED, minor:** the calibration effect depends on `refreshKey` (L203-232). Every "다시 제안받기", apply or replan flips the status text to `설정 확인 중…` (L633-641) and disables the checkbox (L620-626). **Fix:** remove `refreshKey` from the deps, or keep the last value while reloading.
- **CONFIRMED:** after apply, `dispatchScheduleChanged` fires once per created schedule and `dispatchTaskChanged` once per draft (L440-446). On their own pages, Tasks, Today and Schedules would refetch for each of these. Here they mostly hit global listeners such as the categories store reload.
- **CONFIRMED:** a new `plan` resets the drafts (L268-274). This is expected.
- **Animation:** `.plan-page` uses `fadeIn 220ms` (PlanPage.css L6). Keys are OK (`draft.taskId` L888, `schedule.id` L759). The warning and issue lists use index-based keys (L995, L1024), which is acceptable for static text.

### 5. StatisticsTabPage (`src/features/statistics/pages/StatisticsTabPage.tsx`)

- **Good:** `useReport` keeps the data on a same-key refresh. Each section only shows its placeholder when `isLoading && !data`: PeriodSummarySection L29, PlanComparisonSection L57, TrendSection L19, RecurrenceStatsSection L12, WeeklyReviewSection L79.
- **CONFIRMED: changing the period empties the sections.** `data` is null when `loaded.key !== key` (`hooks/useReport.ts` L51; the comment at L14 says this is intentional). Moving to the previous or next week or month swaps every section for a placeholder, which collapses its height and jumps the layout. **Fix:** keep the previous key's data shown with reduced opacity until the new data arrives, and give sections a `min-height`.
- **CONFIRMED:** switching between week, month and recurrence unmounts the views (L126-137), so every switch reloads from empty.
- **CONFIRMED:** `useReport` listens to both event types (L48-49), giving two reloads per mutation. The data is kept, so this is network only.
- **Animation:** `.statistics-tab__cards` and `.stats-transition` use `fadeSlideIn 220ms` (CSS L41, L45). These replay whenever the cards remount after a placeholder.

### 6. Spaces page and hub (`src/features/spaces/SpacesPage.tsx` and `src/features/spaces/hub/*`)

- **Mostly OK:** `useHubData` (`hub/useHubData.ts` L20-30) uses `useReport`, so the data survives refreshes. Keys are stable: HubRail L30 `space.id`, HubProjects L129 `project.id`, HubPeople L76 `memberId`, TeamRecord L71 `bar.date`.
- `TaskDots` uses `key={index}` for its decorative dots (L22), which is harmless.
- **CONFIRMED:** choosing a space changes the key to `summary:${spaceId}`, so the counts show `–` (HubProjects L51, L59) and TeamRecord shows `팀 기록을 불러오는 중…` (L40). This is brief and expected.
- **CONFIRMED:** `run` and `saved` call `workspaceChanged` (L297, L307, L325), which reloads the spaces store and fires both events. Other listening pages refetch.
- **CONFIRMED:** the `workspace.loading` status line (L393) only shows on the first load or `resetSpaces`, not on refresh.
- **CONFIRMED:** the `useEffect` at L365-369 compares `location.key`. Under `<Routes location={base}>` that key is the background location's, so opening a surface does not reset `detail`.
- **Motion:** `spaces.css` L525-529 is the only `prefers-reduced-motion` block I found in this area.

### 7. Cross-cutting findings (pages area)

- **CONFIRMED: route surfaces do not remount the background page.** `App.tsx` L95 uses `<Routes location={base}>`, and `RouteSurface` is keyed by `location.pathname` (L84). So returning from a modal route is not itself a remount. The blank comes from the event-driven refetches above (`TaskCreatePage.tsx` L128-129, `TaskEditPage.tsx` L302-305).
- **CONFIRMED: page roots fade in on every route mount.** `.task-page` and `.plan-page` (`fadeIn 220ms`) and `.schedules-tab` (`fadeIn`) start from opacity 0 each time. Combined with the loading-placeholder swap, this gives a double flash on each screen change.
- **CONFIRMED: keyframe names collide globally.** `@keyframes fadeIn` is defined in both `TaskPages.css` (L168) and `SchedulesTabPage.css` (L205). `@keyframes fadeSlideIn` is defined in `TaskPages.css` (L177, 10px) and `StatisticsTabPage.css` (L48, 8px). Whichever stylesheet loads last wins.
- **No motion tokens:** none of these files use variables like `--motion-*`, `--ease-*` or `--duration-*`. Durations (180/220/240 ms) and `ease` are hard-coded.
- **SUSPECTED, dev only:** `src/main.tsx` uses `StrictMode`. The `useCategories` consumer effect counts down to 0 on the simulated unmount and calls `resetCategories()` (store.ts L266-272), which causes extra `load` identity changes and blanks on mount in development.

Most of these fixes come down to the same change: show the placeholder only when there is no data for the current key, and coalesce the task and schedule events into one refresh.


## Area: components-mutations

## Mutation UI audit: why the screen flickers (pinit-fe-motion @ 5707165, read-only)

**Root cause:** no mutation in this area is optimistic. After every create or state change, the code fires a global `task:changed` / `schedule:changed` event. Each listener refetches by first setting a loading flag, so the whole list or modal body is swapped for a "불러오는 중" placeholder and then mounted again. On the task list, that remount also replays a 220ms fade-in. Everything below was read from the code unless it is marked SUSPECTED. I did not run the app.

### A. Flicker causes

#### A1. Task list is swapped for a placeholder after every task change
- **Trigger:** `src/features/tasks/components/WorkspaceTaskCard.tsx:49-53`. In `onSaved`, the card calls `setTask(saved)` and then `dispatchTaskChanged` and `dispatchScheduleChanged` back to back.
- **Listener:** `src/features/tasks/pages/TaskListPage.tsx:172-180` calls `load(0)` on both events, so it runs twice and the second call aborts the first.
- **Loading flag:** `load` sets `setLoading(true)` at lines 88-89 with `replace=true`.
- **Swap:** lines 278-282 render `<div class="task-page__placeholder">작업을 불러오는 중...</div>` instead of `.task-page__list` (295-302). Every `WorkspaceTaskCard` unmounts.
- **Remount replays the animation:** `src/features/tasks/pages/TaskPages.css:89-96` gives `.task-page__list` `animation: fadeSlideIn 220ms`. Each time the list mounts again, it goes from opacity 0 to 1 and slides 10px.
- **Side effects of the unmount:**
  - The card's local state is lost: `<details>` open state, the error banner, and `refreshOnly`.
  - `setTask(result.task)`, `setError` and `setRefreshOnly` at lines 55-57 run on an unmounted card, so "상태는 저장되었지만…" is never shown.
  - The comment at lines 60-61 already admits that a full refetch redraws the card.
- The same thing happens after task creation (`TaskCreatePage.tsx:128`) and edits (`TaskEditPage.tsx:302`, `:197`), because the list stays mounted under the route surface.
- **Fix:**
  - Treat `loading` as "initial load only". Keep the placeholder for `tasks.length === 0 && !loaded`. For event-driven refreshes, add a `refreshing` flag (or call `load(0, {silent:true})`) that keeps the current `tasks` on screen and swaps them when the data arrives. `TaskArchiveModal.tsx:97` already does this with `!initialLoaded && isLoading`.
  - Coalesce the two dispatches into one refresh with a microtask or rAF debounce.
  - For `reason: 'state-mutated'`, patch the item in place from `tasksById` instead of refetching.
  - Move the `fadeSlideIn` animation off `.task-page__list` and onto newly inserted items only (see B2).

#### A2. TodayPage swaps both panels for placeholders on every change
- `src/features/today/pages/TodayPage.tsx:41-42` derives `loading` as `loadedKey !== requestKey`.
- Any event bumps `refresh` (lines 80-88), so `loading` turns true in the same render.
- Both panels then swap to placeholders: tasks at line 173 ("작업을 불러오는 중…") and schedules at line 223 ("일정을 불러오는 중…").
- All `WorkspaceTaskCard` and `ScheduleCard` components unmount and mount again.
- **Fix:** keep a separate `hasLoadedOnce` flag. Show the placeholder only before the first load, and keep the old `ready`/`due`/`schedules` on screen during refetches (optionally a subtle `aria-busy` style).

#### A3. Schedule list is cleared on every schedule event
- `src/features/schedules/hooks/useScheduleList.ts:26-34`: `refetch()` calls `setSnapshot({ schedules: [], isLoading: true })` and also wipes `cacheRef`. Line 36 runs it on every `schedule:changed`.
- The list empties, shows its loading state, and fills again. Consumers include `ScheduleDependencyModal.tsx:36` and the schedules tab.
- **Fix:** keep the previous `schedules` while refetching. Mark the cache stale instead of clearing it, and set `isLoading` only when there is nothing cached for the key. Keep the `sequence` guard.

#### A4. Schedule state changes cause two refresh waves and a list-wide button flash
- **Two events per change:** `src/features/schedules/hooks/useScheduleActions.ts:101` awaits `syncTaskStateWithSchedule`, which fires `task:changed` (`src/shared/utils/scheduleTaskSync.ts:20`). Then line 120 fires `schedule:changed`. TodayPage and TaskListPage each get two refresh triggers per change. SUSPECTED: these may be batched into one render, but at least one full placeholder cycle always happens.
- **Global lock dims every card:** `useScheduleActions.ts:57` sets `isMutating = pendingScheduleId !== null`, a single lock in `src/shared/contexts/ScheduleCacheContext.tsx:77-87`. While any schedule is mutating, every `ScheduleCard` disables its quick-complete and delete buttons (`ScheduleCard.tsx:175, 186`) and every `MiniPlayerBar` button. Through `src/index.css:91-94` (`button:disabled { opacity: .45 }`), all cards in the list dim and then brighten.
- **Fix:**
  - Use `isMutating = pendingScheduleId === scheduleId` for per-card disabling. Keep the global `beginMutation` guard only to block concurrent mutations, and rely on its early return.
  - Fire one combined event, or don't fire `task:changed` from the schedule-to-task sync when a `schedule:changed` follows.

#### A5. ScheduleCard shows stale state until the parent refetch finishes
- `src/features/schedules/components/ScheduleCard.tsx:43` reads `state` from the `schedule` prop. It does not use `actions.currentState`, which already merges the cache: `setCurrentState(saved.state)` and `setSchedule(saved)` at hook lines 94-95, returned at line 227.
- The class (88), state icon (94-108) and `schedule-card__status` (110) keep the old state until the refetch ends. Because of A2/A3, the user sees: click, then everything dims, then the card is gone, then it is back in the new state.
- **Fix:** use `const state = actions.currentState` and `schedulesById[id]?.allowedActions ?? schedule.allowedActions`. Optionally set the next state optimistically before awaiting the handler and roll back on error.

#### A6. TaskDetailModal swaps its body for a loading line, including after its own actions
- `src/features/tasks/components/TaskDetailModal.tsx:67`: any `task:changed` bumps `revision`.
- Lines 79-104: `load()` always calls `setIsLoading(true)` (line 82), and lines 210-213 then replace the entire body with "작업 정보를 불러오는 중...".
- **It reacts to itself:** `toggleCompletion` fires `dispatchTaskChanged` (line 118). So completing a task from the modal flashes the modal body.
- **It flickers on open even with a cached task:** lines 62-63 seed from cache with `isLoading=false`, but the mount effect immediately sets it to true. The sequence is cached content, then the loading line, then content.
- **Fix:** call `setIsLoading(true)` only when `!task`; otherwise refresh in the background. Ignore events whose `taskId` matches a change this modal just made, or skip the refetch when `reason` is `complete` or `reopen` and the `next` it already has is enough.

#### A7. ScheduleDetailModal shows its loading branch on every open and every change
- `src/features/schedules/hooks/useScheduleDetail.ts:22` starts with `isLoading=true` and never seeds from `schedulesById`.
- Lines 27-30: any `schedule:changed` triggers a refetch, from any card or the mini player. Line 42 then sets `isLoading(true)`.
- `ScheduleDetailModal.tsx:114-127` returns the loading branch, which collapses the content height and then expands it.
- The `Modal` element type is the same in every branch, so it does not remount and the entrance animation does not replay. The flash is the content swap and the height jump.
- **Fix:** seed from `schedulesById[id]`, and set loading only when `schedule === null`. A `replace()` method that skips the loading state already exists at lines 103-107.

#### A8. Smaller items
- **SUSPECTED layout shift:** `MiniPlayerBar.tsx:53-60` returns `null` when the active schedule is not IN_PROGRESS or SUSPENDED, so the bar appears and disappears instantly. Lines 27-49 set `--workspace-player-height` between 0 and the bar height, which shifts page padding at the same moment.
- **Console noise:** `ScheduleItemActions.tsx:19-29` runs `console.log` and `console.warn` on every render. It is not a flicker cause, but it is noise during re-renders.
- **Snapping border colour:** `.schedule-card`'s transition covers only `box-shadow` and `transform` (`ScheduleCard.css:7-9`). The later overrides change `border-color` on hover (~309) and `border-inline-start-color` by state (~380). `.schedule-card__status` has no colour transition. These snap.
- **Checkbox dims while pending:** `.workspace-task__check:disabled { opacity: .5 }` (`WorkspaceTaskCard.css:36-39`) applies during `pending`, so the checkbox dims and brightens once.

### B. Where completion and list animations should hook in

#### B1. Task completion check
- `WorkspaceTaskCard.tsx:98` binds `checked={done}`, and `done` comes from the cache (lines 33-34). It only changes after the server responds (`taskCompletion.ts:12-13`). It is not optimistic.
- **Change the state:** add `const [optimisticDone, setOptimisticDone] = useState<boolean|null>(null)`.
  - Use `shown = optimisticDone ?? done` for `checked` (line 98), the `is-completed` class (line 94), the side label (line 150) and the `!done` conditions (lines 122, 141).
  - Set it at the start of `toggle()` (around line 42).
  - Clear it in `finally`, and roll it back with an error in `catch`.
  - Don't put `pending` into `disabled`. Rely on `lock.current` instead, which avoids the dimming.
- **Where the CSS goes (`WorkspaceTaskCard.css`):**
  - `.workspace-task__check` (12-23): add `transition: background-color, border-color 160ms`.
  - `.workspace-task__check:checked::after` (28-35): add a keyframe for the tick, scaling from 0 to 1 and rotating 45°.
  - `.workspace-task.is-completed .workspace-task__title` (60-63): add a colour transition and an animated strike-through. Use a `::after` line with a `scaleX` animation, because `text-decoration` cannot be animated.
  - `.workspace-task.is-completed`: optionally fade the whole row.
  - Respect the `forced-colors` block at 40-47.

#### B2. List item enter and exit
- **Task lists:**
  - `TaskListPage.tsx:295-302` renders `.task-page__list > WorkspaceTaskCard key={task.id}`. The root of each item is `<article class="workspace-task">` (`WorkspaceTaskCard.tsx:94`).
  - TodayPage renders the same card in `taskCard` (lines 110-117), under `.today-workspace__task-body`.
  - For enter: put the animation on `.workspace-task` for ids not seen before (a `data-entering` attribute), not on the container.
  - For exit (a completed task leaving the ready-only Today list, or a delete): keep removed ids for about 200ms with an `is-leaving` class, or use `document.startViewTransition` with `view-transition-name: task-${id}`.
  - There is no animation library in the project; package.json has React ^19.2.3, react-router-dom ^7.9.6 and Vite ^7.2.4.
  - React-router 7 also supports `viewTransition` on `Link` and `navigate`. Nothing in `src` uses `startViewTransition` today.
- **Schedules:**
  - `.schedule-card` is the `<article>` at `ScheduleCard.tsx:87-92`. On Today, rows are `.today-page__schedule-row key={s.id}` (`TodayPage.tsx:233`).
  - For state changes, hook into the `schedule-state--*` class on `<article>` (line 88) and `schedule-card__state-icon--*` (lines 95-101). Add transitions for `border-inline-start-color`, `color` and the icon.
  - The pressed/active state is the `aria-busy` attribute on `<article>` (line 91).

#### B3. Mini player
- The root is `.mini-player-wrapper > aside.mini-player` (`MiniPlayerBar.tsx:63-68`).
- It needs a mounted-but-hidden state so it can slide up and down instead of `return null` at line 59.

### C. Modal open and close
- **Shared shell:** `src/shared/components/common/Modal.tsx` has no open/closing state.
  - The parent unmounts it directly, so there is never an exit animation.
  - The embedded branch at line 135 renders `<section className={className}>`.
  - The dialog is at lines 136-152 (backdrop div plus `role=dialog` div).
  - To add exit motion: add a `closing` state, delay `onClose` until `animationend`, and toggle an `is-closing` class on both elements.
  - Watch out: the scroll lock and focus restore in the effect cleanup (lines 61-129) must still run.
- **Unmount instantly on close:**
  - `TaskScheduleModal.tsx:63`, `TaskDependencyModal.tsx:139` and `ScheduleDependencyModal.tsx:50` all `if (!isOpen) return null`.
  - The others are mounted conditionally by their parents.
- **Entrance animations already in place (open only):**

| File | Backdrop | Content |
|---|---|---|
| `TaskDetailModal.css` | 10 `modalFadeIn 180ms` | 22 `modalSlideUp 220ms` |
| `ScheduleDetailModal.css` | 10 | 22 |
| `ScheduleModal.css` | 10 | 29 |
| `TaskScheduleModal.css` | 10 | 23 |
| `TaskArchiveModal.css` | 10 | 23 (200ms, 18px) |

- **Modals with no motion:** `TaskDependencyModal.css`, `ScheduleDependencyModal.css`, and `TagManagerModal` (which reuses the `task-dep-modal` classes).
- **Route surface:**
  - `src/shared/routing/RouteSurface.css` has no animation at all, and `.route-surface-backdrop` (lines 1-12) pops in.
  - The embedded `.task-detail-modal__content` and `.schedule-detail-modal__content` overrides (RouteSurface.css:156-166) don't reset `animation`. SUSPECTED: the inner content slides up inside a shell that appears instantly, which reads as a pop followed by a slide.

### D. Existing motion inventory
- **No motion tokens:** there are no `--motion`, `--ease` or `--duration` variables anywhere. Every value is a hard-coded 0.15s, 0.2s, 180ms, 220ms or 240ms, with `ease`.
- **Duplicated global keyframes that collide:**
  - `modalSlideUp` is defined five times: 20px in four files and 18px in `TaskArchiveModal.css:183-191`.
  - `modalFadeIn` is defined five times.
  - `fadeIn` is in `TaskPages.css:168` and `SchedulesTabPage.css:205`.
  - `fadeSlideIn` is in `TaskPages.css:177` and `StatisticsTabPage.css:48`.
  - Whichever stylesheet loads last wins. Define them once with tokens.
- **Page and section animations:** `.task-page` uses `fadeIn` (`TaskPages.css:6`). `.task-page__list` and `.task-page__item` use `fadeSlideIn` (lines 96, 127). `.schedules-tab__list` uses `fadeIn` plus `.fade-slide` and `.week-transition--*` (`SchedulesTabPage.css:50, 157-180`). Other pages: `PlanPage.css:6`, `ScheduleFormPage.css:6` (`pageSlideUp`) and `App.css:20` (a spinner).
- **Transitions:** schedule card hover shadow and transform (`ScheduleCard.css:7-18`), `.schedule-card__state-icon` `transition: all .2s` (55), quick-complete (213-216), delete and action buttons `all .2s` (172, 249), and `ScheduleModal.css:65`.
- **WorkspaceTaskCard.css has no transitions at all.**
- **Reduced motion:** `src/index.css:95-102` sets all animations and transitions to 0.01ms under `prefers-reduced-motion`. Per-feature blocks exist in `spaces.css:525`, `TaskMapPage.css:606`, `SpotlightTour.css:149` and `OnboardingGuidePage.css:193`.
- **StatusPanel** (`src/shared/components/common/StatusPanel.tsx/.css`) has no motion. Using it as the loading swap in the schedules tab gives the same placeholder flash.


## Area: css-motion

## Styles and motion audit: pinit-fe-motion (read-only)

Repo HEAD is 5707165 and nothing was edited. Paths below are relative to `C:/Users/chkun/Documents/GitHub/pinit-fe-motion`.

**Bottom line:** CSS alone does not cause the flicker. Three things combine:
1. Many components start at `opacity:0` when they mount.
2. Some lists swap to a loading placeholder and back when they refetch, so they remount and fade in again.
3. Route surfaces appear instantly, while the content inside them fades in.

### A. Flicker causes in or tied to CSS

**A1. Confirmed: task list flashes after a task or schedule is created.**
- `src/features/tasks/pages/TaskListPage.tsx:172-175` subscribes `onTaskChanged` and `onScheduleChanged` to `load(0)`.
- `load(0)` calls `setLoading(true)` at `:88-89`.
- In `:277-302` that unmounts `.task-page__list` and shows `.task-page__placeholder`, a dashed box with background `--c-slate-50` (`TaskPages.css:70-76`). When the data arrives the list mounts again.
- `.task-page__list` has `animation: fadeSlideIn 220ms` (`TaskPages.css:96`), which runs from `opacity:0` and `translateY(10px)` (`:177-186`).
- The sequence is list, then dashed placeholder, then a list that fades in from transparent. That is a double flash every time.
- Fix:
  - Use `setLoading(true)` only when the list is empty, for example `if (replace && tasks.length === 0)`. Otherwise keep showing the old list during a background refresh, with an `isRefreshing` flag or a stale-while-revalidate approach.
  - Remove the mount animation from `.task-page__list`. Animate only newly inserted cards, for example with a `data-new` attribute or an enter class added for ids not seen before.

**A2. Suspected: the same pattern on the schedules tab.**
- `.schedules-tab__list` (`SchedulesTabPage.tsx:520-527`) swaps all of its children for a loading `StatusPanel` when `isPresenceLoading || isScheduleLoading` (`:562-563`).
- If those flags turn true again on refetch, every schedule row vanishes and comes back. I did not trace where the flags are set; that belongs to the data-layer area.
- The weekly stats box (`:411-420`) also swaps its text to "불러오는 중..." while `isWeeklyStatsLoading` is true.
- Fix: show the loading panel only when there is no cached data. Keep the old rows during a background refresh.

**A3. Confirmed: route surfaces open in two steps.**
- `.route-surface-backdrop`, `.route-surface` and `.route-exit-backdrop` in `src/shared/routing/RouteSurface.css` have no enter animation, so they appear in one frame.
  - On desktop the backdrop is `rgb(15 23 42/.35)` plus `blur(2px)` (`:1-12`).
  - On mobile it is an opaque `--c-surface` backdrop (`:126-130`).
- The content inside starts at `opacity:0` and fades in:

| Content | Animation | Defined at | Mount opacity |
|---|---|---|---|
| `.schedule-form-page` | `pageSlideUp` 240ms | `ScheduleFormPage.css:6`, `:41-50` | 0 |
| `.task-page` (Create/Edit) | `fadeIn` 220ms | `TaskPages.css:6` | 0 |
| `.task-detail-modal__content` (inside surface) | `modalSlideUp` 220ms | `TaskDetailModal.css:22` | 0 |
| `.schedule-detail-modal__content` (inside surface) | `modalSlideUp` 220ms | `ScheduleDetailModal.css:22` | 0 |

- The surface overrides in `RouteSurface.css:156-176` do not reset `animation`, so these fades still run inside the surface.
- The result is a blank surface (an empty white sheet on mobile) followed by content fading in.
- `RouteSurface` is keyed by `location.pathname` (`App.tsx:84`). Going from detail to edit therefore remounts the surface and replays the blank-then-fade step.
- Closing has no exit animation, so the surface disappears instantly. The list underneath then runs the A1 refresh flash.
- Fix:
  - Animate the container: backdrop `opacity 0→1` over about 160ms and `.route-surface` with `translateY(12px)` plus opacity over about 200ms.
  - Inside `.route-surface__body`, set `animation: none` on `.schedule-form-page`, `.task-page`, `.task-detail-modal__content` and `.schedule-detail-modal__content`.
  - Add an exit animation, either with the View Transitions API or a delayed unmount.

**A4. Confirmed: full-page mount fades replay whenever a page mounts.**
- `.plan-page` uses `fadeIn` (`PlanPage.css:6`).
- `.task-page` (`TaskListPage.tsx:201`), `.schedules-tab__list` (`fade-slide`) and `.statistics-tab__cards` / `.stats-transition` also fade from 0.
- `.statistics-tab__cards` and `.stats-transition` sit on an element keyed by `data.start` (`PeriodSummarySection.tsx:63`), so each period change remounts it and it fades from 0.
- These are intended, but at 220ms ease starting from fully transparent they read as a blink.
- Fix: start from `opacity:.6` or higher, or use transform only, and use ease-out. Or remove the fades and replace them with one shared route transition.

**A5. Confirmed: workspace background differs from the body background.**
- The workspace palette applies only inside `.workspace-theme` (`workspacePalette.css:6-95`, `:179-183`). The `body` background (`index.css:44-46`) uses the global `--c-page-outer` from `theme.css`:

| Theme | Body (`--c-page-outer`) | Workspace (`--workspace-bg`) |
|---|---|---|
| Light | `#f1f5f9` | `#f4f6fa` |
| Dark | `#070d18` | `#151c2a` (large contrast jump) |

- When nothing inside `.workspace-theme` is painted, the body color shows. That happens in three places:
  - `AuthGuard` returns `null` until its effect runs (`AuthGuard.tsx:50`), which costs at least one painted frame even with a valid token.
  - `InitialLoadingScreen` (`App.tsx:166-176`) is outside `.workspace-theme`. It uses `.app-loading`'s gradient `--c-slate-50`→`--c-slate-200` (`App.css:8`): `#f8fafc`→`#e2e8f0` in light, `#18233a`→`#2b3850` in dark.
  - The provider remounts on `zoneId`/`actor`/`offsetMinutes` keys (`App.tsx:203-205`).
- The `theme-color` meta in dark is `#0b1220` (`theme.ts:15`, `index.html:20`), which is the global `--c-page`. The workspace dark background is `#151c2a`, so the browser address bar and the page also don't match.
- Fix:
  - Set `body` (and `html`) background to the workspace background.
  - In `AuthGuard`, set `isReady` synchronously when the token is valid, for example `useState(() => !!token && !expired)`.
  - Render the loading screen inside a `.workspace-theme` wrapper or with workspace tokens.
  - Set the dark `theme-color` to `#151c2a`.

**A6. Confirmed, but only on a cold load: nothing is painted before the CSS arrives.**
- `index.html` has no `<meta name="color-scheme">` and no inline background.
- Before the CSS applies, the canvas is white even in dark mode. In Vite dev, CSS is injected by JS, so this is worse there.
- Fix: add `<meta name="color-scheme" content="light dark">` and an inline `<style>` setting `html` background. Use `#f4f6fa` by default and `#151c2a` for `[data-theme=dark]` and for `prefers-color-scheme: dark` when not light. The existing pre-render script already sets `data-theme`.
- Fonts: `font-display: swap` (`index.css:1-7`) with a `<link rel=preload>` (`index.html:5`). Any font swap is limited to the cold load; it is not a per-navigation cause.

**A7. Suspected, minor: layering quirks.**
- `.schedules-tab__item { transform: scale(1.02) }` (`SchedulesTabPage.css:61-66`) puts every row on its own layer, which can blur text when rows are re-laid out.
- On `.schedules-tab__list` the classes `fade-slide` and `week-transition--backward` conflict. `.fade-slide` (`:179`) is declared after `--backward` (`:175`), so the list always slides forward. This is not flicker, just wrong direction.

### B. Motion inventory

**`@keyframes`.** All names are global, and several are defined more than once with different values. Which definition wins depends on CSS load order.

| Keyframe | Defined in | Values | Used by |
|---|---|---|---|
| `app-loading-spin` | `App.css:33` | rotate, 1s linear infinite | `.app-loading__spinner` (`App.css:20`) |
| `modalFadeIn` | `ScheduleDetailModal.css:186`, `ScheduleModal.css:79`, `TaskArchiveModal.css:174`, `TaskDetailModal.css:182`, `TaskScheduleModal.css:143` | opacity 0→1 | the 5 modal backdrops, 180ms |
| `modalSlideUp` | same 5 files (`:195`, `:88`, `:183`, `:191`, `:152`) | translateY 20px (Sched×2, TaskDetail), 18px (Archive), 16px (TaskSchedule), opacity 0→1 | modal contents, 200–220ms |
| `pageSlideUp` | `ScheduleFormPage.css:41` | translateY 28px, opacity 0 | `.schedule-form-page`, 240ms |
| `fadeSlideHorizontalForward` / `Backward` | `SchedulesTabPage.css:183`, `:194` | ±24px X, opacity 0 | `.week-transition*`, `.fade-slide`, 240ms |
| `fadeIn` | `SchedulesTabPage.css:205`, `TaskPages.css:168` | opacity 0→1 (identical) | `.schedules-tab__list`, `.task-page`, `.plan-page` (PlanPage has no definition of its own) |
| `fadeSlideIn` | `StatisticsTabPage.css:48` (8px), `TaskPages.css:177` (10px) | conflicting offsets | `.statistics-tab__cards`, `.stats-transition`, `.task-page__list`, `.task-page__item` (that class is no longer used in TSX), `.schedules-tab__weekly-stats` |

**Motion tokens.** There are none: no `--ease*`, `--dur*` or `--motion*` variables. Every duration is a literal (120, 140, 150, 180, 200, 220, 240ms, 0.15s, 0.2s), and the only easings are `ease` and `linear`.

**`transition: all`.** It appears 10 times. These are small buttons, but `all` also animates color and background when the theme changes.
- `ScheduleCard.css:55` (`.schedule-card__state-icon`), `:172` (`__delete-btn`), `:249` (`__action-btn`)
- `ScheduleDetailModal.css:51` (`__close`), `:127` (`__action-btn`)
- `ScheduleModal.css:65` (`__close`)
- `TaskDetailModal.css:51` (`__close`), `:132` (`__action-btn`)
- `TaskArchiveModal.css:65` (`__close`)
- `TaskForm.css:142` (`.task-form__difficulty-pill`)
- Fix: list the properties explicitly, for example `transform, box-shadow, background-color`.

**Other transitions.**
- `ScheduleCard.css:7`: box-shadow and transform, with a hover lift.
- `ScheduleCard.css:213`: quick-complete button.
- `SchedulesTabPage.css:104`: `.schedules-tab__edge`, opacity and transform at 180ms.
- `TaskPages.css:158`: checkbox mark.
- `ReportSections.css:80`: `.trend-chart__bar`, height 220ms.
- `RoutinesPage.css:80,89` and `SettingsPage.css:112,121`: toggle background and knob.
- `SettingsPage.css:181,213`, `LoginPage.css:172`, `LandingPage.css:76`: button press effects.
- `SpotlightTour.css:39`: callout opacity 150ms, starting `visibility:hidden; opacity:0`, shown when `.is-ready` is added.
- `OnboardingGuidePage.css:115`: caret.
- `TaskArchiveModal.css:96`.

**No enter or exit animation at all:** toasts (`Toast.css`), route surfaces, `AppBanners`, `OverdueBanner`, `MiniPlayerBar`, the bottom tab bar, the top bar and `StatusPanel`.

**`prefers-reduced-motion`.**
- Global: `index.css:95-103` sets `animation-duration` and `transition-duration` to 0.01ms with `!important`.
- Local overrides: `SpotlightTour.css:149`, `OnboardingGuidePage.css:193`, `spaces.css:525` (`.space-dialog`, `.space-option`, `transition:none`, though they have no transitions), `TaskMapPage.css:606` (`.tm-world` with `will-change:auto`).

**Elements that start at `opacity:0`:**
- Every keyframe above except `app-loading-spin`.
- `.schedules-tab__edge` (`SchedulesTabPage.css:102`).
- `.spotlight-tour__callout` (`SpotlightTour.css:38`).
- `.task-page__checkbox input`, which is hidden on purpose.

### C. Theme tokens

**Global (`src/shared/styles/theme.css`).**
- Light is set at `:root:10-127`. Dark is set at `:root[data-theme='dark']:129-246` and repeated in `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` at `:248-367`.
- Surface tokens:

| Token | Light | Dark |
|---|---|---|
| `--c-page` | `#f8fafc` | `#0b1220` |
| `--c-page-outer` | `#f1f5f9` | `#070d18` |
| `--c-surface` | `#fff` | `#131c2e` |
| `--c-surface-inverse` | `#0f172a` | `#334155` |
| `--c-surface-inverse-soft` | `#1e293b` | `#475569` |

- Color scales `--c-{slate,red,orange,amber,green,emerald,sky,blue,indigo,rose,cyan}-{50..900}` follow Tailwind in light. In dark the steps are inverted: 50–300 become rgba tints and 700–900 become light ink.

**Workspace (`src/shared/styles/workspacePalette.css`).**
- Scope: `.workspace-theme`, plus the toast container and spotlight portals under `body:has(.workspace-theme)`. Dark values sit at `:97-129` and `:131-177`.
- Tokens:

| Token | Light | Dark |
|---|---|---|
| `--workspace-bg` | `#f4f6fa` | `#151c2a` |
| `--workspace-surface` | `#fff` | `#202a3c` |
| `--workspace-ink` | `#202a3c` | `#e3e9f4` |
| `--workspace-muted` | `#626e80` | `#a3b0c5` |
| `--workspace-line` | `#e9edf3` | `#354258` |
| `--workspace-blue` | `#345ce5` | `#9bb4ff` |
| `--workspace-blue-soft` | `#edf2ff` | `#2a3d65` |
| `--workspace-pink` | `#cd758d` | `#df97b2` |
| `--workspace-sidebar` | `#fbfcfe` | `#1a2334` |
| `--workspace-on-accent` | `#fff` | `#142547` |

- Also defined: meter, control-line, completed, map, chart-* (via color-mix) and quadrant-0..3 tokens.
- It re-aliases `--c-page`, `--c-page-outer`, `--c-surface*`, `--c-slate-*`, `--c-blue-*` and `--c-indigo-*` to the workspace tokens, but only inside that scope.
- `workspacePalette.css:251-253` hardcodes `#eef1f5`, `#e3e7ee` and `#9aa3b2` for disabled buttons, and these are not overridden in dark.

**Theme switching.**
- `index.html:12-21` sets `data-theme` and `theme-color` before the first render.
- `theme.ts:54-60` (`applyThemePreference`) and `useThemePreference.ts:8-10` keep them in sync. The second applies inside `useEffect`, but because the pre-render script already set the attribute there is no visible flash.
- `theme-color`: light `#0b1b42`, dark `#0b1220`.


## Area: sw-pwa

No code in the service worker, PWA or boot path reloads the page or forces a whole-tree re-render on navigation or on create. The flicker in this area comes from three in-app causes: realtime (SSE) events that make every list refetch, refetch code that empties the list before new data arrives, and provider `key`s that can remount the whole router. Everything below comes from reading the code; nothing was run.

### A. Service worker, PWA and boot: what forces a reload

1. **Service worker update** — confirmed, no reload.
   - `public/sw.js:16` calls `self.skipWaiting()` after precache, and `public/sw.js:25` calls `self.clients.claim()`.
   - Nothing under `src` listens for `controllerchange`, so a new worker never reloads the page by itself.
   - `src/main.tsx:28-59` registers the worker only in production (`import.meta.env.PROD`) and only fires the `pinit:update-ready` event.
   - `src/shared/components/layout/AppBanners.tsx:28` reloads only when the user clicks the 업데이트 button.
   - Small mismatch: because of `skipWaiting`, the new worker already controls the page when the banner says a new version is ready. To make the reload mean something, drop `skipWaiting` from `install` and have the banner post a `SKIP_WAITING` message to the waiting worker, then reload once on `controllerchange`.
2. **Service worker fetch handling** — confirmed, not a flicker cause.
   - Page navigations are network-first (`public/sw/cache.js:41-59`); other same-origin GETs are cache-first (`public/sw/cache.js:61-71`).
   - The API runs on a different origin (`src/shared/api/config.ts:24-40`), so API calls are never cached or delayed by the worker.
   - There is no code-splitting: no `lazy(` or `<Suspense` anywhere, only the dynamic import of the mock server at `src/main.tsx:15`. So there are no Suspense fallbacks to flash and no stale-chunk failures after an update.
   - Suspected edge case: Vercel rewrites every path to `index.html` (`vercel.json` rewrites `/(.*)`). A missing `/assets/*` file would come back as HTML with status 200, and `cacheFirst` would store it.
3. **Notification click does a real full reload** — confirmed.
   - `public/sw/clients.js:22-23` calls `client.navigate(targetUrl)` when the app is already open on a different URL. That is a document navigation.
   - Fix: `client.postMessage({type:'navigate', url})` plus `focus()`, and have the app call router `navigate(url)` on that message.
4. **Other `window.location` uses** — confirmed, all intentional and outside normal in-app navigation:
   - `src/features/auth/pages/LoginPage.tsx:90` and `src/features/settings/components/AccountSection.tsx:116`: OAuth redirects.
   - `src/features/oauth/pages/OAuthConsentPage.tsx:121`: `assign(redirectUri)`.
   - `src/features/auth/hooks/useNavigateAfterLogin.ts:12`: `location.replace`, only for `/oauth/` targets (`src/features/auth/utils/returnTo.ts:82`).
   - There is no `navigate(0)` anywhere.
5. **`index.html`** — confirmed fine. The inline script sets `data-theme` before first paint, so the theme does not flash.
   - `src/index.css:6` uses `font-display: swap`, which can cause a font swap on the very first load only.

### B. Re-mounting the whole tree (`src/app/App.tsx`)

6. **The `TaskCacheProvider` key wraps the `RouterProvider`** — confirmed mechanism. `src/app/App.tsx:203` sets `key={`${zoneId}:${actor ?? 'guest'}`}`, and `src/app/App.tsx:205` sets `ScheduleViewStateProvider key={offsetMinutes}`.
   - Any change to `zoneId`, `actor` or `offsetMinutes` unmounts everything under the router: AppShell and pages.
   - `AuthGuard` then restarts with `isReady=false` and renders `null` (`src/features/auth/components/AuthGuard.tsx:8,50`). That is a blank frame followed by every page loading again.
   - **Zone sync trigger.** `src/features/settings/hooks/useMemberZoneSync.ts:16-18` calls `applyZone` on the first AppShell mount whenever the server's zone differs from the stored one (the default is `Asia/Seoul`, `src/shared/contexts/TimePreferencesContext.tsx:27`). That causes one full-tree flash per session for affected users or devices, e.g. first login on a device.
   - **Token refresh does not remount.** `setAuthTokens` (`src/shared/api/authTokens.ts:38`) fires `auth:changed`, but `setActor` gets the same subject string and React skips the update.
   - **Failed refresh does remount.** If a refresh fails, `src/shared/api/httpClient.ts:106` and `:158` set the token to `null`, the actor becomes `'guest'`, and the whole tree remounts.
   - Fix: keep the `key` only for real user or zone changes and move it below `AuthGuard`, or invalidate the caches inside the providers instead of remounting. Skip `applyZone` when the new zone's offset equals the current one. Don't put `RouterProvider` inside a keyed provider.
7. **`InitialLoadingScreen`** (`src/app/App.tsx:195`) — confirmed it never shows, because `isLoading` is hard-coded `false` (`src/shared/contexts/TimePreferencesContext.tsx:46`). Not a cause.
8. **`WorkspaceRoutes`** — confirmed. AppShell is a layout route inside `<Routes location={base}>` (`src/app/App.tsx:95-96`), so it survives tab changes; only the page element remounts.
   - Overlay screens render as a separate `<Routes>` using `RouteSurface key={location.pathname}` (`src/app/App.tsx:84`). Moving between overlay paths (e.g. `/schedules/new` to `/schedules/:id`) remounts the overlay.
   - Without background state, `base` becomes a synthetic location with `key 'surface-base'` (`src/app/App.tsx:72-80`).

### C. Realtime (SSE) events trigger a global refetch — the most likely cause of the flicker on create

9. **Every SSE event or reconnect becomes a global refetch** — confirmed in code.
   - `src/features/spaces/WorkspaceRealtime.tsx:21-24`: every event, and the no-argument `changed()` call, runs `workspaceChanged` after a 150 ms debounce.
   - `workspaceChanged` (`src/features/spaces/store.ts:239-243`) calls `reloadSpaces()` and dispatches both `task:changed` and `schedule:changed` with `reason:'space'`.
   - The handler also fetches the changed item's detail and calls `setTask`/`setSchedule` (`src/features/spaces/WorkspaceRealtime.tsx:34-49`). That changes the cache context value, so every consumer re-renders.
   - `src/features/spaces/realtime.ts:105-108` calls `changed()` on every successful SSE (re)connect, so each reconnect refetches everything.
   - `src/features/spaces/realtime.ts:135-137` also flips `connection(false)` then `true`. The "실시간 연결을 다시 시도하고 있어요" toast is a fixed-position popup with no transition (`src/features/spaces/spaces.css:532`), so it pops in and out on each reconnect.
   - Suspected: if the backend or proxy closes idle SSE streams periodically, this whole-screen refetch repeats on a timer with no user action.
10. **Creating a schedule or task refetches twice** — confirmed on the FE side, suspected on the BE side.
    - The page dispatches `schedule:changed` and `task:changed` locally right after the mutation (e.g. `src/features/today/pages/TodayPage.tsx:95-96`). That is refetch #1.
    - If the backend sends the user's own change back on `/workspace/events` (not checked), the SSE path sends `task:changed` and `schedule:changed` again 150 ms later. That is refetch #2, a second flicker. A schedule-only change also refetches all task lists, because `workspaceChanged` dispatches both.
    - Fix: drop events you caused yourself (match `resourceId`+`version` against recent local mutations, or a client mutation id). Don't call `changed()` on the first connect, only on reconnect after an actual gap, i.e. `lastEventId` set. Dispatch only the event's resource type with a scoped detail (`{taskId}`/`{scheduleId}`) instead of a global `reason:'space'`.
    - **Update, 2026-11-10:** the first-connect half of this fix is reversed. The backend is changing a fresh connection to start at the latest change instead of replaying the whole history, so `realtime.ts` again refetches once after every successful connect, the first one included, to cover changes committed before the connect. The refetch shares `WorkspaceRealtime`'s 150 ms debounce. The mock `ready` frame now carries the latest change id.
11. **The refetch code empties the list first** — confirmed in two places; this is what turns refetch #1 and #2 into visible flicker.
    - `src/features/schedules/hooks/useScheduleList.ts:26-34`: `refetch` sets `{schedules: [], isLoading: true}` and clears `cacheRef`, so the list is blank until the response arrives.
    - `src/features/today/pages/TodayPage.tsx:41-42,80-88`: `requestKey` includes `refresh`, so every `task:changed` or `schedule:changed` sets `loading=true` and swaps both panels for "작업을 불러오는 중…" (`src/features/today/pages/TodayPage.tsx:173`).
    - Fix: keep showing the previous data while revalidating (stale-while-revalidate). Use a separate `isRefreshing` flag instead of `isLoading`, set `isLoading` only when there is no data for that key, and don't empty `schedules` in `refetch`.
    - Other listeners re-request the same way: `useMonthlySchedules`, `TaskListPage:174`, `useReport`, `useTaskGraph`, `useWeeklySchedulePresence`, `useOverdueSchedulesSummary`, `RecurrencesPage`, `TrashPage`, `categories/store`, `useDeadlineRisk`, `useActiveSchedule`. Whether each one shows a loading state needs checking in those areas.
12. **Every window focus reloads spaces** — confirmed: `src/features/spaces/store.ts:231`.
    - Each reload emits a fresh state object (`revision+1`, new arrays) at `src/features/spaces/store.ts:150-158`. Every `useSpaces` consumer re-renders, including AppShell, `SpaceSwitcher` and pages; the store hook also returns a new object each render (`src/features/spaces/store.ts:202`).
    - It only dispatches task and schedule refetches when the membership or selection changed (`src/features/spaces/store.ts:159-162`).
    - Fix: skip `emit()` when the snapshot is structurally unchanged, and throttle the focus-triggered reload.
13. **Changing space or project refetches everything** — confirmed: `selectSpace` and `selectProject` (`src/features/spaces/store.ts:70-71,76-77`) always dispatch both refetch events. Expected, but it gives the same blank-then-fill flicker because of item 11.
14. **Dev only.** `<StrictMode>` (`src/main.tsx:22`) runs effects twice in development, so fetches double there. That does not happen in production.

### D. Existing animation in this area

- There are no motion tokens: no `--motion`, `--duration` or `--ease` variables.
- There are no View Transitions (`startViewTransition` / `viewTransition`).
- `src/app/App.css:20,33` has the `app-loading-spin` keyframes for the loading spinner, which never shows (item 7).
- `src/index.css:95-103` has a global `prefers-reduced-motion` override that cuts `animation-duration` and `transition-duration` to 0.01ms.
- `src/shared/routing/RouteSurface.css`, `src/shared/components/layout/AppBanners.css` and the `.space-realtime-status` toast have no enter or exit transitions.
- `src/features/spaces/spaces.css:525-530` has a reduced-motion rule for `.space-dialog` and `.space-option`.
- Other files with keyframes, outside this area: `ScheduleDetailModal.css`, `ScheduleModal.css`, `ScheduleFormPage.css`, `SchedulesTabPage.css`, `StatisticsTabPage.css`, `TaskArchiveModal.css`, `TaskDetailModal.css`, `TaskScheduleModal.css`, `TaskPages.css`.

### E. Running locally without a backend (mock mode)

- **How to turn it on:** mock mode needs `import.meta.env.DEV && VITE_USE_MOCK_API === 'true'` (`src/main.tsx:11-17`).
  - Put `VITE_USE_MOCK_API=true` in `.env.local` (no `.env*` file exists yet) and run `npm run dev`.
  - Or in PowerShell: `$env:VITE_USE_MOCK_API='true'; npm run dev`.
  - There is no query-param switch.
- **Login:** `demo` / `demo1234` (README). The mock answers `/v0/login` and `/v0/refresh` (`src/mocks/handlers.ts:144,182`).
- **How it works:** it patches `window.fetch` (`src/mocks/mockServer.ts:11-16`). Unmatched requests go through to the real network, which in dev defaults to `localhost:8080/8081/8082`.
- **Limitations:**
  - It has no handlers for `/spaces` or `/workspace/events`. `fetchWorkspace` fails, so `WorkspaceRealtime` never connects, and the SSE-driven flicker (items 9-10) cannot be reproduced in mock mode.
  - The service worker is not registered in dev.
  - Item 11 (refetch empties the list) does still reproduce, through the local dispatch after a create.
- **Alternative with spaces data:** `qa/plan-integration/local.mjs` and `qa/replanning/local.mjs` start Vite with `VITE_USE_MOCK_API=false`, serve fake `/spaces` responses and SSE through Playwright routes, and need `playwright` from `qa/browser/package.json`.

**Update, 2026-11-10: mock mode now covers spaces, the workspace API and SSE.** The limitation above about `/spaces` and `/workspace/events` no longer holds.
- **Coverage:** `src/mocks/workspace.ts` (`handleWorkspace`, reached from `src/mocks/handlers.ts`) answers `/v2/spaces` (list, create, `summaries`, each space and its sub-routes), `/v2/projects`, `/v2/space-invitations/*`, and `/v2/workspace/tasks`, `/schedules` and `/recurrences`, with their detail, state, schedule, restore and purge routes. The fixtures in `src/mocks/workspaceState.ts` include a personal space and two shared spaces (`제품팀`, `독서 모임`) with teammates, so `/app/spaces`, the hub and the space switcher render with data.
- **SSE:** `/v2/workspace/events` and `/v2/spaces/:id/events` return a `text/event-stream`. Each stream starts with a `ready` event. On reconnect it replays the `changed` events after `Last-Event-ID`. Every mock mutation records a `changed` event, which reaches members of that space after the response latency plus `STREAM_POLL_MS` (250ms). The echo of your own save therefore arrives after its response, as it does with the real server, and `takeLocalEcho` can recognise it. `WorkspaceRealtime` connects in mock mode, so items 9 and 10 reproduce.
- **`__pinitMock.setLatency(ms)`** (`src/mocks/mockServer.ts`) delays every mocked response except event streams by `ms`. The value is stored in `localStorage` (`pinit.mock.latency`), so it survives a reload. The default is 0. Use it to see loading and refresh states on a slow network. It returns the value it applied.
- **`__pinitMock.remote.*`** (`mockWorkspaceRemote` in `src/mocks/workspace.ts`) changes data as a teammate (member 3 by default; pass another member id as the last argument). Each call bumps the version and sends the matching `changed` event over SSE: `completeTask(id)`, `reopenTask(id)`, `renameTask(id, title)`, `createTask(title?, { spaceId, projectId, assigneeId, dueInDays }?)` and `deleteTask(id)` (moves the task to trash). Use it to check that a remote change updates the screen without a blink.
- **Still not covered:** you cannot force an SSE disconnect from the console, so to see the realtime notice you have to break the stream (for example, block the request in DevTools). The service worker is still not registered in dev.
