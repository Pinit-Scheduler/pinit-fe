self.pinitSw = self.pinitSw || {}

const { hasRecentIdempotentKey, saveIdempotentKey } = self.pinitSw.idempotency

const readPushPayload = (event) => {
  if (!event.data) return null
  try {
    return event.data.json()
  } catch (error) {
    try {
      return JSON.parse(event.data.text())
    } catch (parseError) {
      return {}
    }
  }
}

const buildNotificationOptions = (notificationPayload, dataPayload, scheduleId, idempotentKey, body) => ({
  body,
  icon: notificationPayload.icon || '/icons/pinit-app-logo.png',
  badge: '/icons/pinit-app-logo.png',
  tag: idempotentKey || (scheduleId ? `schedule-${scheduleId}` : undefined),
  data: {
    ...dataPayload,
    url: scheduleId ? `/app/schedules?scheduleId=${scheduleId}` : '/app/schedules',
  },
})

const showNotificationOnce = async (title, options, idempotencyKey) => {
  if (idempotencyKey) {
    const isDuplicate = await hasRecentIdempotentKey(idempotencyKey)
    if (isDuplicate) return
    await saveIdempotentKey(idempotencyKey)
  }
  return self.registration.showNotification(title, options)
}

self.pinitSw.push = {
  readPushPayload,
  buildNotificationOptions,
  showNotificationOnce,
}
