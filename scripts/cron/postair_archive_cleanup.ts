import 'dotenv/config'
// GLOBAL SUBPROCESS DIAGNOSTIC PATCH - MUST BE FIRST
import '../../src/server/lib/subprocessGlobalDiag'
import fs from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import payloadConfig from '../../src/payload.config'
import {
  acquireEpisodeLock,
  releaseEpisodeLock,
  cleanupStaleLocks,
} from '../../src/server/lib/episodeLock'
import { getWeeklyArchivePath } from '../../src/server/lib/timezoneUtils'
import { rsyncPull } from '../../src/server/lib/rsyncPull'
import { logLifecycle } from '../../src/server/lib/logLifecycle'

const execFileAsync = promisify(execFile)

// Configuration
const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'
const LOG_FILE = '/srv/media/logs/cron-postair-archive.jsonl'

// Concurrency control
const MAX_CONCURRENCY = 3

interface PostairLogEntry {
  operation: 'cron_postair'
  episodeId: string
  action: 'archived' | 'skipped' | 'error'
  archivePath?: string
  bytes?: number
  ts: string
  duration_ms: number
  rsyncExitCode?: number
}

/**
 * Log entry to JSONL file
 */
async function logEntry(entry: PostairLogEntry): Promise<void> {
  try {
    const logDir = path.dirname(LOG_FILE)
    await fs.mkdir(logDir, { recursive: true })
    await fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n')
  } catch (error) {
    console.warn(`⚠️ Failed to write log: ${(error as Error).message}`)
  }
}

/**
 * Call weekly rsync script
 */
async function callWeeklyRsync(
  workingAbs: string,
  destRel: string,
  episodeId: string,
): Promise<{ success: boolean; exitCode: number }> {
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/sh/archive/rsync_postair_weekly.sh')
    console.log(`📦 Running: EPISODE_ID="${episodeId}" ${scriptPath} "${workingAbs}" "${destRel}"`)

    // SECURITY: Use execFile with array arguments to prevent shell injection
    // Pass EPISODE_ID via environment variable, script path and arguments as array
    const execArgs = [workingAbs, destRel]
    console.log(
      `[SUBPROC] postair_archive_cleanup.callWeeklyRsync execFile: ${scriptPath} args=`,
      JSON.stringify(execArgs),
    )
    const { stdout, stderr } = await execFileAsync(scriptPath, execArgs, {
      timeout: 300000, // 5 minutes timeout
      env: {
        ...process.env,
        EPISODE_ID: episodeId,
      },
    })

    if (stderr) {
      console.warn(`⚠️ rsync stderr: ${stderr.trim()}`)
    }

    console.log(`✅ Weekly rsync completed for ${episodeId}`)
    return { success: true, exitCode: 0 }
  } catch (error: any) {
    console.error(`❌ Weekly rsync failed for ${episodeId}:`, error.message)
    return { success: false, exitCode: error.code || 1 }
  }
}

/**
 * Call hydrate-archive-paths script
 */
async function callHydrateArchivePaths(): Promise<boolean> {
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/hydrate-archive-paths.ts')
    console.log(`🔄 Running: npx tsx ${scriptPath} --log "${LOG_FILE}"`)

    // SECURITY: Use execFile with array arguments to prevent shell injection
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['tsx', scriptPath, '--log', LOG_FILE],
      { 
        timeout: 60000, // 1 minute timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer (for verbose hydration output)
      },
    )

    if (stderr) {
      console.warn(`⚠️ hydrate stderr: ${stderr.trim()}`)
    }

    console.log(`✅ Archive hydration completed`)
    return true
  } catch (error: any) {
    console.error(`❌ Archive hydration failed:`, error.message)
    return false
  }
}

/**
 * Call cleanup-imported-files script
 */
async function callCleanupImportedFiles(): Promise<boolean> {
  try {
    const scriptPath = path.join(process.cwd(), 'scripts/cleanup-imported-files.ts')
    console.log(`🧹 Running: npx tsx ${scriptPath} --log "${LOG_FILE}"`)

    // SECURITY: Use execFile with array arguments to prevent shell injection
    const execArgs = ['tsx', scriptPath, '--log', LOG_FILE]
    console.log(
      `[SUBPROC] postair_archive_cleanup.callCleanupImportedFiles execFile: npx args=`,
      JSON.stringify(execArgs),
    )
    const { stdout, stderr } = await execFileAsync(
      'npx',
      execArgs,
      { timeout: 60000 }, // 1 minute timeout
    )

    if (stderr) {
      console.warn(`⚠️ cleanup stderr: ${stderr.trim()}`)
    }

    console.log(`✅ File cleanup completed`)
    return true
  } catch (error: any) {
    console.error(`❌ File cleanup failed:`, error.message)
    return false
  }
}

