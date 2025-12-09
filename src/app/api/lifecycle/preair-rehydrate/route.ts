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
import { checkScheduleAuth } from '@/lib/auth/checkScheduleAuth'
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimiter'
import { getPayload } from 'payload'
import config from '@/payload.config'
import fs from 'fs/promises'
import path from 'path'
import { acquireEpisodeLock, releaseEpisodeLock, cleanupStaleLocks } from '@/server/lib/episodeLock'
import { rsyncPull } from '@/server/lib/rsyncPull'
import { logLifecycle } from '@/server/lib/logLifecycle'
import { updateLibreTimeFileExists } from '@/server/lib/libretimeDb'

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

    // Call preair rehydrate function directly (same logic as cron script)
    const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'
    const MAX_CONCURRENCY = 3
    const results = {
      found: 0,
      ok: 0,
      copied: 0,
      error: 0,
    }

    // Clean up stale locks
    const cleanedLocks = await cleanupStaleLocks()
    if (cleanedLocks > 0) {
      console.log(`🧹 Cleaned up ${cleanedLocks} stale locks`)
    }

    // Initialize Payload
    const payload = await getPayload({ config })

    // Query episodes scheduled in next 24 hours
    const episodes = await payload.find({
      collection: 'episodes',
      where: {
        and: [
          { publishedStatus: { equals: 'published' } },
          { scheduledAt: { exists: true } },
          { scheduledAt: { greater_than_equal: new Date().toISOString() } },
          {
            scheduledAt: {
              less_than: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          { libretimeFilepathRelative: { exists: true } },
          { libretimeFilepathRelative: { not_equals: '' } },
        ],
      },
      limit: 100,
      depth: 0,
    })

    results.found = episodes.docs.length
    console.log(`📋 Found ${episodes.docs.length} episodes to process`)

    if (episodes.docs.length === 0) {
      return NextResponse.json(
        {
          success: true,
          message: 'No episodes to process',
          results: {
            found: 0,
            ok: 0,
            copied: 0,
            errors: 0,
          },
        },
        { status: 200 },
      )
    }

    // Process episodes with concurrency control
    for (let i = 0; i < episodes.docs.length; i += MAX_CONCURRENCY) {
      const batch = episodes.docs.slice(i, i + MAX_CONCURRENCY)

      await Promise.all(
        batch.map(async (episode: any) => {
          const episodeId = episode.id
          const libretimeFilepathRelative = episode.libretimeFilepathRelative

          if (!libretimeFilepathRelative) {
            return
          }

          const lockAcquired = await acquireEpisodeLock(episodeId)
          if (!lockAcquired) {
            console.log(`⏭️  Episode ${episodeId} is locked, skipping`)
            return
          }

          try {
            const workingPath = path.join(LIBRETIME_LIBRARY_ROOT, libretimeFilepathRelative)

            // Check if working file exists
            try {
              await fs.access(workingPath)
              results.ok++
              console.log(`✅ Working file exists: ${libretimeFilepathRelative}`)
            } catch {
              // File missing, rehydrate
              const archiveFilePath = episode.archiveFilePath as string | undefined

              if (archiveFilePath) {
                try {
                  await rsyncPull(archiveFilePath, libretimeFilepathRelative)
                  await updateLibreTimeFileExists(libretimeFilepathRelative, true)
                  results.copied++
                  console.log(`✅ Rehydrated: ${libretimeFilepathRelative}`)
                } catch (error: any) {
                  results.error++
                  console.error(`❌ Rehydrate failed: ${error.message}`)
                }
              } else {
                results.error++
                console.log(`❌ No archive file for: ${libretimeFilepathRelative}`)
              }
            }
          } finally {
            await releaseEpisodeLock(episodeId)
          }
        }),
      )
    }

    console.log(
      `[PREAIR_REHYDRATE_API] Complete: ${results.found} found, ${results.ok} OK, ${results.copied} copied, ${results.error} errors`,
    )

    return NextResponse.json(
      {
        success: true,
        message: 'Pre-air rehydrate completed',
        results: {
          found: results.found,
          ok: results.ok,
          copied: results.copied,
          errors: results.error,
        },
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
