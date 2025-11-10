/**
 * Format ISO date string to relative time (e.g., "23 days ago", "in 5 days")
 * @param isoString - ISO date string
 * @param now - Current timestamp (default: Date.now())
 * @returns Relative time string in English
 */
export function formatRelativeTime(isoString: string, now: number = Date.now()): string {
  const date = new Date(isoString)
  const diffMs = date.getTime() - now
  const absDiffMs = Math.abs(diffMs)
  const isFuture = diffMs > 0

  const diffSec = Math.floor(absDiffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  const diffWeek = Math.floor(diffDay / 7)
  const diffMonth = Math.floor(diffDay / 30)
  const diffYear = Math.floor(diffDay / 365)

  // Future dates: "in X"
  if (isFuture) {
    if (diffSec < 60) return 'in moments'
    if (diffMin < 60) return `in ${diffMin} min`
    if (diffHour < 24) return `in ${diffHour} hour${diffHour > 1 ? 's' : ''}`
    if (diffDay < 7) return `in ${diffDay} day${diffDay > 1 ? 's' : ''}`
    if (diffWeek < 5) return `in ${diffWeek} week${diffWeek > 1 ? 's' : ''}`
    if (diffMonth < 12) return `in ${diffMonth} month${diffMonth > 1 ? 's' : ''}`
    return `in ${diffYear} year${diffYear > 1 ? 's' : ''}`
  }

  // Past dates: "X ago"
  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`
  if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`
  if (diffWeek < 5) return `${diffWeek} week${diffWeek > 1 ? 's' : ''} ago`
  if (diffMonth < 12) return `${diffMonth} month${diffMonth > 1 ? 's' : ''} ago`
  return `${diffYear} year${diffYear > 1 ? 's' : ''} ago`
}

/**
 * Format ISO date to YYYY-MM-DD
 */
export function formatDate(isoString: string): string {
  return isoString.split('T')[0]
}
