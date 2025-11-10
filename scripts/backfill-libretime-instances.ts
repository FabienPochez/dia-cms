#!/usr/bin/env node

/**
 * Backfill script for LibreTime Instance Mapping (Step 3B)
 *
 * Sets libretimeInstanceId for all existing shows that don't have it set.
 * Uses LIBRETIME_INSTANCE_DEFAULT env var or defaults to "main".
 *
 * Usage:
 *   npx tsx scripts/backfill-libretime-instances.ts
 *   LIBRETIME_INSTANCE_DEFAULT=main npx tsx scripts/backfill-libretime-instances.ts
 */

import 'dotenv/config'
import payload from 'payload'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const configPath = path.resolve(__dirname, '../src/payload.config.ts')

async function backfillLibreTimeInstances() {
  console.log('🔄 Starting LibreTime instance backfill...')

  const defaultInstance = process.env.LIBRETIME_INSTANCE_DEFAULT || 'main'
  console.log(`📋 Using default instance: ${defaultInstance}`)

  try {
    // Initialize Payload
    const config = (await import(configPath)).default

    await payload.init({
      secret: process.env.PAYLOAD_SECRET,
      local: true,
      config,
    })

    // Find all shows without libretimeInstanceId
    const showsWithoutInstance = await payload.find({
      collection: 'shows',
      where: {
        libretimeInstanceId: {
          exists: false,
        },
      },
      limit: 1000, // Adjust if you have more shows
    })

    console.log(`📊 Found ${showsWithoutInstance.docs.length} shows without instance mapping`)

    if (showsWithoutInstance.docs.length === 0) {
      console.log('✅ All shows already have instance mapping')
      return
    }

    // Update each show
    let updated = 0
    let errors = 0

    for (const show of showsWithoutInstance.docs) {
      try {
        await payload.update({
          collection: 'shows',
          id: show.id,
          data: {
            libretimeInstanceId: defaultInstance,
          },
        })

        console.log(`✅ Updated show "${show.title}" (${show.id})`)
        updated++
      } catch (error) {
        console.error(`❌ Failed to update show "${show.title}" (${show.id}):`, error.message)
        errors++
      }
    }

    console.log(`\n📈 Backfill complete:`)
    console.log(`   ✅ Updated: ${updated}`)
    console.log(`   ❌ Errors: ${errors}`)
    console.log(`   📋 Default instance: ${defaultInstance}`)
  } catch (error) {
    console.error('💥 Backfill failed:', error)
    process.exit(1)
  }

  process.exit(0)
}

// Run the backfill
backfillLibreTimeInstances()
