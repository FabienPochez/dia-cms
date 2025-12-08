#!/usr/bin/env node
/**
 * Test LibreTime Authentication
 * Tests both internal and external URLs to find which works
 */

import axios from 'axios'

const LIBRETIME_API_KEY = process.env.LIBRETIME_API_KEY

if (!LIBRETIME_API_KEY) {
  console.error('❌ LIBRETIME_API_KEY environment variable is required')
  process.exit(1)
}

function buildHeaders() {
  return {
    Authorization: `Api-Key ${LIBRETIME_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function testUrl(url: string, name: string) {
  console.log(`\n🔍 Testing ${name}:`)
  console.log(`   URL: ${url}`)
  console.log(`   API Key: ${LIBRETIME_API_KEY.substring(0, 10)}...`)
  
  // Test root API endpoint first
  try {
    const rootResponse = await axios.get(`${url}/api/v2/`, {
      headers: buildHeaders(),
      timeout: 5000,
      validateStatus: () => true,
    })
    
    console.log(`   Root /api/v2/: ${rootResponse.status}`)
    
    if (rootResponse.status === 200 || rootResponse.status === 403) {
      // 403 means auth is being checked (API exists), 200 means it works
      console.log(`   ✅ API endpoint exists!`)
      
      // Now test shows endpoint
      const showsResponse = await axios.get(`${url}/api/v2/shows/`, {
        headers: buildHeaders(),
        timeout: 5000,
        validateStatus: () => true,
      })
      
      console.log(`   /api/v2/shows/: ${showsResponse.status}`)
      
      if (showsResponse.status === 200) {
        console.log(`   ✅ SUCCESS! Found ${showsResponse.data?.length || 0} shows`)
        return true
      } else {
        console.log(`   Response: ${JSON.stringify(showsResponse.data).substring(0, 200)}`)
        return false
      }
    } else {
      console.log(`   ❌ Root endpoint failed: ${rootResponse.status}`)
      console.log(`   Response: ${JSON.stringify(rootResponse.data).substring(0, 200)}`)
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
  console.log('=== LibreTime Authentication Test ===\n')
  
  const urls = [
    { url: 'http://api:9001', name: 'Internal Docker URL (api:9001)' },
    { url: 'http://libretime-nginx-1:8080', name: 'Internal Docker URL (nginx:8080)' },
    { url: 'https://schedule.diaradio.live', name: 'External URL (HTTPS)' },
    { url: 'http://localhost:8080', name: 'Localhost (if running from host)' },
  ]
  
  let successCount = 0
  
  for (const { url, name } of urls) {
    const success = await testUrl(url, name)
    if (success) {
      successCount++
    }
  }
  
  console.log(`\n=== Summary ===`)
  console.log(`✅ Working URLs: ${successCount}/${urls.length}`)
  
  if (successCount === 0) {
    console.log(`\n❌ No working URLs found. Possible issues:`)
    console.log(`   1. API key is incorrect`)
    console.log(`   2. LibreTime API is not accessible`)
    console.log(`   3. Network/firewall blocking access`)
  }
}

main().catch(console.error)

