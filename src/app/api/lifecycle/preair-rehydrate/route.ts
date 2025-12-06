/**
 * Lifecycle API - Manual Pre-air Rehydrate
 * POST /api/lifecycle/preair-rehydrate
 *
 * Manually triggers Cron A (pre-air rehydrate sweep) to ensure all scheduled episodes
 * for the next 24 hours have their working files ready.
 *
 * Useful when scheduling shows close to airtime.
 */

import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { checkScheduleAuth } from '@/lib/auth/checkScheduleAuth'
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimiter'

const execAsync = promisify(exec)

export async function POST(req: NextRequest) {
  try {
    // Security: Rate limiting (5 requests per minute per IP)
    const clientIp = getClientIp(req)
    const rateLimit = checkRateLimit(`preair:${clientIp}`, 5, 60000)
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

    console.log(
      `[PREAIR_REHYDRATE_API] Manual trigger requested by ${auth.user?.email} (${auth.user?.role})`,
    )

    // Execute the pre-air rehydrate script
    // This runs the same script that Cron A runs every 15 minutes
    const { stdout, stderr } = await execAsync('npx tsx /app/scripts/cron/preair_rehydrate.ts', {
      timeout: 300000, // 5 minute timeout
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'production',
      },
    })

    // Parse the output to extract results
    const output = stdout + stderr
    const foundMatch = output.match(/📋 Found (\d+) episodes to process/)
    const resultsMatch = output.match(/📊 Results: (\d+) OK, (\d+) copied, (\d+) errors/)

    const episodesFound = foundMatch ? parseInt(foundMatch[1]) : 0
    const episodesOk = resultsMatch ? parseInt(resultsMatch[1]) : 0
    const episodesCopied = resultsMatch ? parseInt(resultsMatch[2]) : 0
    const episodesErrors = resultsMatch ? parseInt(resultsMatch[3]) : 0

    console.log(
      `[PREAIR_REHYDRATE_API] Complete: ${episodesFound} found, ${episodesOk} OK, ${episodesCopied} copied, ${episodesErrors} errors`,
    )

    return NextResponse.json(
      {
        success: true,
        message: 'Pre-air rehydrate completed',
        results: {
          found: episodesFound,
          ok: episodesOk,
          copied: episodesCopied,
          errors: episodesErrors,
        },
        output: output.substring(0, 1000), // First 1000 chars for debugging
      },
      { status: 200 },
    )
  } catch (error: any) {
    console.error('[PREAIR_REHYDRATE_API] Fatal error:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to run pre-air rehydrate',
        message: error.message,
        stderr: error.stderr?.substring(0, 500),
      },
      { status: 500 },
    )
  }
}

