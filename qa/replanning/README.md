# Local replanning browser verification

This harness targets only an explicitly marked disposable Task/H2 fixture on `http://127.0.0.1`. It never runs the existing production-oriented `Workspace browser QA` workflow. The genuine FE bundle calls a local proxy, which forwards only the two replan POST routes to the actual Spring controller/service/database with a test member identity. Workspace/authentication display APIs are local fixtures; this is not composed-app authentication E2E.

The BE test launcher `:modules:task:replanBrowserFixture` provides `/replan-fixture/info` (`fixture:true`, `now`, `zoneId`, `memberId`, `spaceId`, nullable `projectId`, `otherSpaceId`, current start values), plus test-only reset, version-touch and membership-revoke POST endpoints. Without that localhost marker the harness performs no writes. Those fixture endpoints must never be part of a production app.

In a separate terminal at the BE feature checkout, start `./gradlew.bat :modules:task:replanBrowserFixture --max-workers=2 --console=plain`. The launcher rejects existing/non-H2 databases, binds only `127.0.0.1`, uses test identities and closes after fifteen minutes. Keep that terminal running for the FE check below.

```powershell
npm ci --prefix qa/browser
$env:VITE_API_BASE_URL='http://127.0.0.1:5186'
$env:VITE_AUTH_BASE_URL='http://127.0.0.1:5186'
$env:VITE_NOTIFICATION_API_BASE_URL='http://127.0.0.1:5186'
npm run build
$env:REPLAN_FIXTURE_ORIGIN='http://127.0.0.1:18086'
# Optional: use an installed Chromium binary instead of Playwright's browser.
$env:REPLAN_CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
node qa/replanning/local.mjs
```

It selects a project, holds a genuine preview response while switching spaces, checks scope isolation, causes an actual version conflict and verifies checkbox preservation, applies one existing ID, verifies persisted start times through native fixture inspection and a second genuine preview, then removes actual fixture membership and verifies that an authoritative REST denial clears the preview and blocks retry. Other external network requests are blocked. Runtime screenshots and the bounded report stay in ignored `.runtime/`. The existing production-oriented CI/browser workflows and their approval conditions are preserved.