/**
 * Rehydrate episode directly using shared Payload instance
 * Pattern from: scripts/cron/preair_rehydrate.ts:60-109
 */
async function rehydrateEpisodeDirect(
  payload: Payload,
  episodeId: string,
): Promise<{ action: 'copied' | 'ok' | 'error'; code?: string }> {
  try {
    // Fetch episode
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
      depth: 0,
    })

    if (!episode) {
      return { action: 'error', code: 'E_NOT_FOUND' }
    }

    const libretimeFilepathRelative = episode.libretimeFilepathRelative as string | undefined
    const archiveFilePath = episode.archiveFilePath as string | undefined

    if (!libretimeFilepathRelative) {
      return { action: 'error', code: 'E_NOT_PLANNABLE' }
    }

    const workingAbsPath = path.join(LIBRETIME_LIBRARY_ROOT, libretimeFilepathRelative)

    // Check if working file already exists
    try {
      await fs.access(workingAbsPath)
      // File exists, return ok
      return { action: 'ok' }
    } catch {
      // File doesn't exist, continue to copy
    }

    // Copy from archive if available
    if (archiveFilePath) {
      try {
        await rsyncPull(archiveFilePath, libretimeFilepathRelative)
        await logLifecycle({
          operation: 'rehydrate',
          event: 'copied',
          episodeId,
          workingPath: libretimeFilepathRelative,
          archivePath: archiveFilePath,
          ts: new Date().toISOString(),
        })
        return { action: 'copied' }
      } catch (error: any) {
        await logLifecycle({
          operation: 'rehydrate',
          event: 'error',
          episodeId,
          code: error.code || 'E_COPY_FAILED',
          message: error.message,
          ts: new Date().toISOString(),
        })
        return { action: 'error', code: error.code || 'E_COPY_FAILED' }
      }
    }

    return { action: 'error', code: 'E_WORKING_MISSING' }
  } catch (error: any) {
    console.error(`❌ Rehydrate failed for ${episodeId}: ${error.message}`)
    return { action: 'error', code: 'E_UNKNOWN' }
  }
}

/**
 * Update airing metrics for episode
 */
async function updateAiringMetrics(payload: Payload, episode: any): Promise<void> {
  const episodeId = episode.id
  const scheduledStart = episode.scheduledAt
  const scheduledEnd = episode.scheduledEnd
  const firstAiredAt = episode.firstAiredAt
  const plays = episode.plays || 0

  const updates: any = {
    lastAiredAt: scheduledEnd, // Always update to most recent scheduled end
    plays: plays + 1, // Increment plays
    airTimingIsEstimated: true, // Schedule-based, not playback-confirmed
    airStatus: 'aired', // Mark as aired after processing
  }

  // Set firstAiredAt only if null
  if (!firstAiredAt) {
    updates.firstAiredAt = scheduledStart
  }

  await payload.update({
    collection: 'episodes',
    id: episodeId,
    data: updates,
  })

  console.log(`✅ Updated airing metrics: lastAiredAt=${scheduledEnd}, plays=${updates.plays}`)
}

/**
 * Process a single episode
 */
