import 'dotenv/config'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

/**
 * Sync indexes by dropping conflicting ones and creating new ones
 */
async function syncIndexes() {
  console.log('🔧 Syncing indexes for episodes collection...\n')

  let payload
  try {
    // Initialize Payload
    payload = await getPayload({ config: configPromise })
    console.log('✓ Connected to Payload\n')

    // Access the MongoDB collection via Mongoose
    const db = payload.db
    if (!db.connection || !db.connection.db) {
      throw new Error('MongoDB connection not available')
    }

    const collection = db.connection.db.collection('episodes')

    console.log('📋 Current indexes:')
    const existingIndexes = await collection.indexes()
    existingIndexes.forEach((idx) => {
      console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)}`)
    })
    console.log('')

    // Drop the conflicting slug index if it exists
    try {
      console.log('🗑️  Dropping conflicting slug_1 index...')
      await collection.dropIndex('slug_1')
      console.log('✓ Dropped slug_1 index\n')
    } catch (error) {
      if (error.code === 27) {
        console.log('⚠️  slug_1 index does not exist, skipping\n')
      } else {
        throw error
      }
    }

    // Create the scheduling indexes
    console.log('📝 Creating scheduling indexes...\n')

    // Single-field index on scheduledAt
    console.log('   Creating scheduledAt index...')
    await collection.createIndex({ scheduledAt: 1 }, { background: true })
    console.log('   ✓ scheduledAt index created')

    // Single-field index on scheduledEnd
    console.log('   Creating scheduledEnd index...')
    await collection.createIndex({ scheduledEnd: 1 }, { background: true })
    console.log('   ✓ scheduledEnd index created')

    // Compound index
    console.log('   Creating compound (scheduledAt + scheduledEnd) index...')
    await collection.createIndex(
      { scheduledAt: 1, scheduledEnd: 1 },
      { name: 'idx_schedStart_end', background: true },
    )
    console.log('   ✓ Compound index created')

    // Recreate the slug index with correct properties
    console.log('   Recreating slug index with correct properties...')
    await collection.createIndex({ slug: 1 }, { unique: true, sparse: true, background: true })
    console.log('   ✓ slug index recreated')

    console.log('\n✅ All indexes synced successfully!\n')

    // Show final indexes
    console.log('📋 Final indexes:')
    const finalIndexes = await collection.indexes()
    finalIndexes.forEach((idx, i) => {
      console.log(`${i + 1}. ${idx.name || 'unnamed'}`)
      console.log(`   Keys: ${JSON.stringify(idx.key)}`)
      if (idx.unique) console.log(`   Unique: true`)
      if (idx.sparse) console.log(`   Sparse: true`)
      if (idx.background) console.log(`   Background: true`)
      console.log('')
    })
  } catch (error) {
    console.error('❌ Error syncing indexes:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  } finally {
    if (payload) {
      // Close the connection
      await payload.db.connection.close()
      console.log('✓ Connection closed')
    }
  }

  process.exit(0)
}

syncIndexes().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})
