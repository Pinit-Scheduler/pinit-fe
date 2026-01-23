export type DateTimeWithZone = {
  dateTime: string
  zoneId: string
}

export type DateWithOffset = {
  date: string
  offset: string // e.g. "+09:00" or "-05:00"
}
