#!/usr/bin/env tsx
/**
 * hydrate-archive-paths.ts
 *
 * Hydrates Payload episodes with archive file paths after successful rsync transfers.
 * Reads JSONL log files from batch_rsync_hydrate.sh and updates hasArchiveFile + archiveFilePath.
 *
 * Usage:
 *   npx tsx scripts/hydrate-archive-paths.ts --log /var/log/dia-import/rsync-archive-success.jsonl
 *   npx tsx scripts/hydrate-archive-paths.ts --log /var/log/dia-import/rsync-archive-success.jsonl --dry-run
 *   npx tsx scripts/hydrate-archive-paths.ts --log /var/log/dia-import/rsync-archive-success.jsonl --verify --force
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import { config } from 'dotenv'

// Load environment variables
config()

const execAsync = promisify(exec)

// Types
interface ArchiveLogEntry {
  episodeId: string
  archivePath: string
  bucket: string
  filename: string
  size: number
  md5?: string
  ts: string
  rsyncExitCode: number
  error?: string // For error records
}

interface HydrateOptions {
  logFile: string
  dryRun: boolean
  force: boolean
  verify: boolean
  checkLibreTime: boolean
}

interface HydrateResult {
  episodeId: string
  status: 'success' | 'skipped' | 'failed'
  reason: string
  archivePath?: string
  hydratedLibreTime?: boolean
}

interface LibreTimeFile {
  id: number
  name?: string
  filepath?: string
  [key: string]: any
}

// Configuration
const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'https://content.diaradio.live'
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY
const LIBRETIME_API_URL = process.env.LIBRETIME_API_URL || 'http://api:9001'
const LIBRETIME_API_KEY = process.env.LIBRETIME_API_KEY
const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'

if (!PAYLOAD_API_KEY) {
  console.error('❌ PAYLOAD_API_KEY environment variable is required')
  process.exit(1)
}

if (!LIBRETIME_API_KEY) {
  console.error('❌ LIBRETIME_API_KEY environment variable is required')
  process.exit(1)
}

// Helper functions
function buildPayloadAuthHeaders() {
  return {
    Authorization: `JWT ${PAYLOAD_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

function buildLibreTimeHeaders() {
  return {
    Authorization: `Api-Key ${LIBRETIME_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Search LibreTime for a file by episode ID prefix
 */
async function findLibreTimeFileByEpisodeId(episodeId: string): Promise<LibreTimeFile | null> {
  try {
    console.log(`🔍 Searching LibreTime for episode: ${episodeId}`)

    const response = await axios.get(`${LIBRETIME_API_URL}/api/v2/files?search=${episodeId}__`, {
      headers: buildLibreTimeHeaders(),
      timeout: 10000,
    })

    const files: LibreTimeFile[] = response.data

    // Filter to only include files that actually match the prefix
    const matchingFiles = files.filter((file) => {
      const filepath = file.filepath || file.name || ''
      const filename = filepath.split('/').pop() || ''
      return filename.startsWith(`${episodeId}__`)
    })

    if (matchingFiles.length > 0) {
      console.log(`✅ Found LibreTime track: ID ${matchingFiles[0].id}`)
      return matchingFiles[0]
    } else {
      console.log(`⚠️  No LibreTime track found for episode ${episodeId}`)
      return null
    }
  } catch (error: any) {
    console.log(`⚠️  LibreTime API search failed: ${error.message}`)
    return null
  }
}

/**
 * Convert absolute LibreTime filepath to relative path
 */
function getRelativeLibreTimePath(absolutePath: string): string {
  if (absolutePath.startsWith(LIBRETIME_LIBRARY_ROOT)) {
    return path.relative(LIBRETIME_LIBRARY_ROOT, absolutePath)
  }
  return absolutePath
}

/**
 * Parse JSONL log file
 */
async function parseLog(logPath: string): Promise<ArchiveLogEntry[]> {
  console.log(`📖 Reading log file: ${logPath}`)

  try {
    const content = await fs.readFile(logPath, 'utf-8')
    const lines = content.trim().split('\n')
    const entries: ArchiveLogEntry[] = []

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const entry = JSON.parse(line)

        // Skip error records
        if (entry.error) {
          console.log(`⚠️  Skipping error record: ${entry.filename}`)
          continue
        }

        // Validate required fields
        if (!entry.episodeId || !entry.archivePath) {
          console.log(`⚠️  Invalid log entry (missing fields): ${line}`)
          continue
        }

        entries.push(entry)
      } catch (error) {
        console.log(`⚠️  Failed to parse log line: ${line}`)
      }
    }

    console.log(`📊 Parsed ${entries.length} valid entries from log`)
    return entries
  } catch (error) {
    console.error(`❌ Failed to read log file: ${error}`)
    throw error
  }
}

/**
 * Verify file exists on Hetzner Storage Box
 */
