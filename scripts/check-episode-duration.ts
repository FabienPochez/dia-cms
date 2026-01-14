#!/usr/bin/env tsx
import { getPayload } from 'payload'
import config from '../src/payload.config.js'

async function checkEpisode() {
  const payload = await getPayload({ config })
  const episodeId = '695d1c2ed03db1bea1f2a687'
  
  try {
    const episode = await payload.findByID({ 
      collection: 'episodes', 
      id: episodeId,
      depth: 1 
    })
    
    console.log('\n📁 Episode Data:')
    console.log(`   ID: ${episode.id}`)
    console.log(`   Title: ${episode.title}`)
    console.log(`   Media ID: ${episode.media ? (typeof episode.media === 'string' ? episode.media : episode.media.id) : 'null'}`)
    console.log(`   roundedDuration: ${episode.roundedDuration ?? 'null'}`)
    console.log(`   realDuration: ${episode.realDuration ?? 'null'}`)
    console.log(`   duration: ${episode.duration ?? 'null'}`)
    console.log(`   airStatus: ${episode.airStatus}`)
    console.log(`   publishedStatus: ${episode.publishedStatus}`)
    console.log(`   createdAt: ${episode.createdAt}`)
    console.log(`   updatedAt: ${episode.updatedAt}`)
    
    // Check media file if exists
    if (episode.media) {
      const mediaId = typeof episode.media === 'string' ? episode.media : episode.media.id
      const media = await payload.findByID({ collection: 'media-tracks', id: mediaId })
      console.log(`\n📁 Media Track Data:`)
      console.log(`   ID: ${media.id}`)
      console.log(`   filename: ${media.filename}`)
      console.log(`   filesize: ${media.filesize}`)
      console.log(`   mimeType: ${media.mimeType}`)
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
  
  process.exit(0)
}

checkEpisode()


