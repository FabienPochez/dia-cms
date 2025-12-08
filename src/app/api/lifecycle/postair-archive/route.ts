/**
 * Lifecycle API - Manual Post-air Archive & Cleanup
 * POST /api/lifecycle/postair-archive
 *
 * Manually triggers Cron B (post-air archive sweep) to update metrics and
 * archive working files for recently aired episodes.
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
    const rateLimit = checkRateLimit(`postair:${clientIp}`, 5, 60000)
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
      `[POSTAIR_ARCHIVE_API] Manual trigger requested by ${auth.user?.email} (${auth.user?.role})`,
    )

    // Execute the post-air archive script via ephemeral jobs container
    // This runs the same script that Cron B runs every 10 minutes
    const { stdout, stderr } = await execAsync(
      'docker compose -f /srv/payload/docker-compose.yml run --rm jobs sh -lc "npx tsx scripts/cron/postair_archive_cleanup.ts"',
      {
        timeout: 300000, // 5 minute timeout
        cwd: '/srv/payload',
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV || 'production',
        },
      },
    )

    const output = stdout + stderr
    const foundMatch = output.match(/📋 Found (\d+) episodes to process/)
    const resultsMatch = output.match(/📊 Results: (\d+) archived, (\d+) skipped, (\d+) errors/)

    const episodesFound = foundMatch ? parseInt(foundMatch[1]) : 0
    const episodesArchived = resultsMatch ? parseInt(resultsMatch[1]) : 0
    const episodesSkipped = resultsMatch ? parseInt(resultsMatch[2]) : 0
    const episodesErrors = resultsMatch ? parseInt(resultsMatch[3]) : 0

    console.log(
      `[POSTAIR_ARCHIVE_API] Complete: ${episodesFound} found, ${episodesArchived} archived, ${episodesSkipped} skipped, ${episodesErrors} errors`,
    )

    return NextResponse.json(
      {
        success: true,
        message: 'Post-air archive completed',
        results: {
          found: episodesFound,
          archived: episodesArchived,
          skipped: episodesSkipped,
          errors: episodesErrors,
        },
        output: output.substring(0, 1000),
      },
      { status: 200 },
    )
  } catch (error: any) {
    console.error('[POSTAIR_ARCHIVE_API] Fatal error:', error)

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to run post-air archive cleanup',
        message: error.message,
        stderr: error.stderr?.substring(0, 500),
      },
      { status: 500 },
    )
  }
}