async function verifyRemoteFile(archivePath: string): Promise<boolean> {
  try {
    console.log(`🔍 Verifying remote file: ${archivePath}`)
    const command = `ssh bx-archive "test -f /home/archive/${archivePath} && echo 'exists'"`
    const { stdout } = await execAsync(command, { timeout: 10000 })
    const exists = stdout.trim() === 'exists'

    if (exists) {
      console.log(`✅ Remote file verified: ${archivePath}`)
    } else {
      console.log(`❌ Remote file not found: ${archivePath}`)
    }

    return exists
  } catch (error: any) {
    console.log(`⚠️  Remote verification failed for ${archivePath}: ${error.message}`)
    return false
  }
}

/**
 * Hydrate single episode
 */
async function hydrateEpisode(
  entry: ArchiveLogEntry,
  options: HydrateOptions,
): Promise<HydrateResult> {
  const { episodeId, archivePath } = entry

  try {
    // Optional: Verify file exists on remote
    if (options.verify) {
      const exists = await verifyRemoteFile(archivePath)
      if (!exists) {
        return {
          episodeId,
          status: 'failed',
          reason: 'File not found on remote storage',
        }
      }
    }

    // Fetch current episode state
    const getResponse = await axios.get(`${PAYLOAD_API_URL}/api/episodes/${episodeId}`, {
      headers: buildPayloadAuthHeaders(),
      timeout: 10000,
    })

    const episode = getResponse.data

    // Check if already archived (unless --force)
    if (!options.force && episode.archiveFilePath) {
      if (episode.archiveFilePath === archivePath) {
        return {
          episodeId,
          status: 'skipped',
          reason: 'Already archived with same path',
          archivePath,
        }
      } else {
        console.log(`⚠️  Episode ${episodeId} has different archive path:`)
        console.log(`   Current: ${episode.archiveFilePath}`)
        console.log(`   New: ${archivePath}`)
        console.log(`   Use --force to override`)
        return {
          episodeId,
          status: 'skipped',
          reason: 'Different archive path exists (use --force)',
          archivePath: episode.archiveFilePath,
        }
      }
    }

    // Check if LibreTime fields are missing and need hydration
    let ltTrackId = episode.libretimeTrackId
    let ltFilepath = episode.libretimeFilepathRelative
    let needsLibreTimeHydration = false

    if (options.checkLibreTime && (!ltTrackId || !ltFilepath)) {
      console.log(`⚠️  Episode ${episodeId} missing LibreTime fields, attempting lookup...`)
      const ltFile = await findLibreTimeFileByEpisodeId(episodeId)

      if (ltFile) {
        ltTrackId = ltFile.id
        ltFilepath = ltFile.filepath ? getRelativeLibreTimePath(ltFile.filepath) : undefined
        needsLibreTimeHydration = true
        console.log(`✅ Found in LibreTime: track_id=${ltTrackId}, filepath=${ltFilepath}`)
      } else {
        return {
          episodeId,
          status: 'failed',
          reason: 'Track not found in LibreTime (run import-batch-archives-media.ts first)',
        }
      }
    }

    // Prepare update payload
    const updateData: any = {
      hasArchiveFile: true,
      archiveFilePath: archivePath,
    }

    // Add LibreTime fields if we found them
    if (needsLibreTimeHydration && ltTrackId && ltFilepath) {
      updateData.libretimeTrackId = ltTrackId
      updateData.libretimeFilepathRelative = ltFilepath
    }

    if (options.dryRun) {
      console.log(`🔍 DRY-RUN: Would update episode ${episodeId}`)
      console.log(`   hasArchiveFile: true`)
      console.log(`   archiveFilePath: ${archivePath}`)
      if (needsLibreTimeHydration) {
        console.log(`   libretimeTrackId: ${ltTrackId}`)
        console.log(`   libretimeFilepathRelative: ${ltFilepath}`)
      }
      return {
        episodeId,
        status: 'success',
        reason: 'Dry-run (would update)',
        archivePath,
        hydratedLibreTime: needsLibreTimeHydration,
      }
    }

    // Update Payload
    await axios.patch(`${PAYLOAD_API_URL}/api/episodes/${episodeId}`, updateData, {
      headers: buildPayloadAuthHeaders(),
      timeout: 10000,
    })

    const message = needsLibreTimeHydration
      ? `✅ Updated episode ${episodeId}: archive + LibreTime fields`
      : `✅ Updated episode ${episodeId}: ${archivePath}`
    console.log(message)

    return {
      episodeId,
      status: 'success',
      reason: needsLibreTimeHydration
        ? 'Updated archive + LibreTime fields'
        : 'Successfully updated',
      archivePath,
      hydratedLibreTime: needsLibreTimeHydration,
    }
  } catch (error: any) {
    if (error.response?.status === 404) {
      return {
        episodeId,
        status: 'failed',
        reason: 'Episode not found in Payload',
      }
    }
    return {
      episodeId,
      status: 'failed',
      reason: `Error: ${error.message}`,
    }
  }
}

