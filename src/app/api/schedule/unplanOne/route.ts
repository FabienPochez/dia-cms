import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '../../../../payload.config'
import { LibreTimeClient } from '../../../../integrations/libretimeClient'
import { checkScheduleAuth } from '../../../../lib/auth/checkScheduleAuth'

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
  // Keep identifiers outside try/catch for safe logging (avoid ReferenceError)
  let episodeIdForLog: string | undefined
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
    episodeIdForLog = episodeId

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
    const libretimeDeleted = Boolean(deleted) || deleted === false // false covers 404 "already gone"
    if (!deleted) {
      // deletePlayout() already handles 404 → false, so treat false as "already gone"
      console.log(`[SCHEDULE] schedule_unplan_ok episodeId=${episodeId} (playout already missing)`)
    }

    // Update episode to clear schedule data
    try {
      await payload.update({
        collection: 'episodes',
        id: episodeId,
        data: {
          scheduledAt: null,
          scheduledEnd: null,
          // IMPORTANT: airStatus is required and does NOT allow 'published' (see Episodes collection options)
          airStatus: 'queued',
          libretimePlayoutId: null,
          libretimeInstanceId: null,
        },
      })
    } catch (updateError: any) {
      // LibreTime deletion succeeded (or was already gone), but local state update failed.
      // Do NOT return 500; return 200 with a warning payload so UI can proceed and we can repair locally.
      console.error('[SCHEDULE] schedule_unplan_warn payload_update_failed', updateError)
      return NextResponse.json(
        {
          success: true,
          warning: {
            code: 'PAYLOAD_UPDATE_FAILED',
            message: 'LibreTime playout was deleted, but local episode update failed',
            details: updateError instanceof Error ? updateError.message : String(updateError),
          },
          libretime: {
            deleted: libretimeDeleted,
            playoutId: episode.libretimePlayoutId,
          },
          payload: {
            updated: false,
            episodeId,
          },
        },
        { status: 200 },
      )
    }

    console.log(
      `[SCHEDULE] schedule_unplan_ok episodeId=${episodeId} playoutId=${episode.libretimePlayoutId}`,
    )

    return NextResponse.json({
      success: true,
      libretime: {
        deleted: libretimeDeleted,
        playoutId: episode.libretimePlayoutId,
      },
      payload: {
        updated: true,
        episodeId,
      },
    })
  } catch (error) {
    console.error('[SCHEDULE] UnplanOne error:', error)
    console.log(
      `[SCHEDULE] schedule_unplan_fail episodeId=${episodeIdForLog || 'unknown'} error=${error instanceof Error ? error.message : 'Unknown error'}`,
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
