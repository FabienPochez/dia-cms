#!/usr/bin/env node
/**
 * Detailed LibreTime schedule check
 * Check what's actually in the schedule entry
 */

import { LibreTimeClient } from '../src/integrations/libretimeClient'

async function main() {
  const client = new LibreTimeClient()
  const now = new Date()
  const nowIso = now.toISOString()

  console.log('='.repeat(80))
  console.log('📻 LibreTime Detailed Schedule Check')
  console.log('='.repeat(80))
  console.log(`\n🕐 Current Time (UTC): ${nowIso}`)
  console.log(`🕐 Current Time (Paris): ${new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' })).toISOString()}`)

  try {
    // Get current schedule
    const currentSchedule = await client.getSchedule({
      starts: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      ends: nowIso,
      limit: 50,
    })

    const playingNow = currentSchedule.filter((s) => {
      const starts = new Date(s.starts_at)
      const ends = new Date(s.ends_at)
      return starts <= now && ends > now
    })

    console.log(`\n📅 Found ${playingNow.length} schedule entry(ies) playing now:\n`)

    for (const item of playingNow) {
      console.log('Schedule Entry:')
      console.log(JSON.stringify(item, null, 2))
      console.log('\n')

      // Try to get file details if file ID exists
      if (item.file && typeof item.file === 'number') {
        try {
          const file = await client.getFile(item.file)
          console.log('File Details:')
          console.log(JSON.stringify(file, null, 2))
        } catch (error: any) {
          console.log(`❌ Could not fetch file ${item.file}: ${error.message}`)
        }
      } else if (item.file && typeof item.file === 'object') {
        console.log('File Object (embedded):')
        console.log(JSON.stringify(item.file, null, 2))
      } else {
        console.log('❌ No file associated with this schedule entry!')
      }
    }

    // Check upcoming schedule
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000)
    const upcomingSchedule = await client.getSchedule({
      starts: nowIso,
      ends: oneHourLater.toISOString(),
      limit: 10,
    })

    console.log(`\n📅 Next ${upcomingSchedule.length} schedule entry(ies):\n`)
    for (const item of upcomingSchedule.slice(0, 3)) {
      const starts = new Date(item.starts_at)
      const minutesUntil = Math.floor((starts.getTime() - now.getTime()) / 1000 / 60)
      console.log(`In ${minutesUntil} min: Instance ${item.instance}, File: ${item.file || 'NONE'}`)
      if (item.file && typeof item.file === 'number') {
        try {
          const file = await client.getFile(item.file)
          console.log(`  Title: ${file.track_title || 'N/A'}`)
          console.log(`  Exists: ${file.exists}, Hidden: ${file.hidden}`)
        } catch (error: any) {
          console.log(`  ❌ Could not fetch file: ${error.message}`)
        }
      }
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.details) {
      console.error('   Details:', error.details)
    }
    process.exit(1)
  }

  console.log('\n' + '='.repeat(80))
}

main().catch(console.error)