/**
 * Main hydration function
 */
async function hydrateArchivePaths(options: HydrateOptions): Promise<void> {
  console.log('🎧 Archive Paths Hydration Script')
  console.log('==================================')
  console.log(`📁 Log file: ${options.logFile}`)
  console.log(`🔍 Dry run: ${options.dryRun}`)
  console.log(`🔐 Force update: ${options.force}`)
  console.log(`✓  Verify remote: ${options.verify}`)
  console.log(`📡 Check LibreTime: ${options.checkLibreTime}`)
  console.log('')

  // Parse log file
  const entries = await parseLog(options.logFile)

  if (entries.length === 0) {
    console.log('ℹ️  No valid entries found in log file')
    return
  }

  // Process entries
  console.log(`🚀 Processing ${entries.length} entries...`)
  console.log('')

  const results: HydrateResult[] = []
  let successCount = 0
  let skippedCount = 0
  let failedCount = 0
  let libretimeHydratedCount = 0

  for (const entry of entries) {
    const result = await hydrateEpisode(entry, options)
    results.push(result)

    switch (result.status) {
      case 'success':
        successCount++
        if (result.hydratedLibreTime) {
          libretimeHydratedCount++
        }
        break
      case 'skipped':
        skippedCount++
        break
      case 'failed':
        failedCount++
        break
    }

    // Small delay to avoid overwhelming the API
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  // Summary
  console.log('')
  console.log('=== Hydration Summary ===')
  console.log(`✅ Successfully updated: ${successCount}`)
  if (libretimeHydratedCount > 0) {
    console.log(`📡 LibreTime fields hydrated: ${libretimeHydratedCount}`)
  }
  console.log(`⏭️  Skipped: ${skippedCount}`)
  console.log(`❌ Failed: ${failedCount}`)
  console.log(`📊 Total processed: ${results.length}`)

  // Show failed entries
  const failedResults = results.filter((r) => r.status === 'failed')
  if (failedResults.length > 0) {
    console.log('')
    console.log('❌ Failed entries:')
    failedResults.forEach((result) => {
      console.log(`   ${result.episodeId}: ${result.reason}`)
    })
  }

  // Show skipped entries
  const skippedResults = results.filter((r) => r.status === 'skipped')
  if (skippedResults.length > 0) {
    console.log('')
    console.log('⏭️  Skipped entries:')
    skippedResults.forEach((result) => {
      console.log(`   ${result.episodeId}: ${result.reason}`)
    })
  }

  if (failedCount > 0) {
    console.log('')
    console.log('❌ Hydration completed with errors')
    process.exit(1)
  } else {
    console.log('')
    console.log('✅ Hydration completed successfully')
  }
}

// CLI argument parsing
function parseArgs(): HydrateOptions {
  const args = process.argv.slice(2)

  let logFile = ''
  let dryRun = false
  let force = false
  let verify = false
  let checkLibreTime = true // Default: enabled

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '--log':
        logFile = args[++i]
        break
      case '--dry-run':
        dryRun = true
        break
      case '--force':
        force = true
        break
      case '--verify':
        verify = true
        break
      case '--check-libretime':
        checkLibreTime = true
        break
      case '--no-check-libretime':
        checkLibreTime = false
        break
      case '--help':
        console.log('Usage: npx tsx scripts/hydrate-archive-paths.ts --log <logfile> [options]')
        console.log('')
        console.log('Options:')
        console.log(
          '  --log FILE              JSONL log file from batch_rsync_hydrate.sh (required)',
        )
        console.log('  --dry-run               Show what would be updated without making changes')
        console.log('  --force                 Override existing archive paths')
        console.log(
          '  --verify                Verify files exist on remote storage before updating',
        )
        console.log(
          '  --check-libretime       Check & hydrate LibreTime fields if missing (default: enabled)',
        )
        console.log('  --no-check-libretime    Skip LibreTime field checking')
        console.log('  --help                  Show this help')
        console.log('')
        console.log('Examples:')
        console.log(
          '  npx tsx scripts/hydrate-archive-paths.ts --log /srv/media/logs/rsync-archive-success.jsonl',
        )
        console.log(
          '  npx tsx scripts/hydrate-archive-paths.ts --log /srv/media/logs/rsync-archive-success.jsonl --dry-run',
        )
        console.log(
          '  npx tsx scripts/hydrate-archive-paths.ts --log /srv/media/logs/rsync-archive-success.jsonl --verify --force',
        )
        console.log(
          '  npx tsx scripts/hydrate-archive-paths.ts --log /srv/media/logs/rsync-archive-success.jsonl --no-check-libretime',
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

  if (!logFile) {
    console.error('❌ --log option is required')
    process.exit(1)
  }

  return { logFile, dryRun, force, verify, checkLibreTime }
}

// Main execution
async function main() {
  try {
    const options = parseArgs()
    await hydrateArchivePaths(options)
  } catch (error) {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
