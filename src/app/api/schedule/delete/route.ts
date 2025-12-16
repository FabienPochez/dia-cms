import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '../../../../payload.config'
import { checkScheduleAuth } from '../../../../lib/auth/checkScheduleAuth'

export const runtime = 'nodejs'

/**
 * Delete a schedule entry in LibreTime
 * Resolves instance ID from episode's parent show
 * 
 * Security: Requires admin/staff authentication
 */
export async function DELETE(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)
    const scheduleId = searchParams.get('scheduleId')
    const episodeId = searchParams.get('episodeId')

    if (!scheduleId || !episodeId) {
      return NextResponse.json(
        {
          error: 'Missing required parameters: scheduleId, episodeId',
          code: 'MISSING_PARAMS',
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

    // Delete schedule from LibreTime
    const deleteResponse = await fetch(
      `${process.env.LIBRETIME_API_URL || 'http://api:9001'}/api/v2/schedule/${scheduleId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Api-Key ${process.env.LIBRETIME_API_KEY}`,
          'x-lt-instance-id': show.libretimeInstanceId,
        },
      },
    )

    if (!deleteResponse.ok && deleteResponse.status !== 204) {
      const errorData = await deleteResponse.json().catch(() => ({}))
      console.error('[SCHEDULE] LibreTime delete failed:', deleteResponse.status, errorData)
      return NextResponse.json(
        {
          error: 'Failed to delete schedule in LibreTime',
          code: 'LT_DELETE_FAILED',
          details: errorData,
        },
        { status: deleteResponse.status },
      )
    }

    console.log(
      `[SCHEDULE] Deleted schedule ${scheduleId} for episode ${episodeId} on instance ${show.libretimeInstanceId}`,
    )

    // Update episode to clear schedule data
    await payload.update({
      collection: 'episodes',
      id: episodeId,
      data: {
        scheduledAt: null,
        scheduledEnd: null,
        airStatus: 'unscheduled',
        libretimeScheduleId: null,
      },
    })

    return NextResponse.json({
      success: true,
      instanceId: show.libretimeInstanceId,
    })
  } catch (error) {
    console.error('[SCHEDULE] Delete error:', error)
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
