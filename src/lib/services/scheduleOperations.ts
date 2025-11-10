/**
 * Shared scheduling operations for planOne/unplanOne
 * Used by both individual endpoints and batch operations
 */

import { getPayload } from 'payload'
import config from '../../payload.config'
import { LibreTimeClient } from '../../integrations/libretimeClient'

export interface PlanOneParams {
  episodeId: string
  showId: string
  scheduledAt: string
  scheduledEnd: string
  dryRun?: boolean
}

export interface PlanOneResult {
  success: boolean
  showId?: number
  instanceId?: number
  playoutId?: number
  idempotent?: boolean
  error?: string
  code?: string
}

export interface UnplanOneParams {
  episodeId: string
  scheduledAt: string
  dryRun?: boolean
}

export interface UnplanOneResult {
  success: boolean
  noop?: boolean
  error?: string
  code?: string
}

// Helper to normalize time to UTC ISO
function normalizeToUTC(time: string): string {
  const date = new Date(time)
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date format')
  }
  return date.toISOString()
}

/**
 * Plan a single episode (schedule in LibreTime)
 * Core logic extracted from /api/schedule/planOne
 */
export async function planOne(params: PlanOneParams): Promise<PlanOneResult> {
  const { episodeId, showId, scheduledAt, scheduledEnd, dryRun = false } = params

  try {
    // Normalize times to UTC ISO
    const normalizedStart = normalizeToUTC(scheduledAt)
    const normalizedEnd = normalizeToUTC(scheduledEnd)

    // Input validation: time range
    if (normalizedEnd <= normalizedStart) {
      return {
        success: false,
        error: 'Invalid time range: end time must be after start time',
        code: 'INVALID_TIME_RANGE',
      }
    }

    const payload = await getPayload({ config })
    const ltClient = new LibreTimeClient()

    // Get episode and show data
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
      depth: 1,
    })

    if (!episode) {
      return {
        success: false,
        error: 'Episode not found',
        code: 'EPISODE_NOT_FOUND',
      }
    }

    // Input validation: show matching
    const episodeShowId = typeof episode.show === 'object' ? episode.show.id : episode.show
    if (episodeShowId !== showId) {
      return {
        success: false,
        error: 'Episode does not belong to the specified show',
        code: 'SHOW_MISMATCH',
      }
    }

    // Validate LT-ready
    if (!episode.libretimeTrackId?.trim() || !episode.libretimeFilepathRelative?.trim()) {
      return {
        success: false,
        error: 'Episode not LT-ready',
        code: 'NOT_LT_READY',
      }
    }

    // Validate track ID is numeric
    const trackId = Number(episode.libretimeTrackId)
    if (isNaN(trackId) || trackId <= 0) {
      return {
        success: false,
        error: 'Invalid libretimeTrackId - must be numeric',
        code: 'INVALID_TRACK_ID',
      }
    }

    const show =
      typeof episode.show === 'object'
        ? episode.show
        : await payload.findByID({
            collection: 'shows',
            id: showId,
          })

    if (!show) {
      return {
        success: false,
        error: 'Show not found',
        code: 'SHOW_NOT_FOUND',
      }
    }

    // Dry-run: return success without mutations
    if (dryRun) {
      return {
        success: true,
        showId: show.libretimeShowId || 0,
        instanceId: 0,
        playoutId: 0,
      }
    }

    // Ensure LT Show exists (prefer stored ID, no name matching unless flag set)
    const allowNameMatch = process.env.ALLOW_NAME_MATCH === 'true'
    const ltShow = await ltClient.ensureShow(show, allowNameMatch)
    if (!ltShow) {
      return {
        success: false,
        error: 'Failed to create LibreTime show',
        code: 'LT_SHOW_FAILED',
      }
    }

    // Always update show with LT show ID (handles stale ID case)
    if (!show.libretimeShowId || show.libretimeShowId !== ltShow.id) {
      await payload.update({
        collection: 'shows',
        id: showId,
        data: { libretimeShowId: ltShow.id },
      })
    }

    // Ensure LT Instance exists for the block window
    // Pass current instance ID if episode is already scheduled (for moves)
    const currentInstanceId = episode.libretimeInstanceId
      ? Number(episode.libretimeInstanceId)
      : undefined
    const ltInstance = await ltClient.ensureInstance(
      ltShow.id,
      normalizedStart,
      normalizedEnd,
      currentInstanceId,
    )
    if (!ltInstance) {
      return {
        success: false,
        error: 'Failed to create LibreTime instance',
        code: 'LT_INSTANCE_FAILED',
      }
    }

    // Get existing playouts for collision detection
    const existingPlayouts = await ltClient.listPlayouts(ltInstance.id)

    // Check idempotency: does a playout exist for {instanceId, trackId, start, end}?
    const existingPlayout = existingPlayouts.find(
      (p) => p.file === trackId && p.starts_at === normalizedStart && p.ends_at === normalizedEnd,
    )

    if (existingPlayout) {
      // Update episode with existing playout data
      await payload.update({
        collection: 'episodes',
        id: episodeId,
        data: {
          scheduledAt: normalizedStart,
          scheduledEnd: normalizedEnd,
          airStatus: 'scheduled',
          libretimePlayoutId: existingPlayout.id,
          libretimeInstanceId: ltInstance.id,
        },
      })

      return {
        success: true,
        idempotent: true,
        showId: ltShow.id,
        instanceId: ltInstance.id,
        playoutId: existingPlayout.id,
      }
    }

    // Create playout
    const playout = await ltClient.ensurePlayout(
      ltInstance.id,
      trackId,
      normalizedStart,
      normalizedEnd,
    )

    if (!playout) {
      // Rollback: delete instance only if still empty
      try {
        const remainingPlayouts = await ltClient.listPlayouts(ltInstance.id)
        if (remainingPlayouts.length === 0) {
          await ltClient.deleteInstance(ltInstance.id)
        }
      } catch (rollbackError) {
        console.error('[SCHEDULE] Rollback failed:', rollbackError)
      }
      return {
        success: false,
        error: 'Failed to create playout',
        code: 'LT_PLAYOUT_FAILED',
      }
    }

    // Update episode with schedule data
    await payload.update({
      collection: 'episodes',
      id: episodeId,
      data: {
        scheduledAt: normalizedStart,
        scheduledEnd: normalizedEnd,
        airStatus: 'scheduled',
        libretimePlayoutId: playout.id,
        libretimeInstanceId: ltInstance.id,
      },
    })

    return {
      success: true,
      showId: ltShow.id,
      instanceId: ltInstance.id,
      playoutId: playout.id,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'INTERNAL_ERROR',
    }
  }
}

