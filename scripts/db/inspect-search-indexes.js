/**
 * Inspect Current Indexes for Search MVP Planning
 *
 * Audits existing indexes on shows, episodes, and hosts collections
 * and outputs JSON snapshot for documentation.
 *
 * Usage: node scripts/db/inspect-search-indexes.js
 */

import 'dotenv/config'
import { MongoClient } from 'mongodb'

async function inspectIndexes() {
  console.log('🔍 Inspecting indexes for search MVP planning...\n')

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
    const collections = ['shows', 'episodes', 'hosts']
    const report = {
      timestamp: new Date().toISOString(),
      database: db.databaseName,
      collections: {},
    }

    for (const collectionName of collections) {
      console.log(`\n📋 Collection: ${collectionName}`)
      console.log('='.repeat(50))

      const collection = db.collection(collectionName)

      // Get all indexes
      const indexes = await collection.indexes()

      console.log(`Found ${indexes.length} indexes:\n`)

      // Display indexes in formatted way
      indexes.forEach((idx, i) => {
        console.log(`${i + 1}. ${idx.name}`)
        console.log(`   Keys: ${JSON.stringify(idx.key)}`)
        if (idx.unique) console.log(`   Unique: true`)
        if (idx.sparse) console.log(`   Sparse: true`)
        if (idx.background) console.log(`   Background: true`)
        if (idx.textIndexVersion) console.log(`   Text Index Version: ${idx.textIndexVersion}`)
        if (idx.default_language) console.log(`   Language: ${idx.default_language}`)
        if (idx.weights) console.log(`   Weights: ${JSON.stringify(idx.weights)}`)
        console.log('')
      })

      // Store in report
      report.collections[collectionName] = {
        count: indexes.length,
        indexes: indexes.map((idx) => ({
          name: idx.name,
          keys: idx.key,
          unique: idx.unique || false,
          sparse: idx.sparse || false,
          background: idx.background || false,
          textIndex: !!idx.textIndexVersion,
          weights: idx.weights || null,
        })),
      }

      // Check for specific fields we care about
      const relevantFields = {
        shows: ['title', 'subtitle', 'description'],
        episodes: ['show', 'genres'],
        hosts: ['name'],
      }

      const fieldsToCheck = relevantFields[collectionName] || []
      console.log(`📊 Relevant Fields Check:`)

      for (const field of fieldsToCheck) {
        const hasIndex = indexes.some(
          (idx) =>
            idx.key[field] !== undefined ||
            (idx.key._fts === 'text' && idx.weights && idx.weights[field]),
        )
        console.log(`   ${field}: ${hasIndex ? '✅ Indexed' : '❌ Not indexed'}`)
      }
    }

    // Output JSON snapshot
    console.log('\n\n📄 JSON Snapshot:')
    console.log('='.repeat(50))
    console.log(JSON.stringify(report, null, 2))

    // Summary
    console.log('\n\n📊 Summary:')
    console.log('='.repeat(50))
    for (const [collName, data] of Object.entries(report.collections)) {
      console.log(`${collName}: ${data.count} indexes`)
      const hasTextIndex = data.indexes.some((idx) => idx.textIndex)
      console.log(`   Text indexes: ${hasTextIndex ? '✅ Yes' : '❌ No'}`)
    }

    console.log('\n✅ Inspection complete!')
  } catch (error) {
    console.error('❌ Error inspecting indexes:', error.message)
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

inspectIndexes().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})
