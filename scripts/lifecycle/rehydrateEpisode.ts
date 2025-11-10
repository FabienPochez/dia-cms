#!/usr/bin/env tsx
/**
 * Rehydrate Episode Script
 *
 * Restores working files from archive when LibreTime path exists but local file is missing.
 *
 * Usage:
 *   npx tsx scripts/lifecycle/rehydrateEpisode.ts --id <episodeId>
 *   npx tsx scripts/lifecycle/rehydrateEpisode.ts --id <episodeId> --dry-run
 */

import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import { rsyncPull, RsyncPullError } from '../../src/server/lib/rsyncPull'
import { logLifecycle } from '../../src/server/lib/logLifecycle'

// Configuration
const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'https://content.diaradio.live'
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY
const PAYLOAD_ADMIN_TOKEN = process.env.PAYLOAD_ADMIN_TOKEN
const PAYLOAD_AUTH_SLUG = process.env.PAYLOAD_AUTH_SLUG || 'users'
const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'
const LIBRETIME_API_URL = process.env.LIBRETIME_API_URL || 'http://api:9001'
const LIBRETIME_API_KEY = process.env.LIBRETIME_API_KEY

// Validation
if (!PAYLOAD_API_KEY && !PAYLOAD_ADMIN_TOKEN) {
  console.error('❌ PAYLOAD_API_KEY or PAYLOAD_ADMIN_TOKEN environment variable is required')
  process.exit(1)
}

// Types
export interface RehydrateOptions {
  episodeId: string
  verify?: boolean
  dryRun?: boolean
}

export interface RehydrateResult {
  episodeId: string
  status: 'ok' | 'copied' | 'error'
  action: 'exists' | 'copied_from_archive' | 'missing' | 'error'
  workingPath: string
  bytes?: number
  duration_ms?: number
  ltTrackId?: string
  error?: {
    code: string
    message: string
  }
}

export enum RehydrateErrorCode {
  E_EPISODE_NOT_FOUND = 'E_EPISODE_NOT_FOUND',
  E_NOT_PLANNABLE = 'E_NOT_PLANNABLE', // No libretimeFilepathRelative
  E_WORKING_MISSING = 'E_WORKING_MISSING', // Not archived, working missing
  E_ARCHIVE_MISSING = 'E_ARCHIVE_MISSING', // Archive declared but file not found
  E_COPY_FAILED = 'E_COPY_FAILED',
  E_PERMISSION = 'E_PERMISSION',
  E_VERIFY_FAILED = 'E_VERIFY_FAILED',
}

/**
 * Build Payload authentication headers
 * Pattern from: scripts/importOneEpisode.ts:16-32
 */
function buildPayloadAuthHeaders(): { Authorization: string; 'Content-Type': 'application/json' } {
  if (PAYLOAD_API_KEY) {
    return {
      Authorization: `${PAYLOAD_AUTH_SLUG} API-Key ${PAYLOAD_API_KEY}`,
      'Content-Type': 'application/json',
    }
  }

  if (PAYLOAD_ADMIN_TOKEN) {
    return {
      Authorization: `Bearer ${PAYLOAD_ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    }
  }

  throw new Error('PAYLOAD_API_KEY or PAYLOAD_ADMIN_TOKEN required')
}

/**
 * Check if file exists on filesystem
 * Pattern from: scripts/rename-media-in-place.ts:191-194
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Find LibreTime track by episode ID (optional, for ltTrackId lookup)
 * Pattern from: scripts/hydrate-archive-paths.ts:97-126
 */
async function findLibreTimeFileByEpisodeId(
  episodeId: string,
): Promise<{ id: number; filepath: string } | null> {
  if (!LIBRETIME_API_KEY) {
    return null // Skip LT lookup if no API key
  }

  try {
    const response = await axios.get(`${LIBRETIME_API_URL}/api/v2/files?search=${episodeId}__`, {
      headers: {
        Authorization: `Api-Key ${LIBRETIME_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    })

    const files = response.data
    const matchingFiles = files.filter((file: any) => {
      const filepath = file.filepath || file.name || ''
      const filename = filepath.split('/').pop() || ''
      return filename.startsWith(`${episodeId}__`)
    })

    return matchingFiles.length > 0 ? matchingFiles[0] : null
  } catch (error: any) {
    console.log(`⚠️  LibreTime lookup failed (non-blocking): ${error.message}`)
    return null
  }
}

