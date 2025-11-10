import 'dotenv/config'
import { MongoClient } from 'mongodb'

/**
 * Sync indexes by connecting directly to MongoDB
 */
async function syncIndexes() {
  console.log('🔧 Syncing indexes for episodes collection (direct connection)...\n')

  const url = process.env.DATABASE_URI
  if (!url) {
    console.error('❌ DATABASE_URI environment variable is required')
    process.exit(1)
  }

  const client = new MongoClient(url)

  try {
    // Connect to MongoDB
    await client.connect()
    console.log('✓ Connected to MongoDB\n')

    const db = client.db()
    const collection = db.collection('episodes')

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
        console.log(`⚠️  Could not drop slug_1: ${error.message}\n`)
      }
    }

    // Create the scheduling indexes
    console.log('📝 Creating scheduling indexes...\n')

    // Single-field index on scheduledAt
    console.log('   Creating scheduledAt index...')
    try {
      await collection.createIndex({ scheduledAt: 1 }, { background: true })
      console.log('   ✓ scheduledAt index created')
    } catch (error) {
      console.log(`   ⚠️  ${error.message}`)
    }

    // Single-field index on scheduledEnd
    console.log('   Creating scheduledEnd index...')
    try {
      await collection.createIndex({ scheduledEnd: 1 }, { background: true })
      console.log('   ✓ scheduledEnd index created')
    } catch (error) {
      console.log(`   ⚠️  ${error.message}`)
    }

    // Compound index
    console.log('   Creating compound (scheduledAt + scheduledEnd) index...')
    try {
      await collection.createIndex(
        { scheduledAt: 1, scheduledEnd: 1 },
        { name: 'idx_schedStart_end', background: true },
      )
      console.log('   ✓ Compound index created')
    } catch (error) {
      console.log(`   ⚠️  ${error.message}`)
    }

    // Recreate the slug index with correct properties
    console.log('   Recreating slug index with correct properties...')
    try {
      await collection.createIndex({ slug: 1 }, { unique: true, sparse: true, background: true })
      console.log('   ✓ slug index recreated')
    } catch (error) {
      console.log(`   ⚠️  ${error.message}`)
    }

    console.log('\n✅ Index sync completed!\n')

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

    // Check specifically for our scheduling indexes
    const schedStartIdx = finalIndexes.find(
      (idx) => idx.key.scheduledAt === 1 && Object.keys(idx.key).length === 1,
    )
    const schedEndIdx = finalIndexes.find(
      (idx) => idx.key.scheduledEnd === 1 && Object.keys(idx.key).length === 1,
    )
    const compoundIdx = finalIndexes.find(
      (idx) => idx.key.scheduledAt === 1 && idx.key.scheduledEnd === 1,
    )

    console.log('📊 Scheduling Indexes Status:')
    console.log(`   scheduledAt index: ${schedStartIdx ? '✓ EXISTS' : '✗ MISSING'}`)
    console.log(`   scheduledEnd index: ${schedEndIdx ? '✓ EXISTS' : '✗ MISSING'}`)
    console.log(
      `   Compound (scheduledAt + scheduledEnd): ${compoundIdx ? '✓ EXISTS' : '✗ MISSING'}`,
    )

    if (compoundIdx) {
      console.log(`   Compound index name: ${compoundIdx.name}`)
    }
  } catch (error) {
    console.error('❌ Error syncing indexes:', error.message)
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

syncIndexes().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})
