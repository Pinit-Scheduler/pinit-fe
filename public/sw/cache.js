self.pinitSw = self.pinitSw || {}

const { CACHE_NAME: SW_CACHE_NAME, OFFLINE_URL } = self.pinitSw.constants

const isSameOriginGet = (request) =>
  request.method === 'GET' && new URL(request.url).origin === self.location.origin

// 오프라인에서 처음 여는 화면 주소는 캐시에 없다. 앱 껍데기(index.html)를 주면 앱이 오프라인 안내를 띄우고,
// 그것도 없으면(설치 직후 등) 정적 오프라인 화면을 준다.
const offlineNavigationFallback = async () =>
  (await caches.match('/index.html')) || (await caches.match(OFFLINE_URL)) || Response.error()

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
