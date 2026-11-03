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
  return cached.every((response) => response?.ok)
}

// 오프라인에서 처음 여는 화면 주소는 캐시에 없다. 앱 껍데기(index.html)와 그 산출물이 모두 캐시에 있으면
// 껍데기를 줘서 앱이 오프라인 안내를 띄우게 하고, 아니면 빈 화면 대신 정적 오프라인 화면을 준다.
const offlineNavigationFallback = async () => {
  const shell = await caches.match('/index.html')
  if (shell?.ok && (await isShellUsable(shell))) return shell
  const offline = await caches.match(OFFLINE_URL)
  return offline?.ok ? offline : Response.error()
}

const saveResponse = async (request, response, updateShell = false) => {
  if (!response.ok) return
  try {
    const cache = await caches.open(SW_CACHE_NAME)
    await cache.put(request, response.clone())
    if (updateShell) await cache.put('/index.html', response.clone())
  } catch {
    // 저장 공간 부족 등으로 캐시를 쓸 수 없어도 정상 온라인 응답은 보여 준다.
  }
}

// 변경되는 HTML은 항상 네트워크에서 먼저 받는다. 정상 HTML을 canonical shell에도
// 저장하여 이후 다른 앱 주소를 오프라인으로 열 때 가장 최근 껍데기를 사용할 수 있게 한다.
const networkFirstNavigation = async (request) => {
  try {
    const response = await fetch(request)
    if (!response.ok) return offlineNavigationFallback()
    if (response.headers.get('content-type')?.includes('text/html')) {
      await saveResponse(request, response, true)
    }
    return response
  } catch {
    return offlineNavigationFallback()
  }
}

const cacheFirst = async (request) => {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    await saveResponse(request, response)
    return response
  } catch {
    return Response.error()
  }
}

self.pinitSw.cache = {
  isSameOriginGet,
  cacheFirst,
  networkFirstNavigation,
}
