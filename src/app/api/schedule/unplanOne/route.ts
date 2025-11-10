import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '../../../../payload.config'
import { LibreTimeClient } from '../../../../integrations/libretimeClient'

export const runtime = 'nodejs'

interface UnplanOneRequest {
  episodeId: string
  scheduledAt: string
}

// Helper to normalize time to UTC ISO
function normalizeToUTC(time: string): string {
  const date = new Date(time)
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date format')
  }
  return date.toISOString()
}

export async function DELETE(request: NextRequest) {
  try {
    let body: UnplanOneRequest

    // Support both JSON body and querystring fallback
    const contentType = request.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      body = await request.json()
    } else {
      const url = new URL(request.url)
      body = {
        episodeId: url.searchParams.get('episodeId') || '',
        scheduledAt: url.searchParams.get('scheduledAt') || '',
      }
    }

    const { episodeId, scheduledAt } = body

    if (!episodeId || !scheduledAt) {
      return NextResponse.json(
        {
          error: 'Missing required fields: episodeId, scheduledAt',
          code: 'MISSING_FIELDS',
        },
        { status: 400 },
      )
    }

    // Normalize time to UTC ISO
    const normalizedScheduledAt = normalizeToUTC(scheduledAt)

    const payload = await getPayload({ config })
    const ltClient = new LibreTimeClient()

    // Get episode data
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
    })

    if (!episode) {
      return NextResponse.json(
        { error: 'Episode not found', code: 'EPISODE_NOT_FOUND' },
        { status: 404 },
      )
    }

    if (!episode.libretimePlayoutId) {
      console.log(`[SCHEDULE] schedule_unplan_ok episodeId=${episodeId} (no playout to remove)`)
      return NextResponse.json({ success: true, noop: true })
    }

    // Delete playout from LibreTime
    const deleted = await ltClient.deletePlayout(episode.libretimePlayoutId)
    if (!deleted) {
      // deletePlayout() already handles 404 → false, so treat false as "already gone"
      console.log(`[SCHEDULE] schedule_unplan_ok episodeId=${episodeId} (playout already missing)`)
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

    console.log(
      `[SCHEDULE] schedule_unplan_ok episodeId=${episodeId} playoutId=${episode.libretimePlayoutId}`,
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[SCHEDULE] UnplanOne error:', error)
    console.log(
      `[SCHEDULE] schedule_unplan_fail episodeId=${episodeId} error=${error instanceof Error ? error.message : 'Unknown error'}`,
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
