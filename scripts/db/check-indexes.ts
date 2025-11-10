import 'dotenv/config'
import { getPayload } from 'payload'
import configPromise from '@payload-config'

/**
 * Check and display indexes for the episodes collection
 */
async function checkIndexes() {
  console.log('🔍 Checking indexes for episodes collection...\n')

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

    // Get all indexes
    const indexes = await collection.indexes()

    console.log(`Found ${indexes.length} indexes:\n`)

    // Display indexes in a formatted way
    indexes.forEach((idx, i) => {
      console.log(`${i + 1}. ${idx.name || 'unnamed'}`)
      console.log(`   Keys: ${JSON.stringify(idx.key)}`)
      if (idx.unique) console.log(`   Unique: true`)
      if (idx.sparse) console.log(`   Sparse: true`)
      if (idx.background) console.log(`   Background: true`)
      console.log('')
    })

    // Check specifically for our scheduling indexes
    const schedStartIdx = indexes.find(
      (idx) => idx.key.scheduledAt === 1 && Object.keys(idx.key).length === 1,
    )
    const schedEndIdx = indexes.find(
      (idx) => idx.key.scheduledEnd === 1 && Object.keys(idx.key).length === 1,
    )
    const compoundIdx = indexes.find(
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
    console.error('❌ Error checking indexes:', error.message)
    process.exit(1)
  } finally {
    if (payload) {
      // Close the connection
      await payload.db.connection.close()
      console.log('\n✓ Connection closed')
    }
  }

  process.exit(0)
}

checkIndexes().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})