async function processEpisode(payload: Payload, episode: any): Promise<void> {
  const episodeId = episode.id
  const libretimeFilepathRelative = episode.libretimeFilepathRelative
  const hasArchiveFile = episode.hasArchiveFile || false
  const scheduledEnd = episode.scheduledEnd

  const startTime = Date.now()

  try {
    console.log(`🔍 Processing episode ${episodeId}: ${episode.title || 'Untitled'}`)
    console.log(`   Archive status: ${hasArchiveFile ? 'archived' : 'not archived'}`)
    console.log(`   Scheduled end: ${scheduledEnd}`)

    // Update airing metrics first (doesn't require file path)
    await updateAiringMetrics(payload, episode)

    // Skip archiving/cleanup if no file path (e.g., live recordings not yet uploaded)
    if (!libretimeFilepathRelative) {
      console.log(
        `⏭️  Episode ${episodeId} has no libretimeFilepathRelative, skipping archiving/cleanup`,
      )
      console.log(`   Metrics updated (firstAiredAt, airStatus='aired')`)
      const duration_ms = Date.now() - startTime
      await logEntry({
        operation: 'cron_postair',
        episodeId,
        action: 'skipped',
        ts: new Date().toISOString(),
        duration_ms,
      })
      return
    }

    if (hasArchiveFile) {
      // Already archived, just cleanup the working file directly
      console.log(`⏭️  Episode ${episodeId} already archived, skipping archive step`)

      const workingAbs = path.join(LIBRETIME_LIBRARY_ROOT, libretimeFilepathRelative)

      // Delete working file if it exists (check both flat and processed locations)
      const processedPath = workingAbs.replace('/imported/1/', '/imported/1/processed/')

      // Try flat structure first
      try {
        await fs.access(workingAbs)
        await fs.unlink(workingAbs)
        console.log(`🗑️  Deleted working file: ${libretimeFilepathRelative}`)
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // Try processed subdirectory
          try {
            await fs.access(processedPath)
            await fs.unlink(processedPath)
            console.log(`🗑️  Deleted processed file: ${libretimeFilepathRelative}`)
          } catch (processedError: any) {
            if (processedError.code === 'ENOENT') {
              console.log(`⏭️  Working file already removed: ${libretimeFilepathRelative}`)
            } else {
              throw processedError
            }
          }
        } else {
          throw error
        }
      }

      const duration_ms = Date.now() - startTime
      await logEntry({
        operation: 'cron_postair',
        episodeId,
        action: 'skipped',
        ts: new Date().toISOString(),
        duration_ms,
      })
      console.log(`✅ Cleanup completed for already-archived episode ${episodeId}`)
    } else {
      // Not archived, need to archive first
      // Only archive if publishedStatus is 'published' (uploaded to SoundCloud)
      const publishedStatus = episode.publishedStatus
      if (publishedStatus !== 'published') {
        console.log(
          `⏭️  Episode ${episodeId} not archived yet and publishedStatus is '${publishedStatus}' (expected 'published')`,
        )
        console.log(
          `   Skipping archive - episode must be uploaded to SoundCloud first before archiving`,
        )
        const duration_ms = Date.now() - startTime
        await logEntry({
          operation: 'cron_postair',
          episodeId,
          action: 'skipped',
          ts: new Date().toISOString(),
          duration_ms,
        })
        return
      }
      const workingAbs = path.join(LIBRETIME_LIBRARY_ROOT, libretimeFilepathRelative)

      // Check if working file exists
      let workingExists = false
      try {
        await fs.access(workingAbs)
        workingExists = true
      } catch {
        // File doesn't exist, try to rehydrate it
        console.log(`⚠️  Working file not found: ${workingAbs}`)
        console.log(`📥 Attempting to rehydrate from archive before archiving to weekly bucket...`)

        const rehydrateResult = await rehydrateEpisodeDirect(payload, episodeId)

        if (rehydrateResult.action === 'copied') {
          console.log(`✅ Working file rehydrated successfully`)
          workingExists = true
        } else if (rehydrateResult.action === 'ok') {
          console.log(`✅ Working file already exists after rehydrate check`)
          workingExists = true
        } else {
          console.log(
            `❌ Rehydration failed (${rehydrateResult.code}) - cannot archive without working file`,
          )
          const duration_ms = Date.now() - startTime
          await logEntry({
            operation: 'cron_postair',
            episodeId,
            action: 'error',
            ts: new Date().toISOString(),
            duration_ms,
            rsyncExitCode: 1,
          })
          return
        }
      }

      // If we don't have a working file at this point, we can't proceed
      if (!workingExists) {
        console.log(`❌ Working file still missing after rehydrate attempt`)
        const duration_ms = Date.now() - startTime
        await logEntry({
          operation: 'cron_postair',
          episodeId,
          action: 'error',
          ts: new Date().toISOString(),
          duration_ms,
          rsyncExitCode: 1,
        })
        return
      }

      // Compute weekly archive path based on firstAiredAt (when episode actually aired)
      const firstAiredAt = episode.firstAiredAt
      if (!firstAiredAt) {
        console.log(`❌ Episode ${episodeId} has no firstAiredAt - cannot determine archive week`)
        const duration_ms = Date.now() - startTime
        await logEntry({
          operation: 'cron_postair',
          episodeId,
          action: 'error',
          ts: new Date().toISOString(),
          duration_ms,
          rsyncExitCode: 1,
        })
        return
      }
      const airedDate = new Date(firstAiredAt)
      const weeklyDir = getWeeklyArchivePath(airedDate)
      const basename = path.basename(libretimeFilepathRelative)
      const destRel = `${weeklyDir}/${basename}`

      console.log(`📦 Archiving to weekly bucket: ${destRel}`)

      // Call weekly rsync script
      const rsyncResult = await callWeeklyRsync(workingAbs, destRel, episodeId)

      if (rsyncResult.success) {
        console.log(`✅ Archive transfer completed for ${episodeId}`)

        // Hydrate archive paths in Payload
        const hydrateSuccess = await callHydrateArchivePaths()

        if (hydrateSuccess) {
          console.log(`✅ Archive hydration completed for ${episodeId}`)

          // Cleanup working files (check both flat and processed locations)
          const processedPath = workingAbs.replace('/imported/1/', '/imported/1/processed/')

          // Try to delete from flat structure first
          try {
            await fs.access(workingAbs)
            await fs.unlink(workingAbs)
            console.log(`🗑️  Deleted working file: ${libretimeFilepathRelative}`)
          } catch (error: any) {
            if (error.code === 'ENOENT') {
              // Try processed subdirectory
              try {
                await fs.access(processedPath)
                await fs.unlink(processedPath)
                console.log(`🗑️  Deleted processed file: ${libretimeFilepathRelative}`)
              } catch (processedError: any) {
                if (processedError.code !== 'ENOENT') {
                  console.warn(`⚠️  Failed to delete processed file: ${processedError.message}`)
                }
              }
            } else {
              console.warn(`⚠️  Failed to delete working file: ${error.message}`)
            }
          }

          console.log(`✅ File cleanup completed for ${episodeId}`)
        } else {
          console.log(
            `❌ Archive hydration failed for ${episodeId} (archive succeeded but not hydrated)`,
          )
        }
      } else {
        console.log(`❌ Archive transfer failed for ${episodeId}`)
      }

      const duration_ms = Date.now() - startTime
      await logEntry({
        operation: 'cron_postair',
        episodeId,
        action: rsyncResult.success ? 'archived' : 'error',
        archivePath: destRel,
        ts: new Date().toISOString(),
        duration_ms,
        rsyncExitCode: rsyncResult.exitCode,
      })
    }
  } catch (error: any) {
    const duration_ms = Date.now() - startTime
    await logEntry({
      operation: 'cron_postair',
      episodeId,
      action: 'error',
      ts: new Date().toISOString(),
      duration_ms,
      rsyncExitCode: 1,
    })
    console.error(`❌ Error processing episode ${episodeId}:`, error.message)
  }
}

