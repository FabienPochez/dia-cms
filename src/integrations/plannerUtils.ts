/**
 * Planner utility functions for LibreTime integration
 *
 * Handles timezone conversions, overlap detection, and episode updates
 */

import { libreTimeApi } from './libretimeApi'

export interface EpisodeScheduleData {
  episodeId: string
  libretimeTrackId?: string
  durationMinutes: number
  startsAt: Date
  endsAt: Date
}

export interface ScheduleConflict {
  type: 'overlap' | 'missing_file' | 'invalid_time'
  message: string
  details?: string
}

/**
 * Convert a Date to UTC ISO string
 */
export function toUTCISO(date: Date): string {
  return date.toISOString()
}

/**
 * Convert Europe/Paris time to UTC
 * For now, assumes the date is already in the correct timezone
 * In production, you might want to use a proper timezone library like date-fns-tz
 */
export function parisToUTC(date: Date): string {
  return date.toISOString()
}

/**
 * Validate schedule window for basic conflicts
 */
export async function validateScheduleWindow(
  startsAt: Date,
  endsAt: Date,
  excludeScheduleId?: number,
): Promise<{ valid: boolean; conflicts: ScheduleConflict[] }> {
  const conflicts: ScheduleConflict[] = []

  // Basic time validation
  if (startsAt >= endsAt) {
    conflicts.push({
      type: 'invalid_time',
      message: 'Start time must be before end time',
    })
  }

  if (startsAt < new Date()) {
    conflicts.push({
      type: 'invalid_time',
      message: 'Cannot schedule in the past',
    })
  }

  // Check for overlaps with LibreTime
  try {
    const overlapResponse = await libreTimeApi.checkOverlaps(
      toUTCISO(startsAt),
      toUTCISO(endsAt),
      excludeScheduleId,
    )

    if (overlapResponse.success && overlapResponse.data && overlapResponse.data.length > 0) {
      conflicts.push({
        type: 'overlap',
        message: `Schedule conflicts with ${overlapResponse.data.length} existing entry(ies)`,
        details: overlapResponse.data
          .map((s) => `${s.starts_at} - ${s.ends_at} (File ID: ${s.file})`)
          .join(', '),
      })
    }
  } catch (error) {
    console.warn('[PLANNER] Overlap check failed:', error)
    // Don't block scheduling if overlap check fails
  }

  return {
    valid: conflicts.length === 0,
    conflicts,
  }
}

/**
 * Validate that a file exists in LibreTime
 */
export async function validateFile(
  fileId: string | number,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await libreTimeApi.validateFile(Number(fileId))

    if (!response.success) {
      return {
        valid: false,
        error: response.error || 'File validation failed',
      }
    }

    return {
      valid: response.data || false,
      error: response.data ? undefined : 'File not found or not available for scheduling',
    }
  } catch (error) {
    console.error('[PLANNER] File validation error:', error)
    return {
      valid: false,
      error: 'File validation failed due to network error',
    }
  }
}

/**
 * Update episode in Payload with schedule data
 */
