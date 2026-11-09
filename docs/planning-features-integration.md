# Replanning and deadline-risk FE integration — 2026-11-09

The isolated release preparation combines the two feature HEADs without changing their refs or merging master. Production publication is coordinated separately after the BE deployment.

| Source | Full revision |
| --- | --- |
| Fetched master | `3baa37ec247324497aa4b40e8c068c447f41899e` |
| Replanning PR #39 | `795c76304a471abc17de348b23f20df791273df2` |
| Deadline-risk PR #40 | `ea4428ff77b13a2dfc2bca304600a3c617835bb9` |
| Combined source merge | `0485705d2b879fc40ffbd1f8f5edca54d4e258d6` |

The feature HEADs matched the supplied revisions. `git merge-tree --write-tree` returned 0. The isolated branch fast-forwarded to #39 and normally merged #40, preserving both source ancestries. README, validation guidance and PlanPage merged automatically; no manual production-code conflict resolution was needed.

`src/features/planner/pages/PlanPage.tsx` retains the replanning panel and deadline-risk entry together. `src/app/App.tsx` retains the dedicated deadline-risk route. `src/features/spaces/SpaceChrome.tsx` retains its personal forecast context. The forecast's explicit personal action clears the selected project before returning to the plan, while replanning uses the selected accessible space/project. SW imports/cache name remain v27; the real `public/sw.js` no-store bypass is preserved, and replan POST requests are outside its GET handler.

## Executed validation

- `NODE_OPTIONS=--max-old-space-size=256 node --test --test-concurrency=1`: **288/288**, fail/skip 0. This includes the combined OAuth, replan, deadline-risk and real-worker VM tests.
- `npm run lint`: passed, including the new local harness. Existing baseline-browser-mapping age notice remains.
- `npm run build`: passed, 355 modules. JS 744.20kB/gzip 229.64kB; CSS 181.17kB/gzip 29.62kB. Existing 500kB chunk notice remains.
- Build validation used `VITE_USE_MOCK_API=false` and all three API bases set to `http://127.0.0.1:5194`. **This local `dist/` is QA-only and must not be deployed.** Production must rebuild the source with the project's production environment.
- `node qa/plan-integration/local.mjs`: **7 combined browser checks**, 106 intercepted API calls (5 synthetic POSTs), page/React errors 0 and external requests 0. Team/project → forecast → personal plan clears the previous scope; another team gets its own preview; one personal ID is selected for mocked apply; returning to the forecast requests a fresh result. Both views fit 390px without horizontal overflow. Desktop/mobile screenshots were visually inspected.
- Initial harness assumptions were corrected before the passing run: project navigation goes through Today to Plan, and production SW registration must not be paired with Playwright's blocked-worker API fixture. The passing interaction harness uses local Vite development mode. No product-code fix was introduced for those test setup issues.

The local browser responses are synthetic. Native BE persistence, real session/cookie/CORS behavior and production SW delivery are not established by this check. Existing individual feature evidence remains tied to its original revisions.

## Production preparation information

Read-only Vercel inspection identified the `pinit-fe` Vite project and verified canonical domain `pinit.go-gradually.me`. Source production API defaults point to `https://mono.pinit.go-gradually.me`; no secret environment values were read or exported. The deployment coordinator checks the effective production environment and deployment git SHA separately.

`.github/workflows/canonical-postdeploy.yml` runs on master push. Its `qa/browser/canonical-postdeploy.mjs` requires trusted master-push metadata, compares canonical public SW byte hashes with source, checks cache name, canonical assets, BE readiness and the three primary OAuth scopes, then checks fresh mobile login focus/layout and an active genuine SW/cache. It submits no login, creates no accounts and writes no production fixture. Vercel production SHA/READY and authenticated feature canaries are separate checks. This integration preparation did not run the canonical production smoke, deploy, merge a PR or push a branch.
