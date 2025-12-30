#!/usr/bin/env node
/**
 * Quick LibreTime status check
 * - Current system time
 * - What's scheduled now
 * - What's scheduled in the next hour
 */

import { LibreTimeClient } from '../src/integrations/libretimeClient'

async function main() {
  const client = new LibreTimeClient()
  const now = new Date()
  const nowIso = now.toISOString()
  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000)
  const oneHourLaterIso = oneHourLater.toISOString()

  console.log('='.repeat(80))
  console.log('📻 LibreTime Status Check')
  console.log('='.repeat(80))
  console.log(`\n🕐 Current System Time (UTC): ${now.toISOString()}`)
  console.log(`🕐 Current System Time (Paris): ${new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' })).toISOString()}`)
  console.log(`   (Local: ${now.toLocaleString('en-US', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'long' })})`)

  try {
    // Get current schedule (what's playing now)
    console.log('\n📅 Current Schedule (playing now):')
    const currentSchedule = await client.getSchedule({
      starts: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), // 1 hour ago
      ends: nowIso,
      limit: 50,
    })

    const playingNow = currentSchedule.filter((s) => {
      const starts = new Date(s.starts_at)
      const ends = new Date(s.ends_at)
      return starts <= now && ends > now
    })

    if (playingNow.length === 0) {
      console.log('   ⚠️  NO SHOW SCHEDULED RIGHT NOW!')
    } else {
      for (const item of playingNow) {
        const starts = new Date(item.starts_at)
        const ends = new Date(item.ends_at)
        const elapsed = Math.floor((now.getTime() - starts.getTime()) / 1000 / 60)
        const remaining = Math.floor((ends.getTime() - now.getTime()) / 1000 / 60)
        console.log(`   ✅ ${item.file?.track_title || 'Unknown'} (ID: ${item.file?.id || 'N/A'})`)
        console.log(`      Started: ${starts.toISOString()} (${elapsed} min ago)`)
        console.log(`      Ends: ${ends.toISOString()} (${remaining} min remaining)`)
        console.log(`      Instance: ${item.instance || 'N/A'}`)
      }
    }

    // Get upcoming schedule (next hour)
    console.log('\n📅 Upcoming Schedule (next hour):')
    const upcomingSchedule = await client.getSchedule({
      starts: nowIso,
      ends: oneHourLaterIso,
      limit: 50,
    })

    if (upcomingSchedule.length === 0) {
      console.log('   ⚠️  NO SHOWS SCHEDULED IN THE NEXT HOUR!')
    } else {
      for (const item of upcomingSchedule) {
        const starts = new Date(item.starts_at)
        const ends = new Date(item.ends_at)
        const minutesUntil = Math.floor((starts.getTime() - now.getTime()) / 1000 / 60)
        console.log(`   📌 ${item.file?.track_title || 'Unknown'} (ID: ${item.file?.id || 'N/A'})`)
        console.log(`      Starts: ${starts.toISOString()} (in ${minutesUntil} min)`)
        console.log(`      Ends: ${ends.toISOString()}`)
        console.log(`      Instance: ${item.instance || 'N/A'}`)
      }
    }

    // Check for gaps
    console.log('\n🔍 Gap Analysis:')
    const allSchedule = await client.getSchedule({
      starts: nowIso,
      ends: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), // next 24 hours
      limit: 200,
    })

    if (allSchedule.length === 0) {
      console.log('   ⚠️  NO SCHEDULE FOUND FOR NEXT 24 HOURS!')
    } else {
      // Sort by start time
      allSchedule.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())

      let cursor = now
      const gaps: Array<{ start: Date; end: Date; duration: number }> = []

      for (const item of allSchedule) {
        const starts = new Date(item.starts_at)
        if (starts > cursor) {
          const gapMinutes = Math.floor((starts.getTime() - cursor.getTime()) / 1000 / 60)
          if (gapMinutes > 5) {
            // Only report gaps > 5 minutes
            gaps.push({
              start: cursor,
              end: starts,
              duration: gapMinutes,
            })
          }
        }
        const ends = new Date(item.ends_at)
        if (ends > cursor) {
          cursor = ends
        }
      }

      if (gaps.length === 0) {
        console.log('   ✅ No significant gaps found in next 24 hours')
      } else {
        console.log(`   ⚠️  Found ${gaps.length} gap(s):`)
        for (const gap of gaps) {
          console.log(`      ${gap.start.toISOString()} → ${gap.end.toISOString()} (${gap.duration} min)`)
        }
      }
    }
  } catch (error: any) {
    console.error('\n❌ Error checking LibreTime:', error.message)
    if (error.details) {
      console.error('   Details:', error.details)
    }
    process.exit(1)
  }

  console.log('\n' + '='.repeat(80))
}

main().catch(console.error)

