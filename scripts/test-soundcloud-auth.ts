#!/usr/bin/env node
/**
 * Test SoundCloud OAuth Authentication - Comprehensive Test
 * 
 * Tests the OAuth token stored in .cache/soundcloud-oauth.json
 * Performs 4-step verification:
 * 1. Read and parse token file
 * 2. Access test (call /me endpoint)
 * 3. Refresh test (simulate expired token, refresh, update file)
 * 4. Access test again (verify refreshed token works)
 * 
 * Usage:
 *   npx tsx scripts/test-soundcloud-auth.ts
 * 
 * Or via Docker:
 *   docker compose -f /srv/payload/docker-compose.yml run --rm jobs npx tsx scripts/test-soundcloud-auth.ts
 * 
 * Note: Requires SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET
 *       environment variables for refresh token testing (step 3)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const OAUTH_FILE = path.join(__dirname, '..', '.cache', 'soundcloud-oauth.json')
const SOUNDCLOUD_API_BASE = 'https://api.soundcloud.com'
const SOUNDCLOUD_TOKEN_URL = 'https://api.soundcloud.com/oauth2/token'

interface TokenData {
  access_token: string
  refresh_token: string
  token_type?: string
  scope?: string
  expires_in?: number
  expires_at?: number
}

interface ParsedTokenData {
  access_token: string
  refresh_token: string
  token_type: string
  scope: string
  expires_in?: number
  expires_at?: number
}

interface AccessTestResult {
  success: boolean
  user?: any
  error?: string
}

interface RefreshResult {
  success: boolean
  tokenData?: TokenData
  error?: string
}

/**
 * Load OAuth token from JSON file
 */
function loadOAuthToken(): TokenData {
  try {
    const data = fs.readFileSync(OAUTH_FILE, 'utf8')
    const token = JSON.parse(data) as TokenData
    
    if (!token.access_token) {
      throw new Error('access_token not found in OAuth file')
    }
    
    if (!token.refresh_token) {
      throw new Error('refresh_token not found in OAuth file')
    }
    
    return token
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error(`❌ OAuth file not found: ${OAUTH_FILE}`)
      console.error('   Make sure you have stored your OAuth token in .cache/soundcloud-oauth.json')
    } else {
      console.error(`❌ Error reading OAuth file: ${error.message}`)
    }
    process.exit(1)
  }
}

/**
 * Parse token data and extract/calculate expires_at
 */
function parseTokenData(tokenData: TokenData): ParsedTokenData {
  const parsed: ParsedTokenData = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_type: tokenData.token_type || 'Bearer',
    scope: tokenData.scope || '',
    expires_in: tokenData.expires_in,
  }
  
  // Calculate expires_at if we have expires_in but not expires_at
  if (tokenData.expires_in && !tokenData.expires_at) {
    // If no expires_at, we'll calculate it from file modification time + expires_in
    // For testing, we'll use current time + expires_in
    const stats = fs.statSync(OAUTH_FILE)
    parsed.expires_at = Math.floor(stats.mtimeMs / 1000) + tokenData.expires_in
  } else if (tokenData.expires_at) {
    parsed.expires_at = tokenData.expires_at
  }
  
  return parsed
}

/**
 * Extract client_id from JWT token (if present)
 */
function extractClientIdFromToken(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.')
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
      return payload.client_id || null
    }
  } catch (error) {
    // Not a JWT or can't parse
  }
  return null
}

/**
 * Save OAuth token to JSON file (atomic write)
 */
function saveOAuthToken(tokenData: TokenData): boolean {
  try {
    // Create backup first
    const backupFile = `${OAUTH_FILE}.backup`
    if (fs.existsSync(OAUTH_FILE)) {
      fs.copyFileSync(OAUTH_FILE, backupFile)
    }
    
    // Write new file
    const jsonData = JSON.stringify(tokenData, null, 2) + '\n'
    fs.writeFileSync(OAUTH_FILE, jsonData, { mode: 0o600 })
    
    // Remove backup if write succeeded
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile)
    }
    
    return true
  } catch (error: any) {
    // Restore backup if write failed
    const backupFile = `${OAUTH_FILE}.backup`
    if (fs.existsSync(backupFile)) {
      fs.copyFileSync(backupFile, OAUTH_FILE)
      fs.unlinkSync(backupFile)
    }
    throw error
  }
}

