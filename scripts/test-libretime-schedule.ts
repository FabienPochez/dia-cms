import 'dotenv/config'
import { LibreTimeClient } from '../src/server/lib/libretimeClient'

interface TestScheduleParams {
  instanceId?: number
  fileId?: number
  start?: string
  end?: string
}

async function testLibreTimeSchedule() {
  console.log('🎧 Testing LibreTime Schedule API...')

  try {
    const client = new LibreTimeClient()

    // Get test parameters from environment or command line args
    const params: TestScheduleParams = {
      instanceId: process.env.INSTANCE_ID ? parseInt(process.env.INSTANCE_ID) : undefined,
      fileId: process.env.FILE_ID ? parseInt(process.env.FILE_ID) : undefined,
      start: process.env.START || undefined,
      end: process.env.END || undefined,
    }

    // If no parameters provided, try to get some test data
    if (!params.instanceId || !params.fileId || !params.start || !params.end) {
      console.log('📋 Fetching available data for testing...')

      // Get available shows and instances
      const shows = await client.getShows({ limit: 5 })
      console.log(`Found ${shows.length} shows`)

      if (shows.length === 0) {
        throw new Error('No shows found in LibreTime')
      }

      const instances = await client.getInstances({
        show: shows[0].id,
        limit: 5,
      })
      console.log(`Found ${instances.length} instances for show "${shows[0].name}"`)

      if (instances.length === 0) {
        throw new Error('No instances found for the first show')
      }

      // Get available files
      const files = await client.getFiles({ limit: 5 })
      console.log(`Found ${files.length} files`)

      if (files.length === 0) {
        throw new Error('No files found in LibreTime')
      }

      // Use the first available data
      params.instanceId = instances[0].id
      params.fileId = files[0].id

      // Set default times (1 hour from now, 2 hours duration)
      const now = new Date()
      const startTime = new Date(now.getTime() + 60 * 60 * 1000) // 1 hour from now
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000) // 2 hours duration

      params.start = startTime.toISOString()
      params.end = endTime.toISOString()

      console.log(`Using test data:`)
      console.log(`  Instance ID: ${params.instanceId}`)
      console.log(`  File ID: ${params.fileId}`)
      console.log(`  Start: ${params.start}`)
      console.log(`  End: ${params.end}`)
    }

    // Validate required parameters
    if (!params.instanceId || !params.fileId || !params.start || !params.end) {
      throw new Error('Missing required parameters: INSTANCE_ID, FILE_ID, START, END')
    }

    console.log('\n📅 Creating schedule entry...')

    // Create the schedule entry
    const scheduleEntry = await client.createSchedule({
      instance: params.instanceId,
      file: params.fileId,
      starts_at: params.start,
      ends_at: params.end,
    })

    console.log('✅ Schedule entry created successfully!')
    console.log(`   ID: ${scheduleEntry.id}`)
    console.log(`   Instance: ${scheduleEntry.instance}`)
    console.log(`   File: ${scheduleEntry.file}`)
    console.log(`   Starts: ${scheduleEntry.starts_at}`)
    console.log(`   Ends: ${scheduleEntry.ends_at}`)

    // Test updating the schedule entry
    console.log('\n🔄 Testing schedule update...')
    const updatedStart = new Date(params.start)
    updatedStart.setMinutes(updatedStart.getMinutes() + 5) // Move 5 minutes later

    const updatedEntry = await client.updateSchedule(scheduleEntry.id, {
      starts_at: updatedStart.toISOString(),
    })

    console.log('✅ Schedule entry updated successfully!')
    console.log(`   New start time: ${updatedEntry.starts_at}`)

    // Test getting the schedule entry
    console.log('\n📖 Testing schedule retrieval...')
    const retrievedEntry = await client.getScheduleEntry(scheduleEntry.id)
    console.log('✅ Schedule entry retrieved successfully!')
    console.log(`   Retrieved ID: ${retrievedEntry.id}`)

    // Test getting all schedule entries
    console.log('\n📋 Testing schedule list...')
    const allSchedule = await client.getSchedule({ limit: 10 })
    console.log(`✅ Retrieved ${allSchedule.length} schedule entries`)

    // Clean up - delete the test schedule entry
    console.log('\n🗑️  Cleaning up test schedule entry...')
    await client.deleteSchedule(scheduleEntry.id)
    console.log('✅ Test schedule entry deleted successfully!')

    console.log('\n🎉 All tests passed! LibreTime v2 API is working correctly.')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testLibreTimeSchedule()
}

export { testLibreTimeSchedule }
