#!/usr/bin/env tsx
import 'dotenv/config'
import { getPayload } from 'payload'
import payloadConfig from '../src/payload.config'

async function checkEpisode() {
  const payload = await getPayload({ config: payloadConfig })
  
  // Check one of the Thursday episodes
  const episodeId = '695d1c2ed03db1bea1f2a687' // High tea with Ceyda
  
  try {
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
      depth: 0,
    })
    
    console.log('\n📊 Episode Status Check:')
    console.log('='.repeat(50))
    console.log(`ID: ${episode.id}`)
    console.log(`Title: ${episode.title}`)
    console.log(`Published Status: ${episode.publishedStatus}`)
    console.log(`Air Status: ${episode.airStatus}`)
    console.log(`First Aired At: ${episode.firstAiredAt || '(not set)'}`)
    console.log(`Last Aired At: ${episode.lastAiredAt || '(not set)'}`)
    console.log(`Plays: ${episode.plays || 0}`)
    console.log(`Scheduled End: ${episode.scheduledEnd}`)
    console.log('='.repeat(50))
    
    // Check all 5 Thursday episodes
    const thursdayEpisodes = [
      '695d5fe9d03db1bea1f30cd3', // Planète Edena w/ Mids
      '695d1c2ed03db1bea1f2a687', // High tea with Ceyda
      '6943bf9b4a3a130aafe0b6bc', // Karpatxoa Katedrala
      '692567c9d3a867cc51d99948', // Les Moissons
      '6903873fa019a9b4e1bae0f4', // Boire l'eau des pâtes
    ]
    
    console.log('\n📋 Checking all 5 Thursday episodes:')
    console.log('='.repeat(50))
    
    for (const id of thursdayEpisodes) {
      try {
        const ep = await payload.findByID({
          collection: 'episodes',
          id,
          depth: 0,
        })
        console.log(`\n${ep.title}:`)
        console.log(`  Air Status: ${ep.airStatus}`)
        console.log(`  First Aired At: ${ep.firstAiredAt || '❌ NOT SET'}`)
        console.log(`  Published Status: ${ep.publishedStatus}`)
      } catch (error: any) {
        console.log(`\n❌ Episode ${id}: ${error.message}`)
      }
    }
    
    process.exit(0)
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`)
    process.exit(1)
  }
}

checkEpisode()
