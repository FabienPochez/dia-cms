/**
 * Smoke Test Search Indexes
 *
 * Tests representative queries with explain() to verify index usage
 * Based on planning doc section 7.1 & 7.2
 *
 * Usage: node scripts/db/smoke-test-search-indexes.js
 */

import 'dotenv/config'
import { MongoClient } from 'mongodb'

async function smokeTest() {
  console.log('🧪 Running smoke tests for search indexes...\n')

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
    const episodes = db.collection('episodes')
    const shows = db.collection('shows')
    const hosts = db.collection('hosts')

    const results = {
      passed: [],
      failed: [],
    }

    // Helper function to find IXSCAN stage recursively
    function findIndexScan(stage) {
      if (!stage) return null
      if (stage.stage === 'IXSCAN') return stage
      if (stage.inputStage) return findIndexScan(stage.inputStage)
      if (stage.inputStages) {
        for (const input of stage.inputStages) {
          const found = findIndexScan(input)
          if (found) return found
        }
      }
      return null
    }

    // Test 1: Episode by Show (should use show_1 index - already existed)
    console.log('📝 Test 1: Episode Join by Show ID')
    console.log('   Query: db.episodes.find({ show: ObjectId("...") })')
    try {
      // Get first episode's show ID
      const sampleEpisode = await episodes.findOne({ show: { $exists: true, $ne: null } })
      if (sampleEpisode && sampleEpisode.show) {
        const explain = await episodes.find({ show: sampleEpisode.show }).explain('executionStats')
        const execStages = explain.executionStats?.executionStages
        const ixscan = findIndexScan(execStages)
        const execTime = explain.executionStats?.executionTimeMillis
        const docsReturned = explain.executionStats?.nReturned

        console.log(`   Top stage: ${execStages?.stage}`)
        if (ixscan) {
          console.log(`   Index stage: IXSCAN`)
          console.log(`   Index name: ${ixscan.indexName}`)
        } else {
          console.log(`   Index stage: none (COLLSCAN)`)
        }
        console.log(`   Execution time: ${execTime}ms`)
        console.log(`   Documents returned: ${docsReturned}`)

        if (ixscan && ixscan.indexName === 'show_1') {
          console.log('   ✅ PASS - Using show_1 index\n')
          results.passed.push('Episode join by show')
        } else {
          console.log('   ❌ FAIL - Not using expected index\n')
          results.failed.push('Episode join by show')
        }
      } else {
        console.log('   ⚠️  SKIP - No episodes with show reference found\n')
      }
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}\n`)
      results.failed.push('Episode join by show')
    }

    // Test 2: Episode by Genre (should use new genres_1 multikey index)
    console.log('📝 Test 2: Episode Filter by Genre (Multikey)')
    console.log('   Query: db.episodes.find({ genres: { $exists: true, $ne: [] } })')
    try {
      const explain = await episodes
        .find({ genres: { $exists: true, $ne: [] } })
        .limit(10)
        .explain('executionStats')
      const execStages = explain.executionStats?.executionStages
      const ixscan = findIndexScan(execStages)
      const execTime = explain.executionStats?.executionTimeMillis
      const docsReturned = explain.executionStats?.nReturned

      console.log(`   Top stage: ${execStages?.stage}`)
      if (ixscan) {
        console.log(`   Index stage: IXSCAN`)
        console.log(`   Index name: ${ixscan.indexName}`)
        console.log(`   Multikey: ${ixscan.isMultiKey || false}`)
      } else {
        console.log(`   Index stage: none (COLLSCAN)`)
      }
      console.log(`   Execution time: ${execTime}ms`)
      console.log(`   Documents returned: ${docsReturned}`)

      if (ixscan && ixscan.indexName === 'genres_1') {
        console.log('   ✅ PASS - Using genres_1 multikey index\n')
        results.passed.push('Episode genre filter')
      } else if (ixscan) {
        console.log(`   ⚠️  PARTIAL - Using index ${ixscan.indexName} (not genres_1)\n`)
        results.passed.push('Episode genre filter (partial)')
      } else {
        console.log('   ❌ FAIL - Not using index (COLLSCAN)\n')
        results.failed.push('Episode genre filter')
      }
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}\n`)
      results.failed.push('Episode genre filter')
    }

    // Test 3: Show by Title (should use new compound index prefix)
    console.log('📝 Test 3: Show Search by Title (Starts-with)')
    console.log('   Query: db.shows.find({ title: /^[A-Z]/i }).limit(10)')
    try {
      const explain = await shows
        .find({ title: /^[A-Z]/i })
        .limit(10)
        .explain('executionStats')
      const execStages = explain.executionStats?.executionStages
      const ixscan = findIndexScan(execStages)
      const execTime = explain.executionStats?.executionTimeMillis
      const docsReturned = explain.executionStats?.nReturned

      console.log(`   Top stage: ${execStages?.stage}`)
      if (ixscan) {
        console.log(`   Index stage: IXSCAN`)
        console.log(`   Index name: ${ixscan.indexName}`)
      } else {
        console.log(`   Index stage: none (COLLSCAN)`)
      }
      console.log(`   Execution time: ${execTime}ms`)
      console.log(`   Documents returned: ${docsReturned}`)

      if (ixscan && ixscan.indexName === 'title_1_subtitle_1_description_1') {
        console.log('   ✅ PASS - Using compound index\n')
        results.passed.push('Show title search')
      } else if (ixscan) {
        console.log(`   ⚠️  PARTIAL - Using index ${ixscan.indexName}\n`)
        results.passed.push('Show title search (partial)')
      } else {
        console.log('   ❌ FAIL - Not using index (COLLSCAN)\n')
        results.failed.push('Show title search')
      }
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}\n`)
      results.failed.push('Show title search')
    }

    // Test 4: Host by Name (should use new name_1 index)
    console.log('📝 Test 4: Host Search by Name (Starts-with)')
    console.log('   Query: db.hosts.find({ name: /^[A-Z]/i }).limit(10)')
    try {
      const explain = await hosts
        .find({ name: /^[A-Z]/i })
        .limit(10)
        .explain('executionStats')
      const execStages = explain.executionStats?.executionStages
      const ixscan = findIndexScan(execStages)
      const execTime = explain.executionStats?.executionTimeMillis
      const docsReturned = explain.executionStats?.nReturned

      console.log(`   Top stage: ${execStages?.stage}`)
      if (ixscan) {
        console.log(`   Index stage: IXSCAN`)
        console.log(`   Index name: ${ixscan.indexName}`)
      } else {
        console.log(`   Index stage: none (COLLSCAN)`)
      }
      console.log(`   Execution time: ${execTime}ms`)
      console.log(`   Documents returned: ${docsReturned}`)

      if (ixscan && ixscan.indexName === 'name_1') {
        console.log('   ✅ PASS - Using name_1 index\n')
        results.passed.push('Host name search')
      } else if (ixscan) {
        console.log(`   ⚠️  PARTIAL - Using index ${ixscan.indexName}\n`)
        results.passed.push('Host name search (partial)')
      } else {
        console.log('   ❌ FAIL - Not using index (COLLSCAN)\n')
        results.failed.push('Host name search')
      }
    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}\n`)
      results.failed.push('Host name search')
    }

    // Summary
    console.log('\n' + '='.repeat(50))
    console.log('📊 Smoke Test Summary:')
    console.log('='.repeat(50))
    console.log(`✅ Passed: ${results.passed.length}`)
    if (results.passed.length > 0) {
      results.passed.forEach((test) => console.log(`   ✅ ${test}`))
    }
    console.log(`❌ Failed: ${results.failed.length}`)
    if (results.failed.length > 0) {
      results.failed.forEach((test) => console.log(`   ❌ ${test}`))
    }

    const totalTests = results.passed.length + results.failed.length
    const passRate = totalTests > 0 ? Math.round((results.passed.length / totalTests) * 100) : 0

    console.log(`\n📈 Pass Rate: ${passRate}% (${results.passed.length}/${totalTests})`)

    if (results.failed.length === 0) {
      console.log('\n🎉 All smoke tests passed! Indexes are working correctly.')
    } else {
      console.log('\n⚠️  Some tests failed. Review index usage with explain() for failed queries.')
    }
  } catch (error) {
    console.error('❌ Error running smoke tests:', error.message)
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

smokeTest().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})