export async function updateEpisodeSchedule(
  episodeId: string,
  data: {
    scheduledAt?: string
    scheduledEnd?: string
    airStatus?: string
    libretimeScheduleId?: number
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[PLANNER] Updating episode schedule:', { episodeId, data })

    const response = await fetch(`/api/episodes/${episodeId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Failed to update episode: ${response.status} ${response.statusText} - ${errorText}`,
      )
    }

    console.log('[PLANNER] Episode updated successfully:', episodeId)
    return { success: true }
  } catch (error) {
    console.error('[PLANNER] Failed to update episode:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create a schedule entry in LibreTime
 */
export async function createLibreTimeSchedule(
  episodeId: string,
  data: EpisodeScheduleData,
): Promise<{ success: boolean; scheduleId?: number; error?: string; code?: string }> {
  try {
    // Validate file if we have a track ID
    if (data.libretimeTrackId) {
      const fileValidation = await validateFile(data.libretimeTrackId)
      if (!fileValidation.valid) {
        return {
          success: false,
          error: `File validation failed: ${fileValidation.error}`,
        }
      }
    } else {
      return {
        success: false,
        error: 'No LibreTime track ID available for this episode',
      }
    }

    // Validate schedule window
    const validation = await validateScheduleWindow(data.startsAt, data.endsAt)
    if (!validation.valid) {
      return {
        success: false,
        error: validation.conflicts.map((c) => c.message).join('; '),
      }
    }

    // Use new server endpoint that handles instance mapping
    const response = await fetch('/api/schedule/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        episodeId,
        startsAt: data.startsAt.toISOString(),
        endsAt: data.endsAt.toISOString(),
      }),
    })

    const result = await response.json()

    if (!response.ok) {
      console.error('[PLANNER] Schedule create failed:', result)
      return {
        success: false,
        error: result.error || 'Failed to create schedule',
        code: result.code,
      }
    }

    console.log('[PLANNER] LibreTime schedule created:', result)
    return {
      success: true,
      scheduleId: result.scheduleId,
    }
  } catch (error) {
    console.error('[PLANNER] Failed to create LibreTime schedule:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Update a schedule entry in LibreTime with fallback
 */
export async function updateLibreTimeSchedule(
  scheduleId: number,
  startsAt: Date,
  endsAt: Date,
  episodeId?: string,
  fileId?: number,
  instanceId?: number,
): Promise<{
  success: boolean
  scheduleId?: number
  error?: string
  usedFallback?: boolean
  code?: string
}> {
  try {
    // Validate schedule window
    const validation = await validateScheduleWindow(startsAt, endsAt, scheduleId)
    if (!validation.valid) {
      return {
        success: false,
        error: validation.conflicts.map((c) => c.message).join('; '),
      }
    }

    // Use new server endpoint if we have episodeId
    if (episodeId) {
      const response = await fetch('/api/schedule/move', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scheduleId,
          episodeId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        console.error('[PLANNER] Schedule move failed:', result)
        return {
          success: false,
          error: result.error || 'Failed to move schedule',
          code: result.code,
        }
      }

      console.log('[PLANNER] LibreTime schedule moved:', result)
      return {
        success: true,
        scheduleId: result.scheduleId,
        usedFallback: result.usedFallback || false,
      }
    }

    // Fallback to old method if no episodeId
    if (fileId && instanceId) {
      const response = await libreTimeApi.moveScheduleWithFallback(
        scheduleId,
        fileId,
        instanceId,
        toUTCISO(startsAt),
        toUTCISO(endsAt),
      )

      if (!response.success) {
        return {
          success: false,
          error: response.error || 'Failed to move schedule in LibreTime',
        }
      }

      console.log('[PLANNER] LibreTime schedule moved:', response.data)
      return {
        success: true,
        scheduleId: response.data?.scheduleId,
        usedFallback: response.data?.usedFallback || false,
      }
    }

    // Fallback to regular update if no fileId/instanceId
    const response = await libreTimeApi.updateSchedule(scheduleId, {
      starts_at: toUTCISO(startsAt),
      ends_at: toUTCISO(endsAt),
      position: 0,
      cue_in: '00:00:00',
    })

    if (!response.success) {
      return {
        success: false,
        error: response.error || 'Failed to update schedule in LibreTime',
      }
    }

    console.log('[PLANNER] LibreTime schedule updated:', response.data)
    return {
      success: true,
      scheduleId: response.data?.id,
      usedFallback: false,
    }
  } catch (error) {
    console.error('[PLANNER] Failed to update LibreTime schedule:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Delete a schedule entry from LibreTime
 */
export async function deleteLibreTimeSchedule(
  scheduleId: number,
  episodeId?: string,
): Promise<{ success: boolean; error?: string; code?: string }> {
  try {
    // Use new server endpoint if we have episodeId
    if (episodeId) {
      const response = await fetch(
        `/api/schedule/delete?scheduleId=${scheduleId}&episodeId=${episodeId}`,
        {
          method: 'DELETE',
        },
      )

      const result = await response.json()

      if (!response.ok) {
        console.error('[PLANNER] Schedule delete failed:', result)
        return {
          success: false,
          error: result.error || 'Failed to delete schedule',
          code: result.code,
        }
      }

      console.log('[PLANNER] LibreTime schedule deleted:', scheduleId)
      return { success: true }
    }

    // Fallback to old method if no episodeId
    const response = await libreTimeApi.deleteSchedule(scheduleId)

    if (!response.success) {
      return {
        success: false,
        error: response.error || 'Failed to delete schedule from LibreTime',
      }
    }

    console.log('[PLANNER] LibreTime schedule deleted:', scheduleId)
    return { success: true }
  } catch (error) {
    console.error('[PLANNER] Failed to delete LibreTime schedule:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Show toast notification
 */
export function showToast(message: string, type: 'success' | 'error' | 'warning' = 'info') {
  // This would integrate with your toast system
  // For now, just log to console
  const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '✅'
  console.log(`${prefix} [PLANNER] ${message}`)

  // TODO: Integrate with actual toast system
  // toast[type](message)
}

/**
 * Debounce function for preventing duplicate operations
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      func(...args)
    }, wait)
  }
}
