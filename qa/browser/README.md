# Canonical postdeploy smoke

The master-push workflow checks genuine canonical CDN assets, public SW byte hashes, the cache name read from public/sw/constants.js, backend readiness, the three primary OAuth scopes, and mobile login layout/focus. It opens one fresh Chromium context and makes no account, login submission, API mutation, intercepted response, screenshot or report file. Only bounded status and asset hashes reach stdout.

The isolated dependency lock pins official Playwright 1.65.0. The public standard GitHub runner uses no artifact upload, dependency cache or paid service. Vercel production git SHA and READY are verified separately; JS equality with a local build is not assumed because existing environment values may differ.
