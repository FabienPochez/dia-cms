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

async function findTrack() {
  const searchTerm = '2025-10-28_17h52m48'
  
  console.log(`🔍 Searching LibreTime for track: "${searchTerm}"`)
  
  try {
    const response = await axios.get(`${LIBRETIME_API_URL}/api/v2/files?search=${encodeURIComponent(searchTerm)}`, {
      headers: {
        'Authorization': `Api-Key ${LIBRETIME_API_KEY}`,
      },
      timeout: 10000,
    })
    
    const files = response.data
    console.log(`📋 Found ${files.length} files matching search`)
    
    for (const file of files) {
      console.log(`\n📁 File:`)
      console.log(`   ID: ${file.id}`)
      console.log(`   Name: ${file.name || 'N/A'}`)
      console.log(`   Filepath: ${file.filepath || 'N/A'}`)
      console.log(`   Track Title: ${file.track_title || 'N/A'}`)
      
      // Extract episode ID from filename
      const filepath = file.filepath || file.name || ''
      const filename = filepath.split('/').pop() || ''
      const episodeIdMatch = filename.match(/^([a-f0-9]{24})__/)
      
      if (episodeIdMatch) {
        const episodeId = episodeIdMatch[1]
        console.log(`   Episode ID: ${episodeId}`)
        
        // Fetch episode from Payload
        try {
          const episodeResponse = await axios.get(`${PAYLOAD_API_URL}/api/episodes/${episodeId}?depth=2`, {
            headers: buildPayloadAuthHeaders(),
            timeout: 10000,
          })
          
          const episode = episodeResponse.data
          console.log(`\n📺 Payload Episode:`)
          console.log(`   ID: ${episode.id}`)
          console.log(`   Title: ${episode.title || '(null/empty)'}`)
          console.log(`   Show: ${typeof episode.show === 'object' ? episode.show?.title : episode.show || 'N/A'}`)
          console.log(`   Published Status: ${episode.publishedStatus || 'N/A'}`)
          console.log(`   Pending Review: ${episode.pendingReview || false}`)
          console.log(`   Air Status: ${episode.airStatus || 'N/A'}`)
          console.log(`   LibreTime Track ID: ${episode.libretimeTrackId || 'N/A'}`)
          console.log(`   LibreTime Filepath: ${episode.libretimeFilepathRelative || 'N/A'}`)
        } catch (error: any) {
          console.error(`   ❌ Failed to fetch episode from Payload: ${error.message}`)
        }
      } else {
        console.log(`   ⚠️  Could not extract episode ID from filename`)
      }
    }
  } catch (error: any) {
    console.error(`❌ Error searching LibreTime: ${error.message}`)
    if (error.response) {
      console.error(`   Status: ${error.response.status}`)
      console.error(`   Data: ${JSON.stringify(error.response.data, null, 2)}`)
    }
  }
}

findTrack()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })




