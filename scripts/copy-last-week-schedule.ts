#!/usr/bin/env tsx
/**
 * Copy last week's schedule to this week
 * 
 * This script:
 * 1. Finds all episodes scheduled last week (Monday 00:00 to Sunday 23:59:59)
 * 2. Reschedules them for this week (same day/time, +7 days)
 * 3. Uses planOne to create the schedule entries
 * 
 * Usage:
 *   tsx scripts/copy-last-week-schedule.ts [--dry-run]
 */

import { getPayload } from 'payload'
import config from '../src/payload.config'
import { planOne } from '../src/lib/services/scheduleOperations'

const DRY_RUN = process.argv.includes('--dry-run')

interface Episode {
  id: string
  scheduledAt: string
  scheduledEnd: string
  show: string | { id: string; libretimeInstanceId?: number }
  libretimeTrackId?: number | string
  title?: string
}

/**
 * Get Monday 00:00:00 of a given week in Paris timezone
 * Simplified: just subtract 7 days from current week start
 */
function getWeekStart(date: Date, weeksOffset: number = 0): Date {
  // Get current date in Paris timezone (using Intl API)
  const parisDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
  
  // Parse: "2025-11-25, 14:30:45"
  const [datePart, timePart] = parisDateStr.split(', ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second] = timePart.split(':').map(Number)
  
  // Create date object (this will be in local time, but we'll treat it as Paris time)
  const parisDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  
  // Calculate day of week (0 = Sunday, 1 = Monday, etc.)
  const dayOfWeek = parisDate.getUTCDay()
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1 // Monday = 0, Sunday = 6
  
  // Get Monday of the target week
  const monday = new Date(parisDate)
  monday.setUTCDate(parisDate.getUTCDate() - diffToMonday + (weeksOffset * 7))
  monday.setUTCHours(0, 0, 0, 0)
  
  // Convert Paris time to UTC (Paris is UTC+1 in winter, UTC+2 in summer)
  // Simple approximation: subtract 1 hour (will be off by 1 hour during DST, but close enough)
  // Actually, let's use a better approach: calculate the offset
  const utcDate = new Date(date)
  const parisOffset = date.getTime() - new Date(parisDateStr + ' GMT+0100').getTime()
  return new Date(monday.getTime() - parisOffset)
}

/**
 * Get Sunday 23:59:59.999 of a given week in Paris timezone
 */
function getWeekEnd(date: Date, weeksOffset: number = 0): Date {
  const monday = getWeekStart(date, weeksOffset)
  const sunday = new Date(monday)
  sunday.setTime(monday.getTime() + (6 * 24 * 60 * 60 * 1000) + (23 * 60 * 60 * 1000) + (59 * 60 * 1000) + (59 * 1000) + 999)
  return sunday
}

/**
 * Add 7 days to a date
 */
function addWeek(date: Date): Date {
  return new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000)
}

async function main() {
  console.log('📅 Copying last week\'s schedule to this week...\n')
  
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n')
  }

  const payload = await getPayload({ config })
  const now = new Date()
  
  // Calculate last week's range (Monday 00:00 to Sunday 23:59:59)
  const lastWeekStart = getWeekStart(now, -1)
  const lastWeekEnd = getWeekEnd(now, -1)
  
  console.log(`📆 Last week: ${lastWeekStart.toISOString()} to ${lastWeekEnd.toISOString()}`)
  console.log(`📆 This week: ${addWeek(lastWeekStart).toISOString()} to ${addWeek(lastWeekEnd).toISOString()}\n`)

  // Query episodes scheduled last week
  console.log('🔍 Querying episodes from last week...')
  const episodesResult = await payload.find({
    collection: 'episodes',
    where: {
      and: [
        { scheduledAt: { exists: true } },
        { scheduledEnd: { exists: true } },
        { scheduledAt: { greater_than_equal: lastWeekStart.toISOString() } },
        { scheduledAt: { less_than_equal: lastWeekEnd.toISOString() } },
        { publishedStatus: { equals: 'published' } },
      ],
    },
    sort: 'scheduledAt',
    limit: 1000,
    depth: 1, // Include show data
  })

  const episodes = episodesResult.docs as Episode[]
  console.log(`✅ Found ${episodes.length} episodes scheduled last week\n`)

  if (episodes.length === 0) {
    console.log('⚠️  No episodes found. Nothing to copy.')
    return
  }

  // Filter episodes that have required data
  const validEpisodes = episodes.filter((ep) => {
    if (!ep.scheduledAt || !ep.scheduledEnd) {
      console.warn(`⚠️  Skipping episode ${ep.id} (${ep.title || 'untitled'}): missing scheduledAt/scheduledEnd`)
      return false
    }

    const show = typeof ep.show === 'object' ? ep.show : null
    if (!show || !show.libretimeInstanceId) {
      console.warn(`⚠️  Skipping episode ${ep.id} (${ep.title || 'untitled'}): show not mapped to LibreTime instance`)
      return false
    }

    if (!ep.libretimeTrackId) {
      console.warn(`⚠️  Skipping episode ${ep.id} (${ep.title || 'untitled'}): missing libretimeTrackId`)
      return false
    }

    return true
  })

  console.log(`✅ ${validEpisodes.length} episodes ready to reschedule\n`)

  if (validEpisodes.length === 0) {
    console.log('⚠️  No valid episodes to copy.')
    return
  }

  // Reschedule each episode
  let successCount = 0
  let errorCount = 0

  for (const episode of validEpisodes) {
    const oldStart = new Date(episode.scheduledAt)
    const oldEnd = new Date(episode.scheduledEnd)
    const newStart = addWeek(oldStart)
    const newEnd = addWeek(oldEnd)

    const show = typeof episode.show === 'object' ? episode.show : null
    const showId = show?.id || (typeof episode.show === 'string' ? episode.show : null)

    if (!showId) {
      console.error(`❌ Episode ${episode.id}: Could not determine show ID`)
      errorCount++
      continue
    }

    console.log(`📌 ${episode.title || 'Untitled'}`)
    console.log(`   ${oldStart.toISOString()} → ${newStart.toISOString()}`)
    console.log(`   ${oldEnd.toISOString()} → ${newEnd.toISOString()}`)

    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would schedule episode ${episode.id} for show ${showId}\n`)
      successCount++
      continue
    }

    try {
      // Use planOne to schedule the episode
      const result = await planOne({
        episodeId: episode.id,
        showId: showId,
        scheduledAt: newStart.toISOString(),
        scheduledEnd: newEnd.toISOString(),
        dryRun: DRY_RUN,
      })

      if (!result.success) {
        console.error(`   ❌ Failed: ${result.error || result.code || 'Unknown error'}`)
        errorCount++
      } else {
        if (result.idempotent) {
          console.log(`   ✅ Already scheduled (idempotent, playoutId: ${result.playoutId || 'N/A'})\n`)
        } else {
          console.log(`   ✅ Scheduled (playoutId: ${result.playoutId || 'N/A'})\n`)
        }
        successCount++
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`)
      errorCount++
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  console.log('\n📊 Summary:')
  console.log(`   ✅ Successfully scheduled: ${successCount}`)
  console.log(`   ❌ Errors: ${errorCount}`)
  console.log(`   📝 Total processed: ${validEpisodes.length}`)
}

main()
  .then(() => {
    console.log('\n✅ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  })

