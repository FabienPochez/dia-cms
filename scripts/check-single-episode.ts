#!/usr/bin/env tsx
import { getPayload } from 'payload'
import config from '../src/payload.config.js'

async function check() {
  const payload = await getPayload({ config })
  const episodeId = process.argv[2] || '69637b80d03db1bea1fc074b'
  
  try {
    const episode = await payload.findByID({ collection: 'episodes', id: episodeId })
    console.log(`\n📁 Episode ${episodeId}:`)
    console.log(`   Title: ${episode.title}`)
    console.log(`   publishedStatus: ${episode.publishedStatus}`)
    console.log(`   airStatus: ${episode.airStatus}`)
    console.log(`   scheduledEnd: ${episode.scheduledEnd}`)
    console.log(`   firstAiredAt: ${episode.firstAiredAt}`)
    console.log(`   libretimeFilepathRelative: ${episode.libretimeFilepathRelative || '(none)'}`)
  } catch (error: any) {
    console.log(`\n❌ Episode ${episodeId}: Error - ${error.message}`)
  }
  process.exit(0)
}

check()