/**
 * Process episodes with concurrency control
 */
async function processEpisodes(payload: Payload, episodes: any[]): Promise<void> {
  const results = {
    archived: 0,
    skipped: 0,
    error: 0,
  }

  // Process in batches with concurrency limit
  for (let i = 0; i < episodes.length; i += MAX_CONCURRENCY) {
    const batch = episodes.slice(i, i + MAX_CONCURRENCY)

    await Promise.all(
      batch.map(async (episode) => {
        const episodeId = episode.id

        // Try to acquire lock
        const lockAcquired = await acquireEpisodeLock(episodeId)
        if (!lockAcquired) {
          console.log(`⏭️  Episode ${episodeId} is locked, skipping`)
          return
        }

        try {
          await processEpisode(payload, episode)
        } finally {
          await releaseEpisodeLock(episodeId)
        }
      }),
    )
  }

  console.log(
    `\n📊 Results: ${results.archived} archived, ${results.skipped} skipped, ${results.error} errors`,
  )
}

/**
 * Query episodes using Payload SDK
 */
async function queryEpisodes(payload: Payload): Promise<any[]> {
  // Calculate time window: now-48h to now-10m
  const now = new Date()
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000)

  console.log(
    `📅 Time window: ${fortyEightHoursAgo.toISOString()} to ${tenMinutesAgo.toISOString()}`,
  )

  const result = await payload.find({
    collection: 'episodes',
    where: {
      and: [
        { scheduledEnd: { exists: true } },
        { scheduledEnd: { greater_than_equal: fortyEightHoursAgo.toISOString() } },
        { scheduledEnd: { less_than: tenMinutesAgo.toISOString() } },
        // Note: publishedStatus is NOT required here - we process all aired episodes regardless of status
        // Note: libretimeFilepathRelative is NOT required here - we update metrics for all aired episodes
        // File path is only needed for archiving/cleanup operations
      ],
    },
    limit: 200, // Reasonable limit for 48h window
    depth: 0,
  })

  return result.docs
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log('🔄 CRON B: Post-air Archive → Hydrate → Cleanup')
  console.log('===============================================')

  try {
    // Clean up stale locks before starting
    const cleanedLocks = await cleanupStaleLocks()
    if (cleanedLocks > 0) {
      console.log(`🧹 Cleaned up ${cleanedLocks} stale locks.`)
    }

    // Initialize Payload once for all operations
    const payload = await getPayload({ config: payloadConfig })

    // Query episodes using Payload SDK
    const episodes = await queryEpisodes(payload)

    console.log(`📋 Found ${episodes.length} episodes to process`)

    if (episodes.length === 0) {
      console.log('✅ No episodes to process')
      process.exit(0)
    }

    // Process episodes
    await processEpisodes(payload, episodes)

    console.log('✅ Post-air archive cleanup completed')
    process.exit(0)
  } catch (error: any) {
    console.error('❌ Post-air archive cleanup failed:', error.message)
    process.exit(1)
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
