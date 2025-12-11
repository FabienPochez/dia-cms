#!/usr/bin/env node
/**
 * Test LibreTime Schedule Endpoint Authentication
 * This is what the sync button uses
 */

import axios from 'axios'

const LIBRETIME_API_KEY = process.env.LIBRETIME_API_KEY

if (!LIBRETIME_API_KEY) {
  console.error('❌ LIBRETIME_API_KEY environment variable is required')
  process.exit(1)
}

async function testScheduleEndpoint(url: string, name: string) {
  console.log(`\n🔍 Testing ${name}:`)
  console.log(`   URL: ${url}/api/v2/schedule?limit=5`)
  console.log(`   API Key: ${LIBRETIME_API_KEY.substring(0, 10)}...`)
  
  try {
    const response = await axios.get(`${url}/api/v2/schedule?limit=5`, {
      headers: {
        Authorization: `Api-Key ${LIBRETIME_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
      validateStatus: () => true,
    })
    
    console.log(`   Status: ${response.status}`)
    
    if (response.status === 200) {
      const data = response.data
      const count = Array.isArray(data) ? data.length : (data?.results?.length || 0)
      console.log(`   ✅ SUCCESS! Found ${count} schedule items`)
      return true
    } else {
      console.log(`   ❌ FAILED: ${response.status}`)
      console.log(`   Response: ${JSON.stringify(response.data).substring(0, 200)}`)
      return false
    }
  } catch (error: any) {
    console.log(`   ❌ ERROR: ${error.message}`)
    if (error.response) {
      console.log(`   Status: ${error.response.status}`)
      console.log(`   Response: ${JSON.stringify(error.response.data).substring(0, 200)}`)
    }
    return false
  }
}

async function main() {
  console.log('=== LibreTime Schedule Endpoint Authentication Test ===\n')
  console.log('This tests the endpoint used by the sync button\n')
  
  const urls = [
    { url: 'http://libretime-nginx-1:8080', name: 'Internal Docker URL (nginx:8080)' },
    { url: 'https://schedule.diaradio.live', name: 'External URL (HTTPS)' },
  ]
  
  let successCount = 0
  
  for (const { url, name } of urls) {
    const success = await testScheduleEndpoint(url, name)
    if (success) {
      successCount++
    }
  }
  
  console.log(`\n=== Summary ===`)
  console.log(`✅ Working URLs: ${successCount}/${urls.length}`)
  
  if (successCount > 0) {
    console.log(`\n🎉 Authentication is working! The sync button should work now.`)
  } else {
    console.log(`\n❌ Authentication still failing. Check API key configuration.`)
  }
}

main().catch(console.error)