/**
 * Core rehydrate logic
 */
export async function rehydrateEpisode(options: RehydrateOptions): Promise<RehydrateResult> {
  const { episodeId, verify = false, dryRun = false } = options
  const startTime = Date.now()

  // Log start
  await logLifecycle({
    operation: 'rehydrate',
    event: 'start',
    episodeId,
    ts: new Date().toISOString(),
  })

  try {
    // 1) Fetch episode
    console.log(`🔍 Fetching episode: ${episodeId}`)
    const response = await axios.get(`${PAYLOAD_API_URL}/api/episodes/${episodeId}?depth=0`, {
      headers: buildPayloadAuthHeaders(),
      timeout: 10000,
    })

    const episode = response.data

    // 2) Validate preconditions
    if (!episode.libretimeFilepathRelative) {
      const error = {
        code: RehydrateErrorCode.E_NOT_PLANNABLE,
        message: 'Episode missing libretimeFilepathRelative (not plannable)',
      }

      await logLifecycle({
        operation: 'rehydrate',
        event: 'error',
        episodeId,
        code: error.code,
        message: error.message,
        ts: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      })

      return {
        episodeId,
        status: 'error',
        action: 'error',
        workingPath: '',
        error,
      }
    }

    const ltPathRelative = episode.libretimeFilepathRelative
    const archivePathRelative = episode.archiveFilePath
    const workingPathAbs = path.join(LIBRETIME_LIBRARY_ROOT, ltPathRelative)

    console.log(`📁 Working path: ${workingPathAbs}`)
    if (archivePathRelative) {
      console.log(`📦 Archive path: ${archivePathRelative}`)
    }

    // 3) Check if working file exists
    console.log(`🔍 Checking working file...`)
    const workingExists = await fileExists(workingPathAbs)

    if (workingExists) {
      console.log(`✅ Working file exists (no copy needed)`)

      // Get file size for reporting
      const stats = await fs.stat(workingPathAbs)
      const duration_ms = Date.now() - startTime

      // Optional: Lookup LT track ID
      let ltTrackId = episode.libretimeTrackId
      if (!ltTrackId) {
        const ltFile = await findLibreTimeFileByEpisodeId(episodeId)
        ltTrackId = ltFile?.id.toString()
      }

      await logLifecycle({
        operation: 'rehydrate',
        event: 'ok',
        episodeId,
        workingPath: ltPathRelative,
        archivePath: archivePathRelative || undefined,
        bytes: stats.size,
        duration_ms,
        ts: new Date().toISOString(),
      })

      return {
        episodeId,
        status: 'ok',
        action: 'exists',
        workingPath: ltPathRelative,
        bytes: stats.size,
        duration_ms,
        ltTrackId,
      }
    }

    // 4) Working file missing - check if archived
    if (!archivePathRelative) {
      const error = {
        code: RehydrateErrorCode.E_WORKING_MISSING,
        message: 'Working file missing and episode not archived (import workflow needed)',
      }

      await logLifecycle({
        operation: 'rehydrate',
        event: 'error',
        episodeId,
        workingPath: ltPathRelative,
        code: error.code,
        message: error.message,
        ts: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      })

      return {
        episodeId,
        status: 'error',
        action: 'missing',
        workingPath: ltPathRelative,
        error,
      }
    }

    // 5) Copy from archive
    if (dryRun) {
      console.log(`🔍 DRY-RUN: Would copy ${archivePathRelative} → ${ltPathRelative}`)

      return {
        episodeId,
        status: 'copied',
        action: 'copied_from_archive',
        workingPath: ltPathRelative,
        bytes: 0,
        duration_ms: Date.now() - startTime,
      }
    }

    console.log(`📥 Copying from archive: ${archivePathRelative} → ${ltPathRelative}`)

    try {
      const result = await rsyncPull(archivePathRelative, ltPathRelative)

      console.log(`✅ Copy completed: ${result.bytes} bytes in ${result.duration_ms}ms`)

      // Optional: Lookup LT track ID
      let ltTrackId = episode.libretimeTrackId
      if (!ltTrackId) {
        const ltFile = await findLibreTimeFileByEpisodeId(episodeId)
        ltTrackId = ltFile?.id.toString()
        if (ltTrackId) {
          console.log(`✅ Found LibreTime track ID: ${ltTrackId}`)
        }
      }

      await logLifecycle({
        operation: 'rehydrate',
        event: 'copied',
        episodeId,
        workingPath: ltPathRelative,
        archivePath: archivePathRelative,
        bytes: result.bytes,
        duration_ms: result.duration_ms,
        ts: new Date().toISOString(),
      })

      return {
        episodeId,
        status: 'copied',
        action: 'copied_from_archive',
        workingPath: ltPathRelative,
        bytes: result.bytes,
        duration_ms: result.duration_ms,
        ltTrackId,
      }
    } catch (error: any) {
      if (error instanceof RsyncPullError) {
        await logLifecycle({
          operation: 'rehydrate',
          event: 'error',
          episodeId,
          workingPath: ltPathRelative,
          archivePath: archivePathRelative,
          code: error.code,
          message: error.message,
          ts: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
        })

        return {
          episodeId,
          status: 'error',
          action: 'error',
          workingPath: ltPathRelative,
          error: {
            code: error.code,
            message: error.message,
          },
        }
      }

      throw error
    }
  } catch (error: any) {
    const errorCode =
      error.response?.status === 404 ? RehydrateErrorCode.E_EPISODE_NOT_FOUND : 'E_UNKNOWN'

    const errorMessage =
      error.response?.status === 404 ? 'Episode not found in Payload' : error.message

    await logLifecycle({
      operation: 'rehydrate',
      event: 'error',
      episodeId,
      code: errorCode,
      message: errorMessage,
      ts: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    })

    return {
      episodeId,
      status: 'error',
      action: 'error',
      workingPath: '',
      error: {
        code: errorCode,
        message: errorMessage,
      },
    }
  }
}

