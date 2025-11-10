#!/usr/bin/env node
// Test script for API-first approach

import axios from 'axios'

const LIBRETIME_API_URL = 'https://schedule.diaradio.live'
const LIBRETIME_API_KEY = 'cee870b7f12f65edec103a9c02987697'

function ltHeaders() {
  return {
    Authorization: `Api-Key ${LIBRETIME_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function fetchLtFilesByPrefix(episodeId) {
  console.log(`🔍 Searching LibreTime for files with prefix: ${episodeId}__`)

  try {
    const response = await axios.get(`${LIBRETIME_API_URL}/api/v2/files?search=${episodeId}__`, {
      headers: ltHeaders(),
      timeout: 10000,
    })

    const files = response.data
    console.log(`📡 Found ${files.length} files matching prefix`)

    return files
  } catch (error) {
    console.log(`⚠️  LibreTime API search failed: ${error.message}`)
    return []
  }
}

async function fetchLtFileById(id) {
  console.log(`🔍 Fetching LibreTime file by ID: ${id}`)

  try {
    const response = await axios.get(`${LIBRETIME_API_URL}/api/v2/files/${id}`, {
      headers: ltHeaders(),
      timeout: 10000,
    })

    console.log(`✅ Retrieved file details for ID: ${id}`)
    return response.data
  } catch (error) {
    console.log(`⚠️  Failed to fetch file by ID ${id}: ${error.message}`)
    return null
  }
}

async function testApiFirst() {
  console.log('🧪 Testing API-first approach...')

  // Test with a known episode ID
  const episodeId = '686d115dd9c5ee507e7c9355'

  try {
    // Test 1: Search by prefix
    const matches = await fetchLtFilesByPrefix(episodeId)
    console.log('Test 1 - Search by prefix:', matches.length > 0 ? '✅ SUCCESS' : '❌ FAILED')

    if (matches.length > 0) {
      const file = matches[0]
      console.log(`   Found file: ${file.filepath || file.name} (ID: ${file.id})`)

      // Test 2: Fetch by ID
      const fileDetails = await fetchLtFileById(file.id)
      console.log('Test 2 - Fetch by ID:', fileDetails ? '✅ SUCCESS' : '❌ FAILED')

      if (fileDetails) {
        console.log(`   Filepath: ${fileDetails.filepath}`)
        console.log(`   Length: ${fileDetails.length}`)
        console.log(`   MD5: ${fileDetails.md5}`)
      }
    }

    console.log('\n🎉 API-first approach test completed!')
  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}

testApiFirst()
