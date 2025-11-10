#!/usr/bin/env tsx
/**
 * cleanup-imported-files.ts
 *
 * Removes successfully transferred files from /srv/media/imported/1 after archive transfer and Payload hydration.
 * Reads JSONL log from batch_rsync_hydrate.sh to identify which files to remove.
 *
 * Usage:
 *   npx tsx scripts/cleanup-imported-files.ts --log /srv/media/logs/rsync-archive-success.jsonl
 *   npx tsx scripts/cleanup-imported-files.ts --log /srv/media/logs/rsync-archive-success.jsonl --dry-run
 *   npx tsx scripts/cleanup-imported-files.ts --log /srv/media/logs/rsync-archive-success.jsonl --verify-payload
 */

import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import { config } from 'dotenv'

// Load environment variables
config()

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

interface CleanupOptions {
  logFile: string
  dryRun: boolean
  verifyPayload: boolean
}

interface CleanupResult {
  filename: string
  status: 'deleted' | 'skipped' | 'failed'
  reason: string
}

// Configuration
const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'https://content.diaradio.live'
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY
const IMPORTED_DIR = '/srv/media/imported/1'

if (!PAYLOAD_API_KEY) {
  console.error('❌ PAYLOAD_API_KEY environment variable is required')
  process.exit(1)
}

