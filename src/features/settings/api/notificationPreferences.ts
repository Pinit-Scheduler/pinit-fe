import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type { NotificationPreferences } from '../utils/notificationPreferences'

export const fetchNotificationPreferences = () =>
  httpClient<NotificationPreferences>(buildApiUrl('/notifications/preferences', 'v2'))

export const saveNotificationPreferences = (preferences: NotificationPreferences) =>
  httpClient<NotificationPreferences>(buildApiUrl('/notifications/preferences', 'v2'), {
    method: 'PUT',
    json: preferences,
  })