/**
 * CLI argument parsing
 */
function parseArgs(): RehydrateOptions {
  const args = process.argv.slice(2)

  let episodeId = ''
  let verify = false
  let dryRun = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '--id':
      case '--episodeId':
        episodeId = args[++i]
        break
      case '--verify':
        verify = true
        break
      case '--dry-run':
        dryRun = true
        break
      case '--help':
        console.log(
          'Usage: npx tsx scripts/lifecycle/rehydrateEpisode.ts --id <episodeId> [options]',
        )
        console.log('')
        console.log('Options:')
        console.log('  --id, --episodeId ID   Episode ID to rehydrate (required)')
        console.log('  --dry-run              Preview actions without making changes')
        console.log('  --verify               Verify file integrity (future use)')
        console.log('  --help                 Show this help')
        console.log('')
        console.log('Examples:')
        console.log('  npx tsx scripts/lifecycle/rehydrateEpisode.ts --id 685e6a54b3ef76e0e25c1921')
        console.log(
          '  npx tsx scripts/lifecycle/rehydrateEpisode.ts --id 685e6a54b3ef76e0e25c1921 --dry-run',
        )
        process.exit(0)
      default:
        if (arg.startsWith('--')) {
          console.error(`❌ Unknown option: ${arg}`)
          process.exit(1)
        }
        break
    }
  }

  if (!episodeId) {
    console.error('❌ --id option is required')
    process.exit(1)
  }

  return { episodeId, verify, dryRun }
}

/**
 * Main CLI execution
 */
async function main() {
  try {
    const options = parseArgs()

    console.log('🎧 Rehydrate Episode Script')
    console.log('===========================')
    console.log(`📋 Episode ID: ${options.episodeId}`)
    console.log(`🔍 Dry run: ${options.dryRun}`)
    console.log('')

    const result = await rehydrateEpisode(options)

    console.log('')
    console.log('=== Result ===')
    console.log(JSON.stringify(result, null, 2))

    if (result.status === 'error') {
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
