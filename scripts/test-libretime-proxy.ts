import 'dotenv/config'

async function testLibreTimeProxy() {
  console.log('🔗 Testing LibreTime Proxy...')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  try {
    // Test GET files endpoint
    console.log('\n📁 Testing GET /api/libretime/api/v2/files?limit=1...')
    const filesResponse = await fetch(`${baseUrl}/api/libretime/api/v2/files?limit=1`)

    console.log(`Status: ${filesResponse.status}`)
    const filesData = await filesResponse.json()
    console.log('Response:', JSON.stringify(filesData, null, 2))

    if (filesResponse.ok) {
      console.log('✅ GET request successful')
    } else {
      console.log('❌ GET request failed')
    }

    // Test write operations (if enabled)
    console.log('\n📝 Testing write operations...')
    const writeEnabled = process.env.PLANNER_LT_WRITE_ENABLED !== 'false'
    console.log(`Write operations enabled: ${writeEnabled}`)

    if (writeEnabled) {
      // Test POST to schedule endpoint
      console.log('\n📅 Testing POST /api/libretime/api/v2/schedule...')
      const scheduleResponse = await fetch(`${baseUrl}/api/libretime/api/v2/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file: 1,
          instance: 1,
          starts_at: '2025-12-31T12:00:00Z',
          ends_at: '2025-12-31T14:00:00Z',
        }),
      })

      console.log(`Status: ${scheduleResponse.status}`)
      const scheduleData = await scheduleResponse.json()
      console.log('Response:', JSON.stringify(scheduleData, null, 2))

      if (scheduleResponse.ok) {
        console.log('✅ POST request successful')
      } else {
        console.log('❌ POST request failed')
      }
    } else {
      console.log('⚠️  Write operations disabled - skipping POST test')
    }

    console.log('\n🎉 Proxy test completed!')
  } catch (error) {
    console.error('❌ Proxy test failed:', error)
    process.exit(1)
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testLibreTimeProxy()
}

export { testLibreTimeProxy }
