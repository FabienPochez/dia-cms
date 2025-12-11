import 'dotenv/config'
// GLOBAL SUBPROCESS DIAGNOSTIC PATCH - MUST BE FIRST
import '../../src/server/lib/subprocessGlobalDiag'
import fs from 'fs/promises'
import path from 'path'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import payloadConfig from '../../src/payload.config'
import {
  acquireEpisodeLock,
  releaseEpisodeLock,
  cleanupStaleLocks,
} from '../../src/server/lib/episodeLock'
import { rsyncPull } from '../../src/server/lib/rsyncPull'
import { logLifecycle } from '../../src/server/lib/logLifecycle'
import { updateLibreTimeFileExists } from '../../src/server/lib/libretimeDb'

// Configuration
const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'
const LOG_FILE = '/srv/media/logs/cron-preair-rehydrate.jsonl'

// Concurrency control
const MAX_CONCURRENCY = 3

interface PreairLogEntry {
  operation: 'cron_preair'
  episodeId: string
  action: 'ok' | 'copied' | 'error'
  workingPath?: string
  ts: string
  duration_ms: number
  code?: string
}

/**
 * Log entry to JSONL file
 */
async function logEntry(entry: PreairLogEntry): Promise<void> {
  try {
    const logDir = path.dirname(LOG_FILE)
    await fs.mkdir(logDir, { recursive: true })
    await fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n')
  } catch (error) {
    console.warn(`⚠️ Failed to write log: ${(error as Error).message}`)
  }
}

/**
 * Check if working file exists
 */
async function checkWorkingFile(workingPath: string): Promise<boolean> {
  try {
    await fs.access(workingPath)
    return true
  } catch {
    return false
  }
}

/**
 * Rehydrate episode directly using shared Payload instance
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

        // Verify file exists and is complete before updating database
        const workingAbsPath = path.join(LIBRETIME_LIBRARY_ROOT, libretimeFilepathRelative)
        try {
          const stats = await fs.stat(workingAbsPath)
          if (stats.size === 0) {
            throw new Error('File copied but has zero size')
          }
          console.log(`✅ Verified file: ${stats.size} bytes`)
        } catch (verifyError: any) {
          console.error(`❌ File verification failed: ${verifyError.message}`)
          return { action: 'error', code: 'E_VERIFY_FAILED' }
        }

        // Update LibreTime database: file_exists = true
        const dbResult = await updateLibreTimeFileExists(libretimeFilepathRelative, true)
        if (!dbResult.success) {
          console.warn(`⚠️ File copied but LibreTime DB update failed: ${dbResult.error}`)
        }

        return { action: 'copied' }
      } catch (error: any) {
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
 * Process a single episode
 */
async function processEpisode(payload: Payload, episode: any): Promise<void> {
  const episodeId = episode.id
  const libretimeFilepathRelative = episode.libretimeFilepathRelative

  // Skip episodes without LibreTime path
  if (!libretimeFilepathRelative) {
    console.log(`⏭️  Episode ${episodeId} has no libretimeFilepathRelative, skipping`)
    return
  }

  const workingPath = path.join(LIBRETIME_LIBRARY_ROOT, libretimeFilepathRelative)
  const startTime = Date.now()

  try {
    console.log(`🔍 Processing episode ${episodeId}: ${episode.title || 'Untitled'}`)

    // Check if working file exists
    const workingExists = await checkWorkingFile(workingPath)

    if (workingExists) {
      // File exists, log as OK
      const duration_ms = Date.now() - startTime
      await logEntry({
        operation: 'cron_preair',
        episodeId,
        action: 'ok',
        workingPath: libretimeFilepathRelative,
        ts: new Date().toISOString(),
        duration_ms,
      })
      console.log(`✅ Working file exists: ${libretimeFilepathRelative}`)
    } else {
      // File missing, rehydrate directly
      console.log(`📥 Working file missing, rehydrating: ${libretimeFilepathRelative}`)
      const result = await rehydrateEpisodeDirect(payload, episodeId)

      const duration_ms = Date.now() - startTime
      await logEntry({
        operation: 'cron_preair',
        episodeId,
        action: result.action,
        workingPath: libretimeFilepathRelative,
        ts: new Date().toISOString(),
        duration_ms,
        code: result.code,
      })

      if (result.action === 'copied') {
        console.log(`✅ Rehydrated successfully: ${libretimeFilepathRelative}`)
      } else {
        console.log(`❌ Rehydration failed: ${libretimeFilepathRelative} (${result.code})`)
      }
    }
  } catch (error: any) {
    const duration_ms = Date.now() - startTime
    await logEntry({
      operation: 'cron_preair',
      episodeId,
      action: 'error',
      workingPath: libretimeFilepathRelative,
      ts: new Date().toISOString(),
      duration_ms,
      code: 'E_PROCESSING_ERROR',
    })
    console.error(`❌ Error processing episode ${episodeId}:`, error.message)
  }
}

/**
 * Process episodes with concurrency control
 */
async function processEpisodes(payload: Payload, episodes: any[]): Promise<void> {
  const results = {
    ok: 0,
    copied: 0,
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

  console.log(`\n📊 Results: ${results.ok} OK, ${results.copied} copied, ${results.error} errors`)
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log('🔄 CRON A: Pre-air Rehydrate Sweep')
  console.log('=====================================')

  try {
    // Clean up stale locks before starting
    const cleanedLocks = await cleanupStaleLocks()
    if (cleanedLocks > 0) {
      console.log(`🧹 Cleaned up ${cleanedLocks} stale locks.`)
    }

    // Initialize Payload once for all operations
    const payload = await getPayload({ config: payloadConfig })

    // Query episodes using Payload SDK
    const episodes = await payload.find({
      collection: 'episodes',
      where: {
        and: [
          { publishedStatus: { equals: 'published' } },
          { scheduledAt: { exists: true } },
          { scheduledAt: { greater_than_equal: new Date().toISOString() } },
          { scheduledAt: { less_than: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } },
          { libretimeFilepathRelative: { exists: true } },
          { libretimeFilepathRelative: { not_equals: '' } },
        ],
      },
      limit: 100,
      depth: 0,
    })

    console.log(`📋 Found ${episodes.docs.length} episodes to process`)

    if (episodes.docs.length === 0) {
      console.log('✅ No episodes to process')
      process.exit(0)
    }

    // Process episodes
    await processEpisodes(payload, episodes.docs)

    console.log('✅ Pre-air rehydrate sweep completed')
    process.exit(0)
  } catch (error: any) {
    console.error('❌ Pre-air rehydrate sweep failed:', error.message)
    process.exit(1)
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
