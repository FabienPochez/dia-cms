import { getPayload } from 'payload'
import configPromise from '@payload-config'

async function resetMoodField() {
  console.log('Starting mood field reset...')

  const payload = await getPayload({ config: configPromise })

  try {
    // First, let's see how many episodes have mood values
    const episodesWithMood = await payload.find({
      collection: 'episodes',
      where: { mood: { exists: true } },
      limit: 0, // Just get count
    })

    console.log(`Found ${episodesWithMood.totalDocs} episodes with mood values`)

    if (episodesWithMood.totalDocs === 0) {
      console.log('No episodes with mood values found. Nothing to reset.')
      return
    }

    // Reset all mood fields to empty string
    const result = await payload.update({
      collection: 'episodes',
      where: { mood: { exists: true } },
      data: { mood: '' },
    })

    console.log(`Successfully reset mood field for ${result.docs.length} episodes`)

    // Verify the reset
    const remainingEpisodes = await payload.find({
      collection: 'episodes',
      where: { mood: { exists: true } },
      limit: 0,
    })

    console.log(`Verification: ${remainingEpisodes.totalDocs} episodes still have mood values`)
  } catch (error) {
    console.error('Error resetting mood field:', error)
    throw error
  }

  console.log('Mood field reset completed!')
  process.exit(0)
}

resetMoodField().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})
