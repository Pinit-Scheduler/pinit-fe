self.pinitSw = self.pinitSw || {}

const DEFAULT_TARGET_PATH = '/app/schedules'

// 알림을 누르면 앱 안 경로로만 연다. 다른 출처 주소가 오면 기본 화면으로 간다.
const resolveTargetUrl = (notification) => {
  const targetPath = (notification && notification.data && notification.data.url) || DEFAULT_TARGET_PATH
  const target = new URL(targetPath, self.location.origin)
  return target.origin === self.location.origin
    ? target.href
    : new URL(DEFAULT_TARGET_PATH, self.location.origin).href
}

const focusOrOpenClient = async (targetUrl) => {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) {
    const isSamePath = client.url === targetUrl
    if ('focus' in client) {
      if (isSamePath) {
        return client.focus()
      }
      if ('navigate' in client) {
        client.navigate(targetUrl)
      }
      return client.focus()
    }
  }
  if (self.clients.openWindow) {
    return self.clients.openWindow(targetUrl)
  }
  return null
}

self.pinitSw.clients = {
  resolveTargetUrl,
  focusOrOpenClient,
}
