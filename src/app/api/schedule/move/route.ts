import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '../../../../payload.config'

export const runtime = 'nodejs'

/**
 * Move a schedule entry in LibreTime
 * Resolves instance ID from episode's parent show
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { scheduleId, episodeId, startsAt, endsAt } = body

    if (!scheduleId || !episodeId || !startsAt || !endsAt) {
      return NextResponse.json(
        {
          error: 'Missing required fields: scheduleId, episodeId, startsAt, endsAt',
          code: 'MISSING_FIELDS',
        },
        { status: 400 },
      )
    }

    // Initialize Payload
    const payload = await getPayload({ config })

    // Get episode with show data
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
      depth: 1, // Include show data
    })

    if (!episode) {
      return NextResponse.json(
        {
          error: 'Episode not found',
          code: 'EPISODE_NOT_FOUND',
        },
        { status: 404 },
      )
    }

    // Check if episode has a show and if show has libretimeInstanceId
    if (!episode.show || typeof episode.show === 'string') {
      return NextResponse.json(
        {
          error: 'Episode must have a show',
          code: 'NO_SHOW',
        },
        { status: 400 },
      )
    }

    const show =
      typeof episode.show === 'object'
        ? episode.show
        : await payload.findByID({
            collection: 'shows',
            id: episode.show,
          })

    if (!show?.libretimeInstanceId) {
      return NextResponse.json(
        {
          error: 'Show must be mapped to a LibreTime instance',
          code: 'LT_INSTANCE_REQUIRED',
          message: 'Show must be mapped to a LibreTime instance.',
        },
        { status: 400 },
      )
    }

    // Check if episode has libretimeTrackId
    if (!episode.libretimeTrackId) {
      return NextResponse.json(
        {
          error: 'Episode has no LibreTime track ID',
          code: 'NO_TRACK_ID',
        },
        { status: 400 },
      )
    }

    // Use the existing move endpoint with fallback
    const moveResponse = await fetch(
      `${process.env.LIBRETIME_API_URL || 'http://api:9001'}/api/v2/schedule/move`,
      {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${process.env.LIBRETIME_API_KEY}`,
          'Content-Type': 'application/json',
          'x-lt-instance-id': show.libretimeInstanceId,
        },
        body: JSON.stringify({
          scheduleId: Number(scheduleId),
          fileId: Number(episode.libretimeTrackId),
          instanceId: 1, // LibreTime instance ID (we use the header for routing)
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      },
    )

    if (!moveResponse.ok) {
      const errorData = await moveResponse.json().catch(() => ({}))
      console.error('[SCHEDULE] LibreTime move failed:', moveResponse.status, errorData)
      return NextResponse.json(
        {
          error: 'Failed to move schedule in LibreTime',
          code: 'LT_MOVE_FAILED',
          details: errorData,
        },
        { status: moveResponse.status },
      )
    }

    const moveData = await moveResponse.json()

    console.log(
      `[SCHEDULE] Moved schedule ${scheduleId} for episode ${episodeId} on instance ${show.libretimeInstanceId}:`,
      moveData,
    )

    // Update episode with new schedule data
    await payload.update({
      collection: 'episodes',
      id: episodeId,
      data: {
        scheduledAt: startsAt,
        scheduledEnd: endsAt,
        airStatus: 'scheduled',
        libretimeScheduleId: moveData.scheduleId || scheduleId,
      },
    })

    return NextResponse.json({
      success: true,
      scheduleId: moveData.scheduleId || scheduleId,
      usedFallback: moveData.usedFallback || false,
      instanceId: show.libretimeInstanceId,
    })
  } catch (error) {
    console.error('[SCHEDULE] Move error:', error)
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
