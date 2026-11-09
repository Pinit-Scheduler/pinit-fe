# Combined planning feature browser check

This localhost-only harness verifies replanning and deadline-risk navigation in the same genuine FE app. It starts Vite on `127.0.0.1:5194` and intercepts every API call with synthetic responses. Only the two mocked replan POST routes are permitted. Missed API fixtures receive a local 404; there is no backend proxy or production transport.

```powershell
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix qa/browser
node qa/plan-integration/local.mjs
```

Installed Google Chrome is used headlessly through the existing locked Playwright dependency. The harness covers team/project preview, personal-only forecast without scope arguments, explicit personal plan navigation clearing the project and old preview, another team selection, one selected-ID synthetic apply, forecast re-query, and 390px layout. It checks React/uncaught errors, unexpected APIs and escaped requests.

Outputs stay under ignored `.cache/deadline-risk-browser-combined/`. All account, task, schedule and time data are synthetic. Vite development mode intentionally avoids production SW registration; the real worker's no-store policy is exercised by the existing VM tests. This check does not validate native BE calculations, database persistence, actual authentication/CORS, production deployment or real SW delivery. See [the integration evidence](../../docs/planning-features-integration.md).
