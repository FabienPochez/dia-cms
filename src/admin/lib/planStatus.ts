export type PlanStatus = 'recent' | 'future' | 'old' | 'none'

export const PLANNED_RECENT_DAYS = 30

/**
 * Determine the plan status of an episode based on its scheduledAt timestamp
 * @param scheduledAt - ISO date string of when episode is/was scheduled
 * @param now - Current timestamp (default: Date.now())
 * @returns Plan status: recent (last 30 days), future, old (>30 days ago), or none
 */
export function getPlanStatus(scheduledAt?: string | null, now: number = Date.now()): PlanStatus {
  if (!scheduledAt) return 'none'

  const ts = new Date(scheduledAt).getTime()
  if (isNaN(ts)) return 'none'

  const diffMs = now - ts
  const days = diffMs / (1000 * 60 * 60 * 24)

  // Future: scheduled after now
  if (ts > now) return 'future'

  // Recent: scheduled within last 30 days
  if (days <= PLANNED_RECENT_DAYS) return 'recent'

  // Old: scheduled more than 30 days ago
  return 'old'
}