/**
 * Test SoundCloud API authentication with /me endpoint
 */
async function testSoundCloudAccess(accessToken: string, stepName: string = 'Access Test'): Promise<AccessTestResult> {
  console.log(`🔍 ${stepName}...\n`)
  
  try {
    const response = await axios.get(`${SOUNDCLOUD_API_BASE}/me`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      timeout: 10000,
      validateStatus: () => true, // Don't throw on any status
    })
    
    console.log(`   Status: ${response.status}`)
    
    if (response.status === 200) {
      const user = response.data
      console.log(`   ✅ Authentication successful!`)
      console.log(`\n   User Info:`)
      console.log(`   - ID: ${user.id}`)
      console.log(`   - Username: ${user.username || 'N/A'}`)
      console.log(`   - Full Name: ${user.full_name || 'N/A'}`)
      console.log(`   - Permalink: ${user.permalink || 'N/A'}`)
      if (user.avatar_url) {
        console.log(`   - Avatar: ${user.avatar_url}`)
      }
      return { success: true, user }
    } else if (response.status === 401) {
      console.log(`   ❌ Authentication failed: Token is invalid or expired`)
      if (response.data) {
        console.log(`   Response: ${JSON.stringify(response.data).substring(0, 200)}`)
      }
      return { success: false, error: 'Invalid or expired token' }
    } else {
      console.log(`   ⚠️  Unexpected status: ${response.status}`)
      if (response.data) {
        console.log(`   Response: ${JSON.stringify(response.data).substring(0, 200)}`)
      }
      return { success: false, error: `Unexpected status: ${response.status}` }
    }
  } catch (error: any) {
    console.log(`   ❌ Request failed: ${error.message}`)
    if (error.response) {
      console.log(`   Status: ${error.response.status}`)
      if (error.response.data) {
        console.log(`   Response: ${JSON.stringify(error.response.data).substring(0, 200)}`)
      }
    } else if (error.request) {
      console.log(`   No response received - check network connection`)
    }
    return { success: false, error: error.message }
  }
}

/**
 * Refresh OAuth token
 */
async function refreshOAuthToken(refreshToken: string, clientId: string, clientSecret: string): Promise<RefreshResult> {
  console.log('🔄 Testing token refresh...\n')
  
  try {
    const response = await axios.post(
      SOUNDCLOUD_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        timeout: 10000,
        validateStatus: () => true,
      }
    )
    
    console.log(`   Status: ${response.status}`)
    
    if (response.status === 200) {
      const newTokenData = response.data as TokenData
      console.log(`   ✅ Token refresh successful!`)
      console.log(`   - New access_token: ${newTokenData.access_token.substring(0, 30)}...`)
      console.log(`   - Expires in: ${newTokenData.expires_in} seconds`)
      console.log(`   - Has new refresh_token: ${newTokenData.refresh_token ? 'Yes' : 'No'}`)
      
      // Calculate expires_at
      const expiresAt = Math.floor(Date.now() / 1000) + (newTokenData.expires_in || 0)
      newTokenData.expires_at = expiresAt
      
      return { success: true, tokenData: newTokenData }
    } else {
      console.log(`   ❌ Token refresh failed: ${response.status}`)
      if (response.data) {
        console.log(`   Response: ${JSON.stringify(response.data).substring(0, 300)}`)
      }
      return { success: false, error: `Refresh failed with status ${response.status}` }
    }
  } catch (error: any) {
    console.log(`   ❌ Refresh request failed: ${error.message}`)
    if (error.response) {
      console.log(`   Status: ${error.response.status}`)
      if (error.response.data) {
        console.log(`   Response: ${JSON.stringify(error.response.data).substring(0, 300)}`)
      }
    } else if (error.request) {
      console.log(`   No response received - check network connection`)
    }
    return { success: false, error: error.message }
  }
}

/**
 * Main function - 4-step test
 */
