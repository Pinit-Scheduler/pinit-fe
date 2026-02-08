self.pinitSw = self.pinitSw || {}

const { CACHE_NAME } = self.pinitSw.constants

const isSameOriginGet = (request) =>
  request.method === 'GET' && new URL(request.url).origin === self.location.origin

const cacheFirst = async (request) => {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    const copy = response.clone()
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
    return response
  } catch {
    return cached
  }
}

self.pinitSw.cache = {
  isSameOriginGet,
  cacheFirst,
}
