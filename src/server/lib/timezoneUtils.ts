import { getISOWeek } from 'date-fns'

/**
 * Timezone utilities for Europe/Paris timezone handling
 */

/**
 * Get weekly archive path from a date in Europe/Paris timezone
 * Returns format: "archive/YYYY/week-WW" where WW is zero-padded ISO week number
 *
 * @param date - Date to convert (will be treated as local time)
 * @returns Weekly path string like "archive/2025/week-42"
 */
export function getWeeklyArchivePath(date: Date): string {
  // For simplicity, use the local timezone and assume it's Europe/Paris
  // In production, you might want to use a proper timezone library

  // Get year and ISO week number
  const year = date.getFullYear()
  const week = getISOWeek(date)

  // Return formatted path with zero-padded week
  return `archive/${year}/week-${week.toString().padStart(2, '0')}`
}

/**
 * Get current date (assumes Europe/Paris timezone)
 *
 * @returns Date object
 */
export function getParisDate(): Date {
  return new Date()
}

/**
 * Convert a date (no-op for simplicity)
 *
 * @param date - Date to convert
 * @returns Date object
 */
export function toParisTime(date: Date): Date {
  return date
}

/**
 * Get ISO week number for a date
 *
 * @param date - Date to get week number for
 * @returns ISO week number (1-53)
 */
export function getParisISOWeek(date: Date): number {
  return getISOWeek(date)
}
