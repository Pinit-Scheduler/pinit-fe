self.pinitSw = self.pinitSw || {}

const { CACHE_NAME: SW_CACHE_NAME, OFFLINE_URL } = self.pinitSw.constants

const isSameOriginGet = (request) =>
  request.method === 'GET' && new URL(request.url).origin === self.location.origin

// index.html이 부르는 빌드 산출물(/assets/...). 서비스 워커는 첫 방문 load 뒤에 등록되므로
// 첫 방문의 산출물은 캐시에 없을 수 있다.
const SHELL_ASSET_PATTERN = /(?:src|href)="(\/assets\/[^"]+)"/g

const isShellUsable = async (shell) => {
  const html = await shell.clone().text()
  const assets = [...html.matchAll(SHELL_ASSET_PATTERN)].map((match) => match[1])
  const cached = await Promise.all(assets.map((asset) => caches.match(asset)))
  return cached.every(Boolean)
}

// 오프라인에서 처음 여는 화면 주소는 캐시에 없다. 앱 껍데기(index.html)와 그 산출물이 모두 캐시에 있으면
// 껍데기를 줘서 앱이 오프라인 안내를 띄우게 하고, 아니면 빈 화면 대신 정적 오프라인 화면을 준다.
const offlineNavigationFallback = async () => {
  const shell = await caches.match('/index.html')
  if (shell && (await isShellUsable(shell))) return shell
  return (await caches.match(OFFLINE_URL)) || Response.error()
}

const cacheFirst = async (request) => {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    const copy = response.clone()
    caches.open(SW_CACHE_NAME).then((cache) => cache.put(request, copy))
    return response
  } catch {
    return request.mode === 'navigate' ? offlineNavigationFallback() : Response.error()
  }
}

self.pinitSw.cache = {
  isSameOriginGet,
  cacheFirst,
}