// Helper functions
function buildPayloadAuthHeaders() {
  return {
    Authorization: `JWT ${PAYLOAD_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Parse JSONL log file
 */
async function parseLog(logPath: string): Promise<ArchiveLogEntry[]> {
  console.log(`📖 Reading log file: ${logPath}`)

  try {
    const content = await fs.readFile(logPath, 'utf-8')
    const lines = content
      .trim()
      .split('\n')
      .filter((line) => line.trim())

    const entries: ArchiveLogEntry[] = []
    let errorCount = 0

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ArchiveLogEntry

        // Skip error records
        if (entry.error || entry.rsyncExitCode !== 0) {
          errorCount++
          continue
        }

        // Validate required fields
        if (!entry.episodeId || !entry.filename) {
          console.log(`⚠️  Skipping invalid entry: ${line}`)
          continue
        }

        entries.push(entry)
      } catch (parseError) {
        console.log(`⚠️  Skipping malformed JSON line: ${line}`)
      }
    }

    console.log(`📊 Parsed ${entries.length} valid entries from log`)
    if (errorCount > 0) {
      console.log(`⚠️  Skipped ${errorCount} error entries`)
    }

    return entries
  } catch (error: any) {
    console.error(`❌ Failed to read log file: ${error.message}`)
    process.exit(1)
  }
}

/**
 * Verify episode has been hydrated in Payload
 */
async function verifyPayloadHydration(episodeId: string): Promise<boolean> {
  try {
    const response = await axios.get(`${PAYLOAD_API_URL}/api/episodes/${episodeId}`, {
      headers: buildPayloadAuthHeaders(),
      timeout: 10000,
    })

    const episode = response.data
    return !!(episode.hasArchiveFile && episode.archiveFilePath)
  } catch (error: any) {
    console.log(`⚠️  Failed to verify Payload hydration for ${episodeId}: ${error.message}`)
    return false
  }
}

/**
 * Clean up a single file
 */
async function cleanupFile(
  entry: ArchiveLogEntry,
  options: CleanupOptions,
): Promise<CleanupResult> {
  const { episodeId, filename } = entry

  try {
    // Search for file recursively (it may be in subdirectories)
    const { glob } = await import('glob')
    const matches = await glob(`**/${filename}`, {
      cwd: IMPORTED_DIR,
      absolute: true,
      nodir: true,
    })

    if (matches.length === 0) {
      return {
        filename,
        status: 'skipped',
        reason: 'File not found in imported directory',
      }
    }

    if (matches.length > 1) {
      return {
        filename,
        status: 'skipped',
        reason: `Multiple files found with same name: ${matches.join(', ')}`,
      }
    }

    const filePath = matches[0]

    // Optional: Verify Payload hydration
    if (options.verifyPayload) {
      const isHydrated = await verifyPayloadHydration(episodeId)
      if (!isHydrated) {
        return {
          filename,
          status: 'skipped',
          reason: 'Episode not hydrated in Payload (use --force to override)',
        }
      }
    }

    if (options.dryRun) {
      console.log(`🔍 DRY-RUN: Would delete ${filename}`)
      return {
        filename,
        status: 'deleted',
        reason: 'Dry-run (would delete)',
      }
    }

    // Delete the file
    await fs.unlink(filePath)
    console.log(`🗑️  Deleted: ${filename}`)

    return {
      filename,
      status: 'deleted',
      reason: 'Successfully deleted',
    }
  } catch (error: any) {
    return {
      filename,
      status: 'failed',
      reason: `Error: ${error.message}`,
    }
  }
}

/**
 * Main cleanup function
 */
async function cleanupImportedFiles(options: CleanupOptions): Promise<void> {
  console.log('🧹 Imported Files Cleanup Script')
  console.log('=================================')
  console.log(`📁 Log file: ${options.logFile}`)
  console.log(`🔍 Dry run: ${options.dryRun}`)
  console.log(`✓  Verify Payload: ${options.verifyPayload}`)
  console.log(`📂 Target directory: ${IMPORTED_DIR}`)
  console.log('')

  // Parse log file
  const entries = await parseLog(options.logFile)

  if (entries.length === 0) {
    console.log('ℹ️  No valid entries found in log file')
    return
  }

  // Process entries
  console.log(`🚀 Processing ${entries.length} files for cleanup...`)
  console.log('')

  const results: CleanupResult[] = []
  let deletedCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const entry of entries) {
    const result = await cleanupFile(entry, options)
    results.push(result)

    switch (result.status) {
      case 'deleted':
        deletedCount++
        break
      case 'skipped':
        skippedCount++
        break
      case 'failed':
        failedCount++
        break
    }

    // Small delay to avoid overwhelming the system
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  // Summary
  console.log('')
  console.log('=== Cleanup Summary ===')
  console.log(`🗑️  Files deleted: ${deletedCount}`)
  console.log(`⏭️  Files skipped: ${skippedCount}`)
  console.log(`❌ Files failed: ${failedCount}`)
  console.log(`📊 Total processed: ${results.length}`)

  // Show failed entries
  const failedResults = results.filter((r) => r.status === 'failed')
  if (failedResults.length > 0) {
    console.log('')
    console.log('❌ Failed deletions:')
    failedResults.forEach((result) => {
      console.log(`   ${result.filename}: ${result.reason}`)
    })
  }

  // Show skipped entries
  const skippedResults = results.filter((r) => r.status === 'skipped')
  if (skippedResults.length > 0) {
    console.log('')
    console.log('⏭️  Skipped files:')
    skippedResults.forEach((result) => {
      console.log(`   ${result.filename}: ${result.reason}`)
    })
  }

  if (failedCount === 0) {
    console.log('')
    console.log('✅ Cleanup completed successfully')
  } else {
    console.log('')
    console.log('⚠️  Cleanup completed with some failures')
    process.exit(1)
  }
}

// CLI argument parsing
function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2)

  let logFile = ''
  let dryRun = false
  let verifyPayload = true // Default: enabled

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '--log':
        logFile = args[++i]
        break
      case '--dry-run':
        dryRun = true
        break
      case '--verify-payload':
        verifyPayload = true
        break
      case '--no-verify-payload':
        verifyPayload = false
        break
      case '--help':
        console.log('Usage: npx tsx scripts/cleanup-imported-files.ts --log <logfile> [options]')
        console.log('')
        console.log('Options:')
        console.log(
          '  --log FILE              JSONL log file from batch_rsync_hydrate.sh (required)',
        )
        console.log('  --dry-run               Show what would be deleted without making changes')
        console.log(
          '  --verify-payload        Verify Payload hydration before deletion (default: enabled)',
        )
        console.log('  --no-verify-payload     Skip Payload verification')
        console.log('  --help                  Show this help')
        console.log('')
        console.log('Examples:')
        console.log(
          '  npx tsx scripts/cleanup-imported-files.ts --log /srv/media/logs/rsync-archive-success.jsonl',
        )
        console.log(
          '  npx tsx scripts/cleanup-imported-files.ts --log /srv/media/logs/rsync-archive-success.jsonl --dry-run',
        )
        console.log(
          '  npx tsx scripts/cleanup-imported-files.ts --log /srv/media/logs/rsync-archive-success.jsonl --no-verify-payload',
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

  return { logFile, dryRun, verifyPayload }
}

// Main execution
async function main() {
  try {
    const options = parseArgs()
    await cleanupImportedFiles(options)
  } catch (error: any) {
    console.error(`❌ Script failed: ${error.message}`)
    process.exit(1)
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
