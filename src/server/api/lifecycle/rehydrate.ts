/**
 * Lifecycle API - Rehydrate Episode
 * POST /api/lifecycle/rehydrate
 *
 * Restores working files from archive when LibreTime path exists but local file is missing.
 * Staff/admin only endpoint.
 */

import { NextRequest, NextResponse } from 'next/server'
import { rehydrateEpisode } from '../../../../scripts/lifecycle/rehydrateEpisode'
import { checkScheduleAuth } from '@/lib/auth/checkScheduleAuth'
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimiter'

export async function POST(req: NextRequest) {
  try {
    // Security: Rate limiting (10 requests per minute per IP)
    const clientIp = getClientIp(req)
    const rateLimit = checkRateLimit(`rehydrate:${clientIp}`, 10, 60000)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: rateLimit.retryAfter,
        },
        { status: 429 },
      )
    }

    // Security: Check if dangerous endpoints are disabled
    if (process.env.ENABLE_DANGEROUS_ENDPOINTS !== 'true') {
      return NextResponse.json(
        {
          success: false,
          error: 'Endpoint temporarily disabled for security',
        },
        { status: 503 },
      )
    }

    // Security: Require admin or staff authentication
    const auth = await checkScheduleAuth(req)
    if (!auth.authorized) {
      return NextResponse.json(
        {
          success: false,
          error: auth.error || 'Unauthorized - admin/staff only',
        },
        { status: 403 },
      )
    }

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

    console.log(
      `[REHYDRATE_API] Rehydrate requested by ${auth.user?.email} (${auth.user?.role}) for episode ${episodeId}`,
    )

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

// Security: Authentication required (admin/staff only)