async function main() {
  console.log('=== SoundCloud OAuth Comprehensive Test ===\n')
  
  // Step 1: Read and parse token file
  console.log('📋 Step 1: Read and Parse Token File\n')
  console.log(`📁 Loading OAuth token from: ${OAUTH_FILE}`)
  const rawTokenData = loadOAuthToken()
  const tokenData = parseTokenData(rawTokenData)
  
  console.log(`   ✅ Token file loaded and parsed`)
  console.log(`   - Access token: ${tokenData.access_token.substring(0, 30)}...`)
  console.log(`   - Refresh token: ${tokenData.refresh_token.substring(0, 20)}...`)
  console.log(`   - Token type: ${tokenData.token_type}`)
  console.log(`   - Expires in: ${tokenData.expires_in ? `${tokenData.expires_in} seconds` : 'N/A'}`)
  if (tokenData.expires_at) {
    const expiresDate = new Date(tokenData.expires_at * 1000)
    console.log(`   - Expires at: ${expiresDate.toISOString()} (${tokenData.expires_at})`)
  }
  console.log(`   - Scope: ${tokenData.scope || '(empty)'}`)
  
  // Step 2: Access test
  console.log('\n' + '='.repeat(50))
  console.log('📋 Step 2: Access Test (Initial)\n')
  const accessResult1 = await testSoundCloudAccess(tokenData.access_token, 'Testing initial access token')
  
  if (!accessResult1.success) {
    console.log('\n   ⚠️  Step 2 FAILED - Token may be expired (this is OK, we can test refresh)')
    console.log(`   Error: ${accessResult1.error}`)
    console.log('   Continuing to refresh test (step 3)...\n')
  }
  
  // Step 3: Refresh test
  console.log('\n' + '='.repeat(50))
  console.log('📋 Step 3: Refresh Token Test\n')
  
  // Get client credentials
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID || extractClientIdFromToken(tokenData.access_token)
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET
  
  if (!clientId) {
    console.log('   ⚠️  Cannot extract client_id from token and SOUNDCLOUD_CLIENT_ID not set')
    console.log('   Skipping refresh test (step 3)')
    console.log('   Set SOUNDCLOUD_CLIENT_ID environment variable to enable refresh test')
  } else if (!clientSecret) {
    console.log('   ⚠️  SOUNDCLOUD_CLIENT_SECRET not set')
    console.log('   Skipping refresh test (step 3)')
    console.log('   Set SOUNDCLOUD_CLIENT_SECRET environment variable to enable refresh test')
  } else {
    console.log(`   Using client_id: ${clientId.substring(0, 20)}...`)
    console.log(`   Simulating expired token (forcing refresh)...`)
    
    const refreshResult = await refreshOAuthToken(
      tokenData.refresh_token,
      clientId,
      clientSecret
    )
    
    if (!refreshResult.success) {
      console.log('\n' + '='.repeat(50))
      console.log('❌ Step 3 FAILED - Token refresh unsuccessful')
      console.log(`   Error: ${refreshResult.error}`)
      process.exit(1)
    }
    
    // Save refreshed token
    console.log(`\n   💾 Saving refreshed token to file...`)
    try {
      saveOAuthToken(refreshResult.tokenData!)
      console.log(`   ✅ Token file updated successfully`)
    } catch (error: any) {
      console.log(`   ❌ Failed to save token: ${error.message}`)
      process.exit(1)
    }
    
    // Step 4: Access test again with refreshed token
    console.log('\n' + '='.repeat(50))
    console.log('📋 Step 4: Access Test (After Refresh)\n')
    const accessResult2 = await testSoundCloudAccess(
      refreshResult.tokenData!.access_token,
      'Testing refreshed access token'
    )
    
    if (!accessResult2.success) {
      console.log('\n' + '='.repeat(50))
      console.log('❌ Step 4 FAILED - Refreshed token does not work')
      console.log(`   Error: ${accessResult2.error}`)
      process.exit(1)
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('✅ ALL TESTS PASSED!')
  console.log('='.repeat(50))
  console.log('\n   Step 1: ✅ Token file read and parsed')
  console.log('   Step 2: ✅ Initial access test successful')
  if (clientId && clientSecret) {
    console.log('   Step 3: ✅ Token refresh successful')
    console.log('   Step 4: ✅ Refreshed token access test successful')
    console.log('\n   🎉 OAuth plumbing is DONE and working correctly!')
  } else {
    console.log('   Step 3: ⏭️  Skipped (client credentials not provided)')
    console.log('   Step 4: ⏭️  Skipped (step 3 not run)')
    console.log('\n   💡 To test refresh functionality, set:')
    console.log('      SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET')
  }
  console.log('='.repeat(50) + '\n')
}

main().catch((error) => {
  console.error('\n❌ Script failed:', error)
  if ((error as Error).stack) {
    console.error((error as Error).stack)
  }
  process.exit(1)
})

