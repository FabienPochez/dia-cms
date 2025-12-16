import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '../../../../payload.config'
import { LibreTimeClient } from '../../../../integrations/libretimeClient'
import { checkScheduleAuth } from '../../../../lib/auth/checkScheduleAuth'

export const runtime = 'nodejs'

interface PlanOneRequest {
  showId: string
  episodeId: string
  scheduledAt: string
  scheduledEnd: string
}

// Helper to normalize time to UTC ISO
function normalizeToUTC(time: string): string {
  const date = new Date(time)
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date format')
  }
  return date.toISOString()
}

// Helper to check if two time intervals overlap
function intervalsOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  const s1 = new Date(start1).getTime()
  const e1 = new Date(end1).getTime()
  const s2 = new Date(start2).getTime()
  const e2 = new Date(end2).getTime()

  return s1 < e2 && s2 < e1
}

export async function POST(request: NextRequest) {
  try {
    // Security: Require admin or staff authentication
    const auth = await checkScheduleAuth(request)
    if (!auth.authorized) {
      return NextResponse.json(
        {
          error: auth.error || 'Unauthorized - admin/staff only',
        },
        { status: 403 },
      )
    }

    const body: PlanOneRequest = await request.json()
    const { showId, episodeId, scheduledAt, scheduledEnd } = body

    if (!showId || !episodeId || !scheduledAt || !scheduledEnd) {
      return NextResponse.json(
        {
          error: 'Missing required fields: showId, episodeId, scheduledAt, scheduledEnd',
          code: 'MISSING_FIELDS',
        },
        { status: 400 },
      )
    }

    // Normalize times to UTC ISO
    const normalizedStart = normalizeToUTC(scheduledAt)
    const normalizedEnd = normalizeToUTC(scheduledEnd)

    // Input validation: time range
    if (normalizedEnd <= normalizedStart) {
      return NextResponse.json(
        {
          error: 'Invalid time range: end time must be after start time',
          code: 'INVALID_TIME_RANGE',
        },
        { status: 400 },
      )
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
      return NextResponse.json(
        { error: 'Episode not found', code: 'EPISODE_NOT_FOUND' },
        { status: 404 },
      )
    }

    // Input validation: show matching
    const episodeShowId = typeof episode.show === 'object' ? episode.show.id : episode.show
    if (episodeShowId !== showId) {
      return NextResponse.json(
        {
          error: 'Episode does not belong to the specified show',
          code: 'SHOW_MISMATCH',
        },
        { status: 400 },
      )
    }

    // Validate LT-ready
    if (!episode.libretimeTrackId?.trim() || !episode.libretimeFilepathRelative?.trim()) {
      return NextResponse.json(
        { error: 'Episode not LT-ready', code: 'NOT_LT_READY' },
        { status: 400 },
      )
    }

    // Validate track ID is numeric
    const trackId = Number(episode.libretimeTrackId)
    if (isNaN(trackId) || trackId <= 0) {
      return NextResponse.json(
        { error: 'Invalid libretimeTrackId - must be numeric', code: 'INVALID_TRACK_ID' },
        { status: 400 },
      )
    }

    const show =
      typeof episode.show === 'object'
        ? episode.show
        : await payload.findByID({
            collection: 'shows',
            id: showId,
          })

    if (!show) {
      return NextResponse.json({ error: 'Show not found', code: 'SHOW_NOT_FOUND' }, { status: 404 })
    }

    // Ensure LT Show exists (prefer stored ID, no name matching unless flag set)
    const allowNameMatch = process.env.ALLOW_NAME_MATCH === 'true'
    const ltShow = await ltClient.ensureShow(show, allowNameMatch)
    if (!ltShow) {
      return NextResponse.json(
        { error: 'Failed to create LibreTime show', code: 'LT_SHOW_FAILED' },
        { status: 500 },
      )
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
    const ltInstance = await ltClient.ensureInstance(ltShow.id, normalizedStart, normalizedEnd)
    if (!ltInstance) {
      return NextResponse.json(
        { error: 'Failed to create LibreTime instance', code: 'LT_INSTANCE_FAILED' },
        { status: 500 },
      )
    }

    // Get existing playouts for collision detection
    const existingPlayouts = await ltClient.listPlayouts(ltInstance.id)

    // Check idempotency: does a playout exist for {instanceId, trackId, start, end}?
    const existingPlayout = existingPlayouts.find(
      (p) => p.file === trackId && p.starts_at === normalizedStart && p.ends_at === normalizedEnd,
    )

    if (existingPlayout) {
      console.log(
        `[SCHEDULE] schedule_plan_idempotent episodeId=${episodeId} showId=${showId} instanceId=${ltInstance.id} playoutId=${existingPlayout.id}`,
      )

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

      return NextResponse.json({
        success: true,
        idempotent: true,
        showId: ltShow.id,
        instanceId: ltInstance.id,
        playoutId: existingPlayout.id,
      })
    }

    // Check for overlaps with same track (409 for double-drops with shifted seconds)
    const sameTrackOverlap = existingPlayouts.find(
      (p) =>
        p.file === trackId &&
        intervalsOverlap(normalizedStart, normalizedEnd, p.starts_at, p.ends_at),
    )

    if (sameTrackOverlap) {
      console.log(
        `[SCHEDULE] schedule_plan_conflict episodeId=${episodeId} showId=${showId} instanceId=${ltInstance.id} conflictId=${sameTrackOverlap.id} (same track overlap)`,
      )
      return NextResponse.json(
        {
          error: 'Track already scheduled in overlapping time slot',
          code: 'TRACK_OVERLAP',
          details: {
            conflictingPlayoutId: sameTrackOverlap.id,
            conflictingStart: sameTrackOverlap.starts_at,
            conflictingEnd: sameTrackOverlap.ends_at,
          },
        },
        { status: 409 },
      )
    }

    // Check for overlaps with other tracks
    const conflictingPlayout = existingPlayouts.find((p) =>
      intervalsOverlap(normalizedStart, normalizedEnd, p.starts_at, p.ends_at),
    )

    if (conflictingPlayout) {
      console.log(
        `[SCHEDULE] schedule_plan_conflict episodeId=${episodeId} showId=${showId} instanceId=${ltInstance.id} conflictId=${conflictingPlayout.id}`,
      )
      return NextResponse.json(
        {
          error: 'Time slot overlaps with existing content',
          code: 'SLOT_OVERLAP',
          details: {
            conflictingPlayoutId: conflictingPlayout.id,
            conflictingStart: conflictingPlayout.starts_at,
            conflictingEnd: conflictingPlayout.ends_at,
          },
        },
        { status: 409 },
      )
    }

    // Optional: Validate track duration against block length (soft warning)
    const blockDurationMs = new Date(normalizedEnd).getTime() - new Date(normalizedStart).getTime()
    const blockDurationMinutes = blockDurationMs / (1000 * 60)

    // Get track duration from LibreTime if available
    try {
      const trackInfo = await ltClient.getFile(trackId)
      if (trackInfo && trackInfo.length) {
        const trackDurationMs = this.parseDurationToMs(trackInfo.length)
        const trackDurationMinutes = trackDurationMs / (1000 * 60)

        if (trackDurationMinutes > blockDurationMinutes) {
          console.warn(
            `[SCHEDULE] Track duration (${trackDurationMinutes.toFixed(1)}min) exceeds block duration (${blockDurationMinutes.toFixed(1)}min)`,
          )
          // Continue anyway - let LibreTime handle it
        }
      }
    } catch (error) {
      // Track info not available, continue without validation
      console.warn('[SCHEDULE] Could not validate track duration against block length')
    }

    // Create playout (no forced cue_out for hard-timed blocks)
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
      return NextResponse.json(
        { error: 'Failed to create playout', code: 'LT_PLAYOUT_FAILED' },
        { status: 500 },
      )
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

    console.log(
      `[SCHEDULE] schedule_plan_ok episodeId=${episodeId} showId=${showId} instanceId=${ltInstance.id} playoutId=${playout.id}`,
    )

    return NextResponse.json({
      success: true,
      showId: ltShow.id,
      instanceId: ltInstance.id,
      playoutId: playout.id,
    })
  } catch (error) {
    console.error('[SCHEDULE] PlanOne error:', error)
    console.log(
      `[SCHEDULE] schedule_plan_fail episodeId=${episodeId || 'unknown'} error=${error instanceof Error ? error.message : 'Unknown error'}`,
    )
    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

// Helper to parse LibreTime duration format (HH:MM:SS.sss) to milliseconds
function parseDurationToMs(duration: string): number {
  const parts = duration.split(':')
  if (parts.length !== 3) return 0

  const hours = parseInt(parts[0], 10) || 0
  const minutes = parseInt(parts[1], 10) || 0
  const seconds = parseFloat(parts[2]) || 0

  return (hours * 3600 + minutes * 60 + seconds) * 1000
}
