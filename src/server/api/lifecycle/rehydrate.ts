/**
 * Lifecycle API - Rehydrate Episode
 * POST /api/lifecycle/rehydrate
 *
 * Restores working files from archive when LibreTime path exists but local file is missing.
 * Staff/admin only endpoint.
 */

import { NextRequest, NextResponse } from 'next/server'
import { rehydrateEpisode } from '../../../../scripts/lifecycle/rehydrateEpisode'

export async function POST(req: NextRequest) {
  try {
    // Parse request body
    const body = await req.json()
    const { episodeId, verify = false } = body

    if (!episodeId || typeof episodeId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'episodeId is required and must be a string',
        },
        { status: 400 },
      )
    }

    // Execute rehydration
    const result = await rehydrateEpisode({ episodeId, verify, dryRun: false })

    // Map internal status to HTTP status
    if (result.status === 'error') {
      const statusCode = result.error?.code === 'E_EPISODE_NOT_FOUND' ? 404 : 400

      return NextResponse.json(
        {
          success: false,
          code: result.error?.code,
          message: result.error?.message,
          episodeId,
          workingPath: result.workingPath || undefined,
        },
        { status: statusCode },
      )
    }

    // Success
    return NextResponse.json(
      {
        success: true,
        episodeId: result.episodeId,
        workingPath: result.workingPath,
        action: result.action,
        bytes: result.bytes,
        ltTrackId: result.ltTrackId,
      },
      { status: 200 },
    )
  } catch (error: any) {
    console.error('[REHYDRATE_API] Fatal error:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error.message,
      },
      { status: 500 },
    )
  }
}

// Auth middleware will be handled by Next.js middleware pattern
// For now, endpoint is open (add auth guard in production)
