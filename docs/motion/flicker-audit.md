# Flicker audit

Snapshot of 2026-11-10. The audit read origin/master 5707165 in six areas: Routing, Data (data loading), Pages, Mutations, CSS and SW (service worker and boot). The status column was rechecked against the code after the motion work and the follow-up cleanup. The rules that keep these fixed are in [README.md](README.md).

- **Fixed:** the cause is gone from the code.
- **Open:** it is still there.
- **By design:** the behavior is intended and no longer causes a flicker.

The ID column keeps the audit's own IDs. Code comments that cite an ID without an area (for example `audit B4`) mean the Data area for A and B, and the Routing area for C and S.

## Data loading and refetch

| ID | Cause | Fix | Status |
|---|---|---|---|
| Data A1–A10, Pages 1–3, Mutations A1–A3 and A6, SW 11 | A refetch swapped the content for its loading branch: the schedules day list, week dots, overdue banner, week total, schedule detail, task list, Today, task map, deadline risk and the task detail modal. | Data stays per key while it revalidates (`useRevalidatingQuery`, or per-key state where a hook keeps its own). A loading panel shows only when the current key has no data. | Fixed |
| Pages 3A, 3D | The schedules day list blanked while unrelated data loaded (the week dots), and the overdue banner's loading panel pushed the page. | Only the day's own data decides the list. A week-dots failure raises a toast; the overdue banner has no loading panel. | Fixed |
| Data B2, Pages 1D, SW 10 | One action sent several change events, and every listener refetched once per event. | Events dispatched in the same task reach each listener as one batch (`onDataChanged`). | Fixed |
| Data B1 | `useActiveSchedule` sent `task:changed` without a data change. | It no longer sends it. | Fixed |
| Data B3, Pages 3C | Handlers refetched by hand right after dispatching a change (schedule moves and deletes). | The change event alone refreshes every view. | Fixed |
| SW 9, Pages 2B | Every realtime event or reconnect became a global refetch, including the echo of this client's own save. | Events are debounced (150 ms), each (re)connect refetches once, and `takeLocalEcho` skips the echo of a local save. | Fixed |
| Data B4 | The categories store reset when its last consumer unmounted. | The snapshot is kept for the session and cleared on an account change. | Fixed |
| Data B5 | An identical read replaced the schedule cache map and re-rendered every consumer. | A read of the same revision keeps the map; an older revision never replaces a newer one. | Fixed |
| SW 12 | Window focus reloaded the spaces and re-rendered every consumer with an equal snapshot. | The focus reload is throttled and an unchanged snapshot is not emitted. | Fixed |
| SW 13 | Switching space or project refetches every view. | Intended. It no longer blanks anything, because refetches keep their data. | By design |

## Routing and shell

| ID | Cause | Fix | Status |
|---|---|---|---|
| Routing C1, CSS A3, Mutations C | Route surfaces appeared and disappeared in one frame, with a full-screen dim (or an opaque layer on mobile). | Surfaces stay mounted through their exit (`usePresence`, `Modal closing`); the backdrop fades and the panel rises, or slides up as a sheet on mobile. | Fixed |
| Routing C2, SW 8 | A tab change swapped the whole page with no transition. | Tab links crossfade only the content area (View Transitions, with a Web Animations fallback). | Fixed |
| Routing C3 | Scroll position carried over to the next page. | AppShell resets the content scroll for a new background page. | Fixed |
| Routing C4 | A plain link to a surface swapped the page behind it for a fixed fallback page. | The last page stays behind the surface; surface links go through `open()` (`surfaceLinkClick`). | Fixed |
| Routing C5, SW 6 | A display zone change remounted the whole router tree. | Zone-scoped state resets in place; only the background page and the surface page remount. | Fixed |
| Routing C6 | `RouteSurface` was keyed by pathname, so moving between surfaces remounted the modal shell. | The key is gone; only the page inside crossfades. | Fixed |
| Routing C7 | `AuthGuard` painted nothing until its effect ran. | `AuthBoot` renders while the session is checked. | Fixed |
| Routing S1 | After a surface closed on mobile, the bottom tab bar and mini player stayed hidden for a frame (suspected). | The shell's `inert` is set and cleared in a layout effect. | Fixed |
| Routing C9 | Shell slots shift the layout: the install banner exists only on Today, the space context bar changes per path, and the mini player height feeds the content padding. | — | Open |
| Routing S2 | The shell's `MutationObserver` re-measures on every DOM mutation (performance, not a proven flicker cause). | — | Open |
| SW 3 | A notification click on an already open app does a full document navigation (`client.navigate`). | — | Open |

## Mutations and completion

| ID | Cause | Fix | Status |
|---|---|---|---|
| Mutations A4, A5 | No mutation was optimistic: a schedule card showed its old state until the list refetched, and one schedule's save dimmed every card's buttons. | Cards read `actions.currentState`, which already includes the change being saved. A per-card lock ignores presses; controls are disabled by permission only. Task completion toggles optimistically and rolls back on failure. | Fixed |
| Mutations A7 | The schedule detail showed a loading line on every open and every change. | It opens on the cached copy and refreshes it in place. | Fixed |
| Mutations B3, CSS B | Toasts, banners and the mini player had no enter or exit. | They enter and leave through the presence hooks. | Fixed |

## Styles

| ID | Cause | Fix | Status |
|---|---|---|---|
| Pages 1E, CSS A4 | Page roots and list containers played a mount fade on every visit and every remount. | Those animations are gone; only content the screen waited for arrives (`useArrival`). | Fixed |
| CSS B | Keyframes were defined several times with different values, and there were no motion tokens. | Tokens and shared keyframes live once in `motion.css`. | Fixed |
| CSS A5, A6 | The body background differed from the workspace background, and a cold load painted a white canvas before the CSS arrived. | The canvas uses the workspace background; `index.html` sets `color-scheme`, an inline background and the dark `theme-color`. | Fixed |
| CSS A7 | Schedule rows sat on their own layer (`scale(1.02)`), and two list classes disagreed on the slide direction. | Both rules are gone. | Fixed |
