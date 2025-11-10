const PARIS_TZ = 'Europe/Paris'
const DAY_MS = 24 * 60 * 60 * 1000

export interface ComputeSyncWindowOptions {
  now?: Date
  currentShowStartUtc?: string | null
}

export interface SyncWindowResult {
  parisStart: string
  parisEnd: string
  utcStart: string
  utcEnd: string
  weeksLabel: string
  windowDurationMs: number
}

function pad(value: number, length = 2): string {
  return value.toString().padStart(length, '0')
}

function getOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)
  const get = (type: string): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10)

  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hour = get('hour')
  const minute = get('minute')
  const second = get('second')

  const localMillis = Date.UTC(year, month - 1, day, hour, minute, second)
  const diffMinutes = Math.round((localMillis - date.getTime()) / 60_000)

  return diffMinutes
}

function toLocalMillis(
  date: Date,
  timeZone: string,
): { localMillis: number; offsetMinutes: number } {
  const offset = getOffsetMinutes(date, timeZone)
  const localMillis = date.getTime() + offset * 60_000
  return { localMillis, offsetMinutes: offset }
}

function localToUtcMillis(
  localMillis: number,
  timeZone: string,
): {
  utcMillis: number
  offsetMinutes: number
} {
  let guessUtc = localMillis
  let offset = getOffsetMinutes(new Date(guessUtc), timeZone)
  let candidate = localMillis - offset * 60_000

  if (candidate === guessUtc) {
    return { utcMillis: candidate, offsetMinutes: offset }
  }

  guessUtc = candidate
  offset = getOffsetMinutes(new Date(guessUtc), timeZone)
  candidate = localMillis - offset * 60_000

  if (candidate === guessUtc) {
    return { utcMillis: candidate, offsetMinutes: offset }
  }

  offset = getOffsetMinutes(new Date(candidate), timeZone)
  return { utcMillis: localMillis - offset * 60_000, offsetMinutes: offset }
}

function formatLocalIso(localMillis: number, offsetMinutes: number): string {
  const date = new Date(localMillis)
  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1)
  const day = pad(date.getUTCDate())
  const hour = pad(date.getUTCHours())
  const minute = pad(date.getUTCMinutes())
  const second = pad(date.getUTCSeconds())

  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offsetHours = pad(Math.floor(absOffset / 60))
  const offsetMins = pad(absOffset % 60)

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${offsetHours}:${offsetMins}`
}

function getIsoWeek(localMillis: number): { year: number; week: number } {
  const date = new Date(localMillis)
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  const dayOfWeek = new Date(target).getUTCDay()
  const diffToThursday = 3 - ((dayOfWeek + 6) % 7)
  const thursdayUtc = target + diffToThursday * DAY_MS
  const thursdayDate = new Date(thursdayUtc)

  const isoYear = thursdayDate.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const firstThursdayDay = firstThursday.getUTCDay()
  const firstIsoWeekStart =
    firstThursday.getTime() - (firstThursdayDay === 0 ? 6 : firstThursdayDay - 1) * DAY_MS

  const week = Math.floor((thursdayUtc - firstIsoWeekStart) / (7 * DAY_MS)) + 1

  return { year: isoYear, week }
}

function isoWeekLabel(localMillis: number): string {
  const { year, week } = getIsoWeek(localMillis)
  return `${year}-W${pad(week)}`
}

/**
 * Compute a three-week sync window anchored to Europe/Paris timezone.
 * Window covers: previous week (Mon 00:00) through next week (Sun 23:59:59.999).
 * If the currently airing show started before the computed start, the window start
 * snaps back to that show's UTC start.
 */
export function computeSyncWindow(options: ComputeSyncWindowOptions = {}): SyncWindowResult {
  const { now = new Date(), currentShowStartUtc } = options

  const { localMillis: localNowMillis } = toLocalMillis(now, PARIS_TZ)
  const localNowDate = new Date(localNowMillis)

  const dayOfWeek = localNowDate.getUTCDay()
  const diffToMonday = (dayOfWeek + 6) % 7

  const startOfTodayLocalMillis = Date.UTC(
    localNowDate.getUTCFullYear(),
    localNowDate.getUTCMonth(),
    localNowDate.getUTCDate(),
  )

  const currentWeekStartLocalMillis = startOfTodayLocalMillis - diffToMonday * DAY_MS
  const prevWeekStartLocalMillis = currentWeekStartLocalMillis - 7 * DAY_MS
  const nextWeekEndLocalMillis = currentWeekStartLocalMillis + 14 * DAY_MS - 1

  let startLocalMillis = prevWeekStartLocalMillis
  let { utcMillis: utcStartMillis, offsetMinutes: startOffsetMinutes } = localToUtcMillis(
    startLocalMillis,
    PARIS_TZ,
  )

  if (currentShowStartUtc) {
    const showStart = new Date(currentShowStartUtc)
    if (!Number.isNaN(showStart.getTime()) && showStart.getTime() < utcStartMillis) {
      const { localMillis, offsetMinutes } = toLocalMillis(showStart, PARIS_TZ)
      startLocalMillis = localMillis
      utcStartMillis = showStart.getTime()
      startOffsetMinutes = offsetMinutes
    }
  }

  const { utcMillis: utcEndMillis, offsetMinutes: endOffsetMinutes } = localToUtcMillis(
    nextWeekEndLocalMillis,
    PARIS_TZ,
  )

  const weeksLabel = `${isoWeekLabel(startLocalMillis)}..${isoWeekLabel(nextWeekEndLocalMillis)}`

  return {
    parisStart: formatLocalIso(startLocalMillis, startOffsetMinutes),
    parisEnd: formatLocalIso(nextWeekEndLocalMillis, endOffsetMinutes),
    utcStart: new Date(utcStartMillis).toISOString(),
    utcEnd: new Date(utcEndMillis).toISOString(),
    weeksLabel,
    windowDurationMs: utcEndMillis - utcStartMillis,
  }
}
