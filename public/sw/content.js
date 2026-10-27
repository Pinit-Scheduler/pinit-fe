self.pinitSw = self.pinitSw || {}

// 푸시 문구(ADR-0021 §7). 서버는 data-only 메시지에 kind를 싣는다.
// 일정 알림은 시각 문구를 기기 시간대로 여기서 만들고, 그 밖의 종류는 서버가 만든 title/body를 그대로 쓴다.
const getNotificationContent = (notificationPayload, dataPayload, formattedStart) => {
  if (notificationPayload.title) {
    return { title: notificationPayload.title, body: notificationPayload.body || '' }
  }
  const { kind, scheduleTitle, scheduleStartTime, reminderMinutes } = dataPayload
  const scheduleLabel = formattedStart || scheduleStartTime

  if (kind && kind !== 'SCHEDULE_START' && kind !== 'SCHEDULE_REMINDER') {
    return { title: dataPayload.title || '핀잇 알림', body: dataPayload.body || '' }
  }
  if (kind === 'SCHEDULE_REMINDER') {
    const lead = Number(reminderMinutes) === 60 ? '1시간' : `${reminderMinutes}분`
    return {
      title: scheduleTitle ? `"${scheduleTitle}" ${lead} 후 시작` : `일정이 ${lead} 후 시작돼요`,
      body: scheduleLabel ? `${scheduleLabel} 시작 예정이에요.` : '곧 일정이 시작돼요.',
    }
  }
  return {
    title: scheduleTitle ? `"${scheduleTitle}" 일정이 시작돼요` : '일정 시작 알림',
    body: scheduleLabel ? `${scheduleLabel} 시작 예정이에요.` : '일정이 곧 시작돼요.',
  }
}

self.pinitSw.content = {
  getNotificationContent,
}