/**
 * Unplan a single episode (remove from LibreTime schedule)
 * Core logic extracted from /api/schedule/unplanOne
 */
export async function unplanOne(params: UnplanOneParams): Promise<UnplanOneResult> {
  const { episodeId, scheduledAt, dryRun = false } = params

  try {
    // Normalize time to UTC ISO
    const normalizedScheduledAt = normalizeToUTC(scheduledAt)

    const payload = await getPayload({ config })
    const ltClient = new LibreTimeClient()

    // Get episode data
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
      depth: 0,
    })

    if (!episode) {
      return {
        success: false,
        error: 'Episode not found',
        code: 'EPISODE_NOT_FOUND',
      }
    }

    if (!episode.libretimePlayoutId) {
      return {
        success: true,
        noop: true,
      }
    }

    // Dry-run: return success without mutations
    if (dryRun) {
      return {
        success: true,
      }
    }

    // Delete playout from LibreTime
    const deleted = await ltClient.deletePlayout(episode.libretimePlayoutId)
    if (!deleted) {
      // deletePlayout() already handles 404 → false, so treat false as "already gone"
      // Continue to clear local data
    }

    // Update episode to clear schedule data
    await payload.update({
      collection: 'episodes',
      id: episodeId,
      data: {
        scheduledAt: null,
        scheduledEnd: null,
        airStatus: 'published',
        libretimePlayoutId: null,
        libretimeInstanceId: null,
      },
    })

    return {
      success: true,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'INTERNAL_ERROR',
    }
  }
}
