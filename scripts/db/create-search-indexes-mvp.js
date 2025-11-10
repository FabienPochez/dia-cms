/**
 * Create Search Indexes for MVP
 *
 * Adds minimal indexes to support mixed search MVP:
 * - episodes: genres (multikey for array filtering)
 * - shows: title + subtitle + description (compound for text search)
 * - hosts: name (single-field for name search)
 *
 * Note: episodes.show_1 already exists, so we skip it.
 *
 * Usage:
 *   node scripts/db/create-search-indexes-mvp.js          # Execute
 *   node scripts/db/create-search-indexes-mvp.js --dry-run # Simulate
 */

import 'dotenv/config'
import { MongoClient } from 'mongodb'

// Parse command-line args
const isDryRun = process.argv.includes('--dry-run')

const indexesToCreate = [
  {
    collection: 'episodes',
    index: { genres: 1 },
    options: { name: 'genres_1', background: true },
    description: 'Multikey index for genre filtering (array field)',
  },
  {
    collection: 'shows',
    index: { title: 1, subtitle: 1, description: 1 },
    options: { name: 'title_1_subtitle_1_description_1', background: true },
    description: 'Compound index for text search (starts-with/contains)',
  },
  {
    collection: 'hosts',
    index: { name: 1 },
    options: { name: 'name_1', background: true },
    description: 'Single-field index for host name search',
  },
]

async function createSearchIndexes() {
  console.log(`🔧 ${isDryRun ? '[DRY RUN]' : ''} Creating search indexes for MVP...\n`)

  const url = process.env.DATABASE_URI
  if (!url) {
    console.error('❌ DATABASE_URI environment variable is required')
    process.exit(1)
  }

  const client = new MongoClient(url)

  try {
    await client.connect()
    console.log('✓ Connected to MongoDB\n')

    const db = client.db()
    const results = {
      created: [],
      skipped: [],
      errors: [],
    }

    for (const spec of indexesToCreate) {
      console.log(`📝 Processing: ${spec.collection}.${spec.options.name}`)
      console.log(`   Description: ${spec.description}`)
      console.log(`   Keys: ${JSON.stringify(spec.index)}`)

      const collection = db.collection(spec.collection)

      // Check if index already exists
      const existingIndexes = await collection.indexes()
      const indexExists = existingIndexes.some((idx) => idx.name === spec.options.name)

      if (indexExists) {
        console.log(`   ⚠️  Index already exists, skipping\n`)
        results.skipped.push(spec.options.name)
        continue
      }

      if (isDryRun) {
        console.log(`   ✓ [DRY RUN] Would create index\n`)
        results.created.push(`[DRY RUN] ${spec.options.name}`)
      } else {
        try {
          await collection.createIndex(spec.index, spec.options)
          console.log(`   ✅ Index created successfully\n`)
          results.created.push(spec.options.name)
        } catch (error) {
          console.error(`   ❌ Error creating index: ${error.message}\n`)
          results.errors.push({ name: spec.options.name, error: error.message })
        }
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50))
    console.log('📊 Summary:')
    console.log('='.repeat(50))
    console.log(`Created: ${results.created.length}`)
    if (results.created.length > 0) {
      results.created.forEach((name) => console.log(`   ✅ ${name}`))
    }
    console.log(`Skipped: ${results.skipped.length}`)
    if (results.skipped.length > 0) {
      results.skipped.forEach((name) => console.log(`   ⚠️  ${name}`))
    }
    console.log(`Errors: ${results.errors.length}`)
    if (results.errors.length > 0) {
      results.errors.forEach((err) => console.log(`   ❌ ${err.name}: ${err.error}`))
    }

    // Verify final state
    if (!isDryRun && results.created.length > 0) {
      console.log('\n' + '='.repeat(50))
      console.log('🔍 Verifying created indexes:')
      console.log('='.repeat(50))

      for (const spec of indexesToCreate) {
        if (results.created.includes(spec.options.name)) {
          const collection = db.collection(spec.collection)
          const indexes = await collection.indexes()
          const createdIndex = indexes.find((idx) => idx.name === spec.options.name)

          if (createdIndex) {
            console.log(`✅ ${spec.collection}.${spec.options.name}`)
            console.log(`   Keys: ${JSON.stringify(createdIndex.key)}`)
            if (createdIndex.unique) console.log(`   Unique: true`)
            if (createdIndex.sparse) console.log(`   Sparse: true`)
            if (createdIndex.background) console.log(`   Background: true`)
          } else {
            console.log(`❌ ${spec.collection}.${spec.options.name} - NOT FOUND after creation!`)
          }
        }
      }
    }

    if (isDryRun) {
      console.log('\n💡 Tip: Run without --dry-run flag to execute index creation')
    } else {
      console.log('\n✅ Index creation complete!')
      console.log('   Run: node scripts/db/inspect-search-indexes.js')
      console.log('   To verify all indexes are present.')
    }
  } catch (error) {
    console.error('❌ Error creating indexes:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    await client.close()
    console.log('\n✓ Connection closed')
  }

  process.exit(0)
}

createSearchIndexes().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})


