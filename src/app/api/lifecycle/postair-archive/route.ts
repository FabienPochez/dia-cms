/**
 * Lifecycle API - Manual Post-air Archive & Cleanup
 * POST /api/lifecycle/postair-archive
 *
 * Manually triggers Cron B (post-air archive sweep) to update metrics and
 * archive working files for recently aired episodes.
 *
 * NOTE: This endpoint runs inside the container, so it cannot execute host-side
 * operations like rsyncPull or callWeeklyRsync. It will:
 * - Update airing metrics
 * - Cleanup working files for already-archived episodes
 * - Skip archiving operations (those must run via cron from host)
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkScheduleAuth } from '@/lib/auth/checkScheduleAuth'
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimiter'
import { getPayload } from 'payload'
import config from '@/payload.config'
import fs from 'fs/promises'
import path from 'path'
import { acquireEpisodeLock, releaseEpisodeLock, cleanupStaleLocks } from '@/server/lib/episodeLock'

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

    // Call postair cleanup functions directly (same logic as cron script)
    // NOTE: We skip archiving operations (callWeeklyRsync) since they require host-side SSH access
    // Archiving must be done via cron jobs running from the host
    const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'
    const MAX_CONCURRENCY = 3
    const results = {
      found: 0,
      skipped: 0,
      errors: 0,
    }

    // Clean up stale locks
    const cleanedLocks = await cleanupStaleLocks()
    if (cleanedLocks > 0) {
      console.log(`🧹 Cleaned up ${cleanedLocks} stale locks`)
    }

    // Initialize Payload
    const payload = await getPayload({ config })

    // Query episodes using same logic as cron script
    // Time window: now-48h to now-10m
    const now = new Date()
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000)

    const episodes = await payload.find({
      collection: 'episodes',
      where: {
        and: [
          { publishedStatus: { equals: 'published' } },
          { scheduledEnd: { exists: true } },
          { scheduledEnd: { greater_than_equal: fortyEightHoursAgo.toISOString() } },
          { scheduledEnd: { less_than: tenMinutesAgo.toISOString() } },
          { libretimeFilepathRelative: { exists: true } },
          { libretimeFilepathRelative: { not_equals: '' } },
        ],
      },
      limit: 200,
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
            skipped: 0,
            errors: 0,
          },
          note: 'Archiving operations require host-side execution via cron jobs',
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
          const hasArchiveFile = episode.hasArchiveFile || false

          if (!libretimeFilepathRelative) {
            return
          }

          const lockAcquired = await acquireEpisodeLock(episodeId)
          if (!lockAcquired) {
            console.log(`⏭️  Episode ${episodeId} is locked, skipping`)
            return
          }

          try {
            // Update airing metrics
            const scheduledEnd = episode.scheduledEnd
            const firstAiredAt = episode.firstAiredAt
            const plays = episode.plays || 0

            await payload.update({
              collection: 'episodes',
              id: episodeId,
              data: {
                lastAiredAt: scheduledEnd,
                plays: plays + 1,
                airTimingIsEstimated: true,
                ...(firstAiredAt ? {} : { firstAiredAt: episode.scheduledAt }),
              },
            })

            // Only cleanup working files for already-archived episodes
            // Archiving new episodes requires host-side rsync (via cron)
            if (hasArchiveFile) {
              const workingAbs = path.join(LIBRETIME_LIBRARY_ROOT, libretimeFilepathRelative)
              const processedPath = workingAbs.replace('/imported/1/', '/imported/1/processed/')

              try {
                await fs.access(workingAbs)
                await fs.unlink(workingAbs)
                console.log(`🗑️  Deleted working file: ${libretimeFilepathRelative}`)
              } catch (error: any) {
                if (error.code === 'ENOENT') {
                  try {
                    await fs.access(processedPath)
                    await fs.unlink(processedPath)
                    console.log(`🗑️  Deleted processed file: ${libretimeFilepathRelative}`)
                  } catch {
                    // File already removed
                  }
                }
              }
              results.skipped++
            } else {
              // Episode not archived yet - skip (archiving requires host-side cron)
              console.log(
                `⏭️  Episode ${episodeId} not archived yet - archiving requires host-side cron`,
              )
            }
          } catch (error: any) {
            results.errors++
            console.error(`❌ Error processing episode ${episodeId}:`, error.message)
          } finally {
            await releaseEpisodeLock(episodeId)
          }
        }),
      )
    }

    console.log(
      `[POSTAIR_ARCHIVE_API] Complete: ${results.found} found, ${results.skipped} cleaned up, ${results.errors} errors`,
    )

    return NextResponse.json(
      {
        success: true,
        message: 'Post-air cleanup completed',
        results: {
          found: results.found,
          skipped: results.skipped,
          errors: results.errors,
        },
        note: 'Archiving operations require host-side execution via cron jobs',
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
