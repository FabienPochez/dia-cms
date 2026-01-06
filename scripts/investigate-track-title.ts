import 'dotenv/config'
import axios from 'axios'

const LIBRETIME_API_KEY = process.env.LIBRETIME_API_KEY
const LIBRETIME_API_URL = process.env.LIBRETIME_API_URL || 'http://nginx:8080'
const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'http://payload:3000'
const PAYLOAD_INBOX_API_KEY = process.env.PAYLOAD_INBOX_API_KEY
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY
const PAYLOAD_AUTH_SLUG = process.env.PAYLOAD_AUTH_SLUG || 'users'

function buildPayloadAuthHeaders(): { Authorization: string; 'Content-Type': 'application/json' } {
  if (PAYLOAD_INBOX_API_KEY) {
    return {
      Authorization: `${PAYLOAD_AUTH_SLUG} API-Key ${PAYLOAD_INBOX_API_KEY}`,
      'Content-Type': 'application/json',
    }
  }
  if (PAYLOAD_API_KEY) {
    return {
      Authorization: `${PAYLOAD_AUTH_SLUG} API-Key ${PAYLOAD_API_KEY}`,
      'Content-Type': 'application/json',
    }
  }
  throw new Error('PAYLOAD_INBOX_API_KEY or PAYLOAD_API_KEY required')
}

async function investigate() {
  const episodeId = '6911e86b354d6d26f4bf20aa'
  
  console.log(`🔍 Investigating episode: ${episodeId}\n`)
  
  // 1. Fetch episode from Payload
  console.log('📺 Fetching episode from Payload...')
  try {
    const episodeResponse = await axios.get(`${PAYLOAD_API_URL}/api/episodes/${episodeId}?depth=2`, {
      headers: buildPayloadAuthHeaders(),
      timeout: 10000,
    })
    
    const episode = episodeResponse.data
    console.log('✅ Payload Episode Data:')
    console.log(`   ID: ${episode.id}`)
    console.log(`   Title: ${episode.title || '(null/empty)'}`)
    console.log(`   Show: ${typeof episode.show === 'object' ? episode.show?.title : episode.show || 'N/A'}`)
    console.log(`   Published Status: ${episode.publishedStatus || 'N/A'}`)
    console.log(`   Pending Review: ${episode.pendingReview || false}`)
    console.log(`   Air Status: ${episode.airStatus || 'N/A'}`)
    console.log(`   LibreTime Track ID: ${episode.libretimeTrackId || 'N/A'}`)
    console.log(`   LibreTime Filepath: ${episode.libretimeFilepathRelative || 'N/A'}`)
    console.log(`   Created At: ${episode.createdAt || 'N/A'}`)
    console.log(`   Updated At: ${episode.updatedAt || 'N/A'}`)
    
    // 2. Fetch track from LibreTime
    if (episode.libretimeTrackId) {
      console.log(`\n🎵 Fetching track from LibreTime (ID: ${episode.libretimeTrackId})...`)
      try {
        const trackResponse = await axios.get(`${LIBRETIME_API_URL}/api/v2/files/${episode.libretimeTrackId}`, {
          headers: {
            'Authorization': `Api-Key ${LIBRETIME_API_KEY}`,
          },
          timeout: 10000,
        })
        
        const track = trackResponse.data
        console.log('✅ LibreTime Track Data:')
        console.log(`   ID: ${track.id}`)
        console.log(`   Name: ${track.name || 'N/A'}`)
        console.log(`   Filepath: ${track.filepath || 'N/A'}`)
        console.log(`   Track Title: ${track.track_title || '(null/empty)'}`)
        console.log(`   Creator: ${track.creator || 'N/A'}`)
        console.log(`   MIME: ${track.mime || 'N/A'}`)
        console.log(`   Length: ${track.length || 'N/A'}`)
        
        // 3. Compare
        console.log(`\n🔍 Analysis:`)
        const expectedTitle = episode.title || (typeof episode.show === 'object' ? episode.show?.title : null)
        const actualTitle = track.track_title
        
        if (expectedTitle && actualTitle && expectedTitle !== actualTitle) {
          console.log(`   ❌ MISMATCH: Expected "${expectedTitle}" but got "${actualTitle}"`)
        } else if (!actualTitle || actualTitle === '') {
          console.log(`   ⚠️  Track title is missing or empty`)
          console.log(`   Expected: "${expectedTitle || 'N/A'}"`)
        } else {
          console.log(`   ✅ Titles match: "${actualTitle}"`)
        }
        
        // 4. Check if title looks like a filename pattern
        if (actualTitle && /^\d{4}-\d{2}-\d{2}_\d{2}h\d{2}m\d{2}$/.test(actualTitle)) {
          console.log(`   ⚠️  Track title appears to be a timestamp pattern (likely from filename)`)
        }
        
      } catch (error: any) {
        console.error(`   ❌ Failed to fetch track from LibreTime: ${error.message}`)
        if (error.response) {
          console.error(`   Status: ${error.response.status}`)
          console.error(`   Data: ${JSON.stringify(error.response.data, null, 2)}`)
        }
      }
    } else {
      console.log(`\n⚠️  Episode has no LibreTime Track ID`)
    }
    
  } catch (error: any) {
    console.error(`❌ Failed to fetch episode from Payload: ${error.message}`)
    if (error.response) {
      console.error(`   Status: ${error.response.status}`)
      console.error(`   Data: ${JSON.stringify(error.response.data, null, 2)}`)
    }
  }
}

investigate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })




