#!/usr/bin/env tsx

/**
 * SoundCloud Duration Import Script
 *
 * Imports duration data from scripts/input/sc-durations.json and updates episodes.
 *
 * Usage:
 *   # Dry run (default)
 *   npx tsx scripts/import-sc-durations.ts --dry-run
 *
 *   # Real run
 *   npx tsx scripts/import-sc-durations.ts --dry-run=false --limit=100
 *
 *   # With limit
 *   npx tsx scripts/import-sc-durations.ts --limit=100 --dry-run=false
 */

import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import payload from 'payload'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

interface DurationData {
  episodeId: string
  scTrackId: number
  durationMs: number
  durationSec: number
  display: string
}

interface Episode {
  id: string
  title: string
  track_id?: number
  realDuration?: number
  realDurationDisplay?: string
  roundedDuration?: number
}

function calculateRoundedDuration(seconds: number): number {
  const minutes = seconds / 60

  // Hard-coded rounding rules
  if (minutes >= 55 && minutes <= 65) return 60
  if (minutes >= 85 && minutes <= 95) return 90
  if (minutes >= 115 && minutes <= 125) return 120

  // Default: round to nearest 5 minutes
  return Math.round(minutes / 5) * 5
}

async function updateEpisode(
  episodeId: string,
  durationData: DurationData,
  dryRun: boolean,
): Promise<boolean> {
  try {
    const realDuration = Math.max(0, Math.round(durationData.durationSec))
    const realDurationDisplay = durationData.display
    const roundedDuration = calculateRoundedDuration(realDuration)

    console.log(
      `[import] ${episodeId} scTrackId=${durationData.scTrackId} real=${realDuration} display=${realDurationDisplay} rounded=${roundedDuration}`,
    )

    if (!dryRun) {
      await payload.update({
        collection: 'episodes',
        id: episodeId,
        data: {
          realDuration,
          realDurationDisplay,
          roundedDuration,
        },
      })
    }

    return true
  } catch (error) {
    console.error(`❌ Failed to update episode ${episodeId}: ${error.message}`)
    return false
  }
}

async function run() {
  const args = process.argv.slice(2)
  const dryRun = !args.includes('--dry-run=false')
  const limitArg = args.find((arg) => arg.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 2000

  console.log(`🚀 Starting SoundCloud duration import (dry-run: ${dryRun}, limit: ${limit})`)

  const config = (await import(configPath)).default
  await payload.init({ secret: process.env.PAYLOAD_SECRET, local: true, config })

  // Load duration data
  const inputPath = path.resolve(__dirname, 'input/sc-durations.json')
  const raw = await fs.readFile(inputPath, 'utf-8')
  const durationData: DurationData[] = JSON.parse(raw)

  console.log(`📥 Loaded ${durationData.length} duration records`)

  let processed = 0
  let updated = 0
  let skipped = 0
  let notFound = 0

  for (const data of durationData) {
    if (processed >= limit) break

    try {
      // Verify episode exists
      const episode = await payload.findByID({
        collection: 'episodes',
        id: data.episodeId,
      })

      const success = await updateEpisode(data.episodeId, data, dryRun)
      processed++

      if (success) {
        updated++
      } else {
        skipped++
      }
    } catch (error) {
      console.error(`❌ Error processing ${data.episodeId}: ${error.message}`)
      skipped++
      processed++
      notFound++
    }
  }

  console.log(
    `Summary: processed=${processed} updated=${updated} skipped=${skipped} notFound=${notFound}`,
  )
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
