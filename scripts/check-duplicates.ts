import 'dotenv/config'
import axios from 'axios'

const LIBRETIME_API_KEY = process.env.LIBRETIME_API_KEY
const LIBRETIME_API_URL = process.env.LIBRETIME_API_URL || 'http://nginx:8080'

async function checkDuplicates() {
  console.log('🔍 Checking for duplicate files in LibreTime...\n')
  
  // Check for the specific episodes mentioned
  const episodesToCheck = [
    { id: '6943bf9b4a3a130aafe0b6bc', name: 'Karpatxoa Katedrala' },
    { id: '68fb64f7ae3456e6cc4a322e', name: 'Gros Volume Sur La Molle w/ Chach' },
  ]
  
  for (const episode of episodesToCheck) {
    console.log(`\n📁 Checking episode: ${episode.name} (${episode.id})`)
    
    try {
      const response = await axios.get(`${LIBRETIME_API_URL}/api/v2/files?search=${episode.id}__`, {
        headers: {
          'Authorization': `Api-Key ${LIBRETIME_API_KEY}`,
        },
        timeout: 10000,
      })
      
      const files = response.data
      
      // Filter to only include files that actually match the prefix
      const matchingFiles = files.filter((file: any) => {
        const filepath = file.filepath || file.name || ''
        const filename = filepath.split('/').pop() || ''
        return filename.startsWith(`${episode.id}__`)
      })
      
      console.log(`   Found ${matchingFiles.length} file(s) with prefix ${episode.id}__`)
      
      if (matchingFiles.length > 1) {
        console.log(`   ❌ DUPLICATE DETECTED!`)
        matchingFiles.forEach((file: any, index: number) => {
          console.log(`   ${index + 1}. ID: ${file.id}`)
          console.log(`      Filepath: ${file.filepath || file.name || 'N/A'}`)
          console.log(`      Track Title: ${file.track_title || 'N/A'}`)
          console.log(`      Creator: ${file.creator || 'N/A'}`)
        })
      } else if (matchingFiles.length === 1) {
        const file = matchingFiles[0]
        console.log(`   ✅ Single file found:`)
        console.log(`      ID: ${file.id}`)
        console.log(`      Filepath: ${file.filepath || file.name || 'N/A'}`)
        console.log(`      Track Title: ${file.track_title || 'N/A'}`)
      } else {
        console.log(`   ⚠️  No files found`)
      }
    } catch (error: any) {
      console.error(`   ❌ Error checking episode: ${error.message}`)
    }
  }
}

checkDuplicates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })




