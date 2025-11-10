import 'dotenv/config'
import { libreTimeApi } from '../src/integrations/libretimeApi'

async function testLibreTimeIntegration() {
  console.log('🎧 Testing LibreTime Integration...')

  try {
    // Test connection
    console.log('\n📡 Testing LibreTime connection...')
    const connectionTest = await libreTimeApi.testConnection()

    if (!connectionTest.success) {
      throw new Error(`Connection failed: ${connectionTest.error}`)
    }

    console.log('✅ LibreTime connection successful')

    // Test getting files
    console.log('\n📁 Testing file retrieval...')
    const filesResponse = await libreTimeApi.getFiles({ limit: 3 })

    if (!filesResponse.success) {
      throw new Error(`File retrieval failed: ${filesResponse.error}`)
    }

    console.log(`✅ Retrieved ${filesResponse.data?.length || 0} files`)

    if (filesResponse.data && filesResponse.data.length > 0) {
      const file = filesResponse.data[0]
      console.log(`   Sample file: ${file.track_title || file.name || 'Untitled'} (ID: ${file.id})`)
    }

    // Test getting shows
    console.log('\n🎭 Testing show retrieval...')
    const showsResponse = await libreTimeApi.getShows({ limit: 3 })

    if (!showsResponse.success) {
      throw new Error(`Show retrieval failed: ${showsResponse.error}`)
    }

    console.log(`✅ Retrieved ${showsResponse.data?.length || 0} shows`)

    if (showsResponse.data && showsResponse.data.length > 0) {
      const show = showsResponse.data[0]
      console.log(`   Sample show: ${show.name} (ID: ${show.id})`)
    }

    // Test getting instances
    console.log('\n📅 Testing instance retrieval...')
    const instancesResponse = await libreTimeApi.getInstances({ limit: 3 })

    if (!instancesResponse.success) {
      throw new Error(`Instance retrieval failed: ${instancesResponse.error}`)
    }

    console.log(`✅ Retrieved ${instancesResponse.data?.length || 0} instances`)

    if (instancesResponse.data && instancesResponse.data.length > 0) {
      const instance = instancesResponse.data[0]
      console.log(
        `   Sample instance: ${instance.starts_at} - ${instance.ends_at} (ID: ${instance.id})`,
      )
    }

    // Test getting schedule
    console.log('\n📋 Testing schedule retrieval...')
    const scheduleResponse = await libreTimeApi.getSchedule({ limit: 3 })

    if (!scheduleResponse.success) {
      throw new Error(`Schedule retrieval failed: ${scheduleResponse.error}`)
    }

    console.log(`✅ Retrieved ${scheduleResponse.data?.length || 0} schedule entries`)

    if (scheduleResponse.data && scheduleResponse.data.length > 0) {
      const schedule = scheduleResponse.data[0]
      console.log(
        `   Sample schedule: ${schedule.starts_at} - ${schedule.ends_at} (File: ${schedule.file})`,
      )
    }

    // Test file validation
    if (filesResponse.data && filesResponse.data.length > 0) {
      console.log('\n🔍 Testing file validation...')
      const fileId = filesResponse.data[0].id
      const validationResponse = await libreTimeApi.validateFile(fileId)

      if (!validationResponse.success) {
        throw new Error(`File validation failed: ${validationResponse.error}`)
      }

      console.log(`✅ File validation successful: ${validationResponse.data ? 'Valid' : 'Invalid'}`)
    }

    // Test overlap checking
    console.log('\n⏰ Testing overlap checking...')
    const now = new Date()
    const futureStart = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 24 hours from now
    const futureEnd = new Date(futureStart.getTime() + 2 * 60 * 60 * 1000) // 2 hours duration

    const overlapResponse = await libreTimeApi.checkOverlaps(
      futureStart.toISOString(),
      futureEnd.toISOString(),
    )

    if (!overlapResponse.success) {
      throw new Error(`Overlap check failed: ${overlapResponse.error}`)
    }

    console.log(`✅ Overlap check successful: ${overlapResponse.data?.length || 0} conflicts found`)

    console.log('\n🎉 All LibreTime integration tests passed!')
    console.log('\n📝 Integration is ready for use in the Planner.')
  } catch (error) {
    console.error('❌ Integration test failed:', error)
    process.exit(1)
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testLibreTimeIntegration()
}

export { testLibreTimeIntegration }
