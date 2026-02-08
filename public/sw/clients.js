self.pinitSw = self.pinitSw || {}

const resolveTargetUrl = (notification) => {
  const targetPath = (notification && notification.data && notification.data.url) || '/app/schedules'
  return new URL(targetPath, self.location.origin).href
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
