import 'dotenv/config'
// GLOBAL SUBPROCESS DIAGNOSTIC PATCH - MUST BE FIRST
import '../src/server/lib/subprocessGlobalDiag'
import path from 'path'
import { diagExecFile } from '../src/server/lib/subprocessDiag'
import { getPayload } from 'payload'
import config from '../src/payload.config'




/**
 * Extract audio metadata using ffprobe
 */
async function getAudioMetadata(filePath: string): Promise<{ durationSec: number }> {
  try {
    const execArgs = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]
    
    const { stdout } = await diagExecFile('ffprobe', execArgs, undefined, 'update-episode-duration.ffprobe')
    const data = JSON.parse(stdout)

    const durationSec = Math.round(parseFloat(data.format?.duration || '0'))
    return { durationSec }
  } catch (error) {
    console.error('[DURATION_EXTRACT] ffprobe failed:', error)
    throw new Error(
      `Failed to extract audio metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Calculate rounded duration using the same logic as import-sc-durations.ts
 */
function calculateRoundedDuration(seconds: number): number {
  const minutes = seconds / 60

  // Hard-coded rounding rules
  if (minutes >= 55 && minutes <= 65) return 60
  if (minutes >= 85 && minutes <= 95) return 90
  if (minutes >= 115 && minutes <= 125) return 120

  // Default: round to nearest 5 minutes
  return Math.round(minutes / 5) * 5
}

/**
 * Get media file path from episode using Payload internal API
 */
async function getMediaFilePath(payload: any, mediaId: string): Promise<string | null> {
  try {
    const media = await payload.findByID({
      collection: 'media-tracks',
      id: mediaId,
    })

    if (!media || !media.filename) {
      return null
    }

    // Media files are stored in /srv/media/new/
    const filePath = path.join('/srv/media/new', media.filename)
    return filePath
  } catch (error: any) {
    console.error(`[DURATION_EXTRACT] Failed to get media file: ${error.message}`)
    return null
  }
}

/**
 * Update episode with duration using Payload internal API
 */
async function updateEpisodeDuration(
  payload: any,
  episodeId: string,
  realDuration: number,
  roundedDuration: number,
): Promise<void> {
  console.log(`📝 Updating episode ${episodeId} with realDuration=${realDuration}s, roundedDuration=${roundedDuration}min`)

  try {
    await payload.update({
      collection: 'episodes',
      id: episodeId,
      data: {
        realDuration,
        roundedDuration,
      },
    })

    console.log(`✅ Episode updated successfully`)
  } catch (error: any) {
    throw new Error(`Failed to update Payload episode: ${error.message}`)
  }
}

/**
 * Main function
 */
async function updateEpisodeDurationForId(episodeId: string): Promise<void> {
  console.log(`🎧 Updating Duration for Episode: ${episodeId}`)
  console.log('=====================================')

  // Initialize Payload
  const payload = await getPayload({ config })

  try {
    // Step 1: Fetch episode
    console.log(`📡 Fetching episode from Payload...`)
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
    })

    console.log(`✅ Found episode: ${episode.title || episodeId}`)

    if (!episode.media) {
      throw new Error('Episode has no media file')
    }

    // Step 2: Get media file path
    console.log(`📁 Getting media file path...`)
    const mediaId = typeof episode.media === 'string' ? episode.media : episode.media.id
    const filePath = await getMediaFilePath(payload, mediaId)

    if (!filePath) {
      throw new Error('Media file not found')
    }

    console.log(`✅ Found media file: ${filePath}`)

    // Step 3: Extract duration from audio file
    console.log(`🎵 Extracting duration from audio file...`)
    const { durationSec } = await getAudioMetadata(filePath)
    console.log(`✅ Extracted duration: ${durationSec}s (${Math.round(durationSec / 60)}min)`)

    // Step 4: Calculate rounded duration
    const roundedDuration = calculateRoundedDuration(durationSec)
    console.log(`✅ Calculated rounded duration: ${roundedDuration}min`)

    // Step 5: Update episode
    await updateEpisodeDuration(payload, episodeId, durationSec, roundedDuration)

    console.log('\n🎉 Duration update completed successfully!')
    console.log(`   Episode ID: ${episodeId}`)
    console.log(`   realDuration: ${durationSec}s (${Math.round(durationSec / 60)}min)`)
    console.log(`   roundedDuration: ${roundedDuration}min`)
  } catch (error: any) {
    console.error('\n❌ Duration update failed:', error.message)
    process.exit(1)
  }
}

// Run the script if executed directly
const episodeId = process.argv[2]
if (!episodeId) {
  console.error('Usage: npx tsx scripts/update-episode-duration.ts <episodeId>')
  process.exit(1)
}

updateEpisodeDurationForId(episodeId)
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })

export { updateEpisodeDurationForId }

