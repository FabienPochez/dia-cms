import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '../../../../payload.config'
import { checkScheduleAuth } from '../../../../lib/auth/checkScheduleAuth'

export const runtime = 'nodejs'

/**
 * Create a schedule entry in LibreTime
 * Resolves instance ID from episode's parent show
 * 
 * Security: Requires admin/staff authentication
 */
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

    const body = await request.json()
    const { episodeId, startsAt, endsAt } = body

    if (!episodeId || !startsAt || !endsAt) {
      return NextResponse.json(
        {
          error: 'Missing required fields: episodeId, startsAt, endsAt',
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

    // Forward to LibreTime API with instance header
    const ltResponse = await fetch(
      `${process.env.LIBRETIME_API_URL || 'http://api:9001'}/api/v2/schedule`,
      {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${process.env.LIBRETIME_API_KEY}`,
          'Content-Type': 'application/json',
          'x-lt-instance-id': show.libretimeInstanceId,
        },
        body: JSON.stringify({
          file: Number(episode.libretimeTrackId),
          instance: 1, // LibreTime instance ID (we use the header for routing)
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
          position: 0,
          cue_in: '00:00:00',
        }),
      },
    )

    if (!ltResponse.ok) {
      const errorData = await ltResponse.json().catch(() => ({}))
      console.error('[SCHEDULE] LibreTime create failed:', ltResponse.status, errorData)
      return NextResponse.json(
        {
          error: 'Failed to create schedule in LibreTime',
          code: 'LT_CREATE_FAILED',
          details: errorData,
        },
        { status: ltResponse.status },
      )
    }

    const scheduleData = await ltResponse.json()

    console.log(
      `[SCHEDULE] Created schedule for episode ${episodeId} on instance ${show.libretimeInstanceId}:`,
      scheduleData,
    )

    // Update episode with schedule data
    await payload.update({
      collection: 'episodes',
      id: episodeId,
      data: {
        scheduledAt: startsAt,
        scheduledEnd: endsAt,
        airStatus: 'scheduled',
        libretimeScheduleId: scheduleData.id,
      },
    })

    return NextResponse.json({
      success: true,
      scheduleId: scheduleData.id,
      instanceId: show.libretimeInstanceId,
    })
  } catch (error) {
    console.error('[SCHEDULE] Create error:', error)
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
