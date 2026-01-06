import dotenv from 'dotenv'
dotenv.config()

import path from 'path'
import payload from 'payload'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

async function run() {
  // Parse command line arguments
  const args = process.argv.slice(2)
  const isDryRun = !args.includes('--apply')
  const limitArg = args.find((arg) => arg.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined
  const episodeIdArg = args.find((arg) => arg.startsWith('--episode-id='))
  const specificEpisodeId = episodeIdArg ? episodeIdArg.split('=')[1] : undefined

  console.log('🔄 Update Legacy Episodes: firstAiredAt from publishedAt')
  console.log('========================================================')
  console.log(`Mode: ${isDryRun ? '🔍 DRY-RUN (no changes will be made)' : '✅ APPLY (will update database)'}`)
  if (specificEpisodeId) {
    console.log(`Target: Specific episode ${specificEpisodeId}`)
  } else if (limit) {
    console.log(`Limit: ${limit} episodes`)
  }
  console.log()
  console.log('Target criteria:')
  console.log('  - track_id != null (has SoundCloud track ID)')
  console.log('  - isLive == false (or null)')
  console.log('  - publishedStatus != "submitted"')
  console.log()
  console.log('Action: Set firstAiredAt = publishedAt (will OVERWRITE existing values)')
  console.log()

  const config = (await import(configPath)).default
  await payload.init({ secret: process.env.PAYLOAD_SECRET, local: true, config })

  // If targeting a specific episode, handle it separately
  if (specificEpisodeId) {
    await handleSpecificEpisode(specificEpisodeId, isDryRun)
    process.exit(0)
  }

  // Fetch all matching episodes
  console.log('📚 Fetching episodes...')
  let allEpisodes: any[] = []
  let page = 1
  let hasMore = true
  const pageSize = 1000

  while (hasMore) {
    const result = await payload.find({
      collection: 'episodes',
      where: {
        and: [
          {
            track_id: {
              exists: true,
            },
          },
          {
            or: [
              {
                isLive: {
                  equals: false,
                },
              },
              {
                isLive: {
                  exists: false,
                },
              },
            ],
          },
          {
            publishedStatus: {
              not_equals: 'submitted',
            },
          },
        ],
      },
      limit: pageSize,
      page,
    })

    allEpisodes = allEpisodes.concat(result.docs)
    hasMore = result.hasNextPage
    page++

    if (limit && allEpisodes.length >= limit) {
      allEpisodes = allEpisodes.slice(0, limit)
      break
    }
  }

  console.log(`✅ Found ${allEpisodes.length} episodes to process`)
  console.log()

  // Process episodes
  let stats = {
    processed: 0,
    updated: 0,
    skipped: 0, // Episodes where publishedAt is missing or already matches
    failed: 0,
  }

  for (const episode of allEpisodes) {
    try {
      stats.processed++

      // Check if publishedAt exists
      if (!episode.publishedAt) {
        console.log(`⏭️  [${stats.processed}/${allEpisodes.length}] Episode ${episode.id} - Skipped: missing publishedAt`)
        stats.skipped++
        continue
      }

      // Check if firstAiredAt already matches publishedAt
      if (episode.firstAiredAt === episode.publishedAt) {
        console.log(`⏭️  [${stats.processed}/${allEpisodes.length}] Episode ${episode.id} - Skipped: firstAiredAt already matches publishedAt`)
        stats.skipped++
        continue
      }

      const oldValue = episode.firstAiredAt || '(null)'
      const newValue = episode.publishedAt
      const willOverwrite = episode.firstAiredAt !== null && episode.firstAiredAt !== undefined

      if (isDryRun) {
        console.log(`🔍 [${stats.processed}/${allEpisodes.length}] Episode ${episode.id} - Would update:`)
        console.log(`   Title: ${episode.title || '(no title)'}`)
        if (willOverwrite) {
          console.log(`   ⚠️  WARNING: Will OVERWRITE existing firstAiredAt`)
        }
        console.log(`   firstAiredAt: ${oldValue} → ${newValue}`)
        stats.updated++
      } else {
        // Actually update
        await payload.update({
          collection: 'episodes',
          id: episode.id,
          data: {
            firstAiredAt: newValue,
          },
          overrideAccess: true,
          context: {
            skipSlugRegeneration: true, // Preserve existing slug to avoid validation errors
          },
        })
        console.log(`✅ [${stats.processed}/${allEpisodes.length}] Episode ${episode.id} - Updated:`)
        console.log(`   Title: ${episode.title || '(no title)'}`)
        console.log(`   firstAiredAt: ${oldValue} → ${newValue}`)
        stats.updated++
      }
    } catch (error: any) {
      console.error(`❌ [${stats.processed}/${allEpisodes.length}] Episode ${episode.id} - Error: ${error.message}`)
      stats.failed++
    }
  }

  console.log()
  console.log('📊 Summary:')
  console.log(`   - Episodes processed: ${stats.processed}`)
  console.log(`   - Episodes ${isDryRun ? 'would be updated' : 'updated'}: ${stats.updated}`)
  console.log(`   - Episodes skipped: ${stats.skipped}`)
  if (stats.failed > 0) {
    console.log(`   - Episodes failed: ${stats.failed}`)
  }
  console.log()

  if (isDryRun) {
    console.log('💡 To apply changes, run with --apply flag:')
    console.log('   npx tsx scripts/update-legacy-firstAiredAt.ts --apply')
  } else {
    console.log('✅ Update complete!')
  }

  process.exit(stats.failed > 0 ? 1 : 0)
}

async function handleSpecificEpisode(episodeId: string, isDryRun: boolean) {
  try {
    console.log(`🔍 Fetching episode ${episodeId}...`)
    const episode = await payload.findByID({
      collection: 'episodes',
      id: episodeId,
      depth: 0,
    })

    if (!episode) {
      console.error(`❌ Episode ${episodeId} not found`)
      return
    }

    console.log()
    console.log('📋 Episode Details:')
    console.log(`   ID: ${episode.id}`)
    console.log(`   Title: ${episode.title || '(no title)'}`)
    console.log(`   track_id: ${episode.track_id ?? '(null)'}`)
    console.log(`   isLive: ${episode.isLive ?? '(null)'}`)
    console.log(`   publishedStatus: ${episode.publishedStatus}`)
    console.log(`   publishedAt: ${episode.publishedAt ?? '(null)'}`)
    console.log(`   firstAiredAt: ${episode.firstAiredAt ?? '(null)'}`)
    console.log()

    // Check if it matches criteria
    const matchesCriteria =
      episode.track_id != null &&
      (episode.isLive === false || episode.isLive == null) &&
      episode.publishedStatus !== 'submitted'

    if (!matchesCriteria) {
      console.log('❌ Episode does NOT match the target criteria:')
      if (episode.track_id == null) console.log('   - Missing track_id')
      if (episode.isLive === true) console.log('   - isLive is true')
      if (episode.publishedStatus === 'submitted') console.log('   - publishedStatus is "submitted"')
      return
    }

    // Check if publishedAt exists
    if (!episode.publishedAt) {
      console.log('⏭️  Skipped: missing publishedAt')
      return
    }

    // Check if already matches
    if (episode.firstAiredAt === episode.publishedAt) {
      console.log('⏭️  Skipped: firstAiredAt already matches publishedAt')
      return
    }

    const oldValue = episode.firstAiredAt || '(null)'
    const newValue = episode.publishedAt
    const willOverwrite = episode.firstAiredAt !== null && episode.firstAiredAt !== undefined

    console.log('🔄 Expected Change:')
    if (willOverwrite) {
      console.log(`   ⚠️  WARNING: Will OVERWRITE existing firstAiredAt value`)
    }
    console.log(`   firstAiredAt: ${oldValue}`)
    console.log(`                ↓`)
    console.log(`                ${newValue}`)
    console.log()

    if (isDryRun) {
      console.log('🔍 DRY-RUN: No changes made')
      console.log('💡 To apply this change, run with --apply flag:')
      console.log(`   npx tsx scripts/update-legacy-firstAiredAt.ts --episode-id=${episodeId} --apply`)
    } else {
      // Actually update
      await payload.update({
        collection: 'episodes',
        id: episode.id,
        data: {
          firstAiredAt: newValue,
        },
        overrideAccess: true,
        context: {
          skipSlugRegeneration: true, // Preserve existing slug to avoid validation errors
        },
      })
      console.log('✅ Episode updated successfully!')
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`)
    throw error
  }
}

run().catch((err) => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})

