#!/usr/bin/env node
/**
 * Upload Episodes to SoundCloud
 * 
 * Queries Payload for eligible episodes (aired, firstAiredAt set, track_id null, has libretimeFilepathRelative)
 * and uploads them to SoundCloud with cover images.
 * 
 * Usage:
 *   npx tsx scripts/upload-episodes-soundcloud.ts              # Process all eligible episodes
 *   npx tsx scripts/upload-episodes-soundcloud.ts --id <id>    # Process single episode
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import FormData from 'form-data'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Environment variables
const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'http://payload:3000'
const PAYLOAD_ADMIN_TOKEN = process.env.PAYLOAD_ADMIN_TOKEN
const PAYLOAD_INBOX_API_KEY = process.env.PAYLOAD_INBOX_API_KEY // Primary key for SoundCloud uploads
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY // Fallback to existing key
const PAYLOAD_AUTH_SLUG = process.env.PAYLOAD_AUTH_SLUG || 'users'

// SoundCloud configuration
const OAUTH_FILE = path.join(__dirname, '..', '.cache', 'soundcloud-oauth.json')
const SOUNDCLOUD_API_BASE = 'https://api.soundcloud.com'
const SOUNDCLOUD_TOKEN_URL = 'https://api.soundcloud.com/oauth2/token'
const SOUNDCLOUD_TRACKS_URL = `${SOUNDCLOUD_API_BASE}/tracks`

// File paths
const MEDIA_ROOT = '/srv/media'
const COVERS_DIR = '/srv/media/covers'

interface TokenData {
  access_token: string
  refresh_token: string
  token_type?: string
  scope?: string
  expires_in?: number
  expires_at?: number
}

interface Episode {
  id: string
  title?: string | null
  description?: string | null
  firstAiredAt?: string | null
  publishedAt?: string | null
  track_id?: number | null
  libretimeFilepathRelative?: string | null
  airStatus: string
  cover?: string | { id: string; filename: string } | null
  show?: string | { id: string; title?: string; description?: string; cover?: { id: string; filename: string } | null } | null
}

interface SoundCloudTrackResponse {
  id: number
  permalink_url: string
  [key: string]: any
}

/**
 * Build Payload authentication headers
 * Prefer PAYLOAD_ADMIN_TOKEN (JWT Bearer) over API key for update operations
 * API keys require the user to have admin/staff role, while admin tokens are guaranteed to work
 */
function buildPayloadAuthHeaders(): { Authorization: string; 'Content-Type': 'application/json' } {
  if (PAYLOAD_ADMIN_TOKEN) {
    return {
      Authorization: `Bearer ${PAYLOAD_ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    }
  }

  // Prefer PAYLOAD_INBOX_API_KEY (dedicated key for automation scripts)
  if (PAYLOAD_INBOX_API_KEY) {
    return {
      Authorization: `${PAYLOAD_AUTH_SLUG} API-Key ${PAYLOAD_INBOX_API_KEY}`,
      'Content-Type': 'application/json',
    }
  }

  // Fallback to PAYLOAD_API_KEY (existing key for other scripts)
  if (PAYLOAD_API_KEY) {
    return {
      Authorization: `${PAYLOAD_AUTH_SLUG} API-Key ${PAYLOAD_API_KEY}`,
      'Content-Type': 'application/json',
    }
  }

  throw new Error('PAYLOAD_ADMIN_TOKEN, PAYLOAD_INBOX_API_KEY, or PAYLOAD_API_KEY environment variable is required')
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
 * Refresh OAuth token
 */
async function refreshOAuthToken(refreshToken: string, clientId: string, clientSecret: string): Promise<TokenData> {
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
      }
    )
    
    if (response.status === 200) {
      const newTokenData = response.data as TokenData
      const expiresAt = Math.floor(Date.now() / 1000) + (newTokenData.expires_in || 0)
      newTokenData.expires_at = expiresAt
      return newTokenData
    } else {
      throw new Error(`Token refresh failed with status ${response.status}`)
    }
  } catch (error: any) {
    throw new Error(`Token refresh failed: ${error.message}`)
  }
}

/**
 * Save OAuth token to JSON file (atomic write)
 */
function saveOAuthToken(tokenData: TokenData): void {
  try {
    const backupFile = `${OAUTH_FILE}.backup`
    if (fs.existsSync(OAUTH_FILE)) {
      fs.copyFileSync(OAUTH_FILE, backupFile)
    }
    
    const jsonData = JSON.stringify(tokenData, null, 2) + '\n'
    fs.writeFileSync(OAUTH_FILE, jsonData, { mode: 0o600 })
    
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile)
    }
  } catch (error: any) {
    const backupFile = `${OAUTH_FILE}.backup`
    if (fs.existsSync(backupFile)) {
      fs.copyFileSync(backupFile, OAUTH_FILE)
      fs.unlinkSync(backupFile)
    }
    throw error
  }
}

/**
 * Get valid access token (load and refresh if needed)
 */
async function getValidAccessToken(): Promise<string> {
  const tokenData = loadOAuthToken()
  
  // Check if token needs refresh
  // If expires_at exists, use it; otherwise calculate from expires_in
  const now = Math.floor(Date.now() / 1000)
  let expiresAt: number | null = null
  
  if (tokenData.expires_at) {
    expiresAt = tokenData.expires_at
  } else if (tokenData.expires_in) {
    // Calculate expires_at from file modification time + expires_in
    const stats = fs.statSync(OAUTH_FILE)
    expiresAt = Math.floor(stats.mtimeMs / 1000) + tokenData.expires_in
  }
  
  // Refresh if expired or expiring within 5 minutes
  if (expiresAt && expiresAt < now + 300) {
    const clientId = process.env.SOUNDCLOUD_CLIENT_ID || extractClientIdFromToken(tokenData.access_token)
    const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET
    
    if (!clientId || !clientSecret) {
      console.warn('⚠️  Token expired but client credentials not set - will attempt to use expired token')
      return tokenData.access_token
    }
    
    console.log('🔄 Refreshing OAuth token...')
    const newTokenData = await refreshOAuthToken(tokenData.refresh_token, clientId, clientSecret)
    saveOAuthToken(newTokenData)
    console.log('✅ Token refreshed successfully')
    return newTokenData.access_token
  }
  
  return tokenData.access_token
}

/**
 * Format date for display (DD.MM.YY format)
 */
function formatDateForDisplay(date: string | Date): string {
  const d = new Date(date)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = String(d.getFullYear()).slice(-2) // Last 2 digits
  return `${day}.${month}.${year}`
}

/**
 * Slugify string: lowercase, ASCII, hyphens
 */
function slugify(str: string): string {
  return str
    .normalize('NFD') // Decompose accents
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanum with dash
    .replace(/(^-|-$)/g, '') // Trim leading/trailing dashes
}

/**
 * Build track title: Episode Title + Date (DD.MM.YY format)
 * Falls back to Show Title + Date if episode title is not available
 */
function buildTrackTitle(episode: Episode): string {
  if (!episode.firstAiredAt) {
    throw new Error('firstAiredAt is required to build track title')
  }
  
  const dateStr = formatDateForDisplay(episode.firstAiredAt)
  
  // Use episode title first, fallback to show title
  const show = typeof episode.show === 'object' ? episode.show : null
  const title = episode.title || show?.title || 'Untitled'
  
  return `${title} (${dateStr})`
}

/**
 * Generate SoundCloud permalink slug: Show Title (DD.MM.YY) -> slugified
 * Always uses show title (not episode title) for consistent permalinks
 * Capped at 80 characters to keep it neat
 */
function generateSoundCloudPermalink(episode: Episode): string {
  if (!episode.firstAiredAt) {
    throw new Error('firstAiredAt is required to generate permalink')
  }
  
  const dateStr = formatDateForDisplay(episode.firstAiredAt)
  
  // Always use show title for permalink (not episode title)
  const show = typeof episode.show === 'object' ? episode.show : null
  const showTitle = show?.title || episode.title || 'Untitled'
  
  // Format: "Show Title (DD.MM.YY)"
  const base = `${showTitle} (${dateStr})`
  
  // Slugify: lowercase, ASCII, hyphens
  const slug = slugify(base)
  
  // Cap at 80 characters
  return slug.length > 80 ? slug.substring(0, 80) : slug
}

/**
 * Resolve cover image file path
 */
function resolveCoverPath(episode: Episode): string | null {
  // Check episode cover first
  if (episode.cover && typeof episode.cover === 'object' && episode.cover.filename) {
    const coverPath = path.join(COVERS_DIR, episode.cover.filename)
    if (fs.existsSync(coverPath)) {
      return coverPath
    }
  }
  
  // Fallback to show cover
  const show = typeof episode.show === 'object' ? episode.show : null
  if (show?.cover && typeof show.cover === 'object' && show.cover.filename) {
    const coverPath = path.join(COVERS_DIR, show.cover.filename)
    if (fs.existsSync(coverPath)) {
      return coverPath
    }
  }
  
  return null
}

/**
 * Clean SoundCloud URL (remove query parameters)
 */
function cleanSoundCloudUrl(permalinkUrl: string): string {
  try {
    const url = new URL(permalinkUrl)
    return url.origin + url.pathname
  } catch {
    // If URL parsing fails, return as-is
    return permalinkUrl
  }
}

/**
 * Extract SoundCloud permalink pathname from URL
 */
function extractSoundCloudPermalink(permalinkUrl: string): string {
  try {
    const url = new URL(permalinkUrl)
    return url.pathname
  } catch {
    // If URL parsing fails, return empty string
    return ''
  }
}

/**
 * Query Payload for eligible episodes
 */
async function queryEligibleEpisodes(): Promise<Episode[]> {
  try {
    const response = await axios.get(`${PAYLOAD_API_URL}/api/episodes`, {
      params: {
        where: {
          and: [
            { airStatus: { equals: 'aired' } },
            { firstAiredAt: { exists: true } },
            { track_id: { equals: null } },
            { libretimeFilepathRelative: { exists: true } },
          ],
        },
        limit: 1000,
        depth: 1,
      },
      headers: buildPayloadAuthHeaders(),
      timeout: 10000,
    })
    
    return response.data.docs || []
  } catch (error: any) {
    throw new Error(`Failed to query episodes: ${error.message}`)
  }
}

/**
 * Fetch single episode by ID
 */
async function fetchEpisodeById(episodeId: string): Promise<Episode> {
  try {
    const response = await axios.get(`${PAYLOAD_API_URL}/api/episodes/${episodeId}`, {
      params: {
        depth: 1,
      },
      headers: buildPayloadAuthHeaders(),
      timeout: 10000,
    })
    
    return response.data
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(`Episode ${episodeId} not found`)
    }
    throw new Error(`Failed to fetch episode: ${error.message}`)
  }
}

/**
 * Upload episode to SoundCloud
 */
async function uploadToSoundCloud(
  episode: Episode,
  audioPath: string,
  coverPath: string | null,
  accessToken: string,
): Promise<SoundCloudTrackResponse> {
  const form = new FormData()
  
  // Build track title
  const trackTitle = buildTrackTitle(episode)
  form.append('track[title]', trackTitle)
  
  // Generate and set custom permalink slug
  const permalinkSlug = generateSoundCloudPermalink(episode)
  form.append('track[permalink]', permalinkSlug)
  
  // Build description
  const description = episode.description || 
    (typeof episode.show === 'object' ? episode.show?.description || '' : '')
  form.append('track[description]', description)
  
  // Set sharing to public
  form.append('track[sharing]', 'public')
  
  // Add audio file
  form.append('track[asset_data]', fs.createReadStream(audioPath))
  
  // Add cover image if available
  if (coverPath) {
    form.append('track[artwork_data]', fs.createReadStream(coverPath))
  }
  
  try {
    const response = await axios.post(SOUNDCLOUD_TRACKS_URL, form, {
      headers: {
        Authorization: `OAuth ${accessToken}`,
        ...form.getHeaders(),
      },
      timeout: 300000, // 5 minutes for large files
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })
    
    return response.data
  } catch (error: any) {
    if (error.response) {
      throw new Error(`SoundCloud upload failed (${error.response.status}): ${JSON.stringify(error.response.data)}`)
    }
    throw new Error(`SoundCloud upload failed: ${error.message}`)
  }
}

/**
 * Update Payload episode with SoundCloud data
 */
async function updatePayloadEpisode(
  episodeId: string,
  trackId: number,
  soundcloudUrl: string,
): Promise<void> {
  try {
    const scPermalink = extractSoundCloudPermalink(soundcloudUrl)
    
    await axios.patch(
      `${PAYLOAD_API_URL}/api/episodes/${episodeId}`,
      {
        track_id: trackId,
        soundcloud: soundcloudUrl,
        scPermalink: scPermalink,
      },
      {
        headers: buildPayloadAuthHeaders(),
        timeout: 10000,
      }
    )
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(`Episode ${episodeId} not found`)
    }
    if (error.response?.status === 403) {
      const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : 'No details'
      throw new Error(`Failed to update Payload episode (403 Forbidden): ${errorDetails}. Check API key permissions.`)
    }
    throw new Error(`Failed to update Payload episode: ${error.message}`)
  }
}

/**
 * Process single episode
 */
async function processEpisode(episodeId: string, accessToken: string): Promise<boolean> {
  console.log(`\n📋 Processing episode: ${episodeId}`)
  
  try {
    // Fetch episode
    const episode = await fetchEpisodeById(episodeId)
    
    // MANDATORY DUPLICATE GUARDRAIL: Check track_id immediately
    if (episode.track_id != null) {
      console.error(`❌ Episode ${episode.id} already has track_id=${episode.track_id}. Skipping upload.`)
      process.exit(1)
    }
    
    // Validate other criteria
    if (episode.airStatus !== 'aired') {
      console.log(`   ⏭️  Skipping: airStatus is '${episode.airStatus}' (expected 'aired')`)
      return false
    }
    
    if (!episode.firstAiredAt) {
      console.log(`   ⏭️  Skipping: firstAiredAt is not set`)
      return false
    }
    
    if (!episode.libretimeFilepathRelative) {
      console.log(`   ⏭️  Skipping: libretimeFilepathRelative is not set`)
      return false
    }
    
    // Resolve audio file path
    const audioPath = path.join(MEDIA_ROOT, episode.libretimeFilepathRelative)
    if (!fs.existsSync(audioPath)) {
      console.log(`   ⏭️  Skipping: Audio file not found: ${audioPath}`)
      return false
    }
    
    // Resolve cover image path
    const coverPath = resolveCoverPath(episode)
    if (coverPath) {
      console.log(`   📷 Using cover: ${coverPath}`)
    } else {
      console.log(`   ⚠️  No cover image found`)
    }
    
    // Upload to SoundCloud
    console.log(`   🎵 Uploading to SoundCloud...`)
    const trackTitle = buildTrackTitle(episode)
    console.log(`   Title: ${trackTitle}`)
    
    const scResponse = await uploadToSoundCloud(episode, audioPath, coverPath, accessToken)
    
    console.log(`   ✅ Upload successful!`)
    console.log(`   Track ID: ${scResponse.id}`)
    console.log(`   Permalink: ${scResponse.permalink || '(not in response)'}`)
    console.log(`   Permalink URL: ${scResponse.permalink_url}`)
    
    // Use the permalink_url from response (SoundCloud may adjust the slug, e.g., append -1 on duplicates)
    const cleanUrl = cleanSoundCloudUrl(scResponse.permalink_url)
    console.log(`   💾 Updating Payload...`)
    await updatePayloadEpisode(episode.id, scResponse.id, cleanUrl)
    
    console.log(`   ✅ Payload updated with track_id=${scResponse.id}, soundcloud=${cleanUrl}, scPermalink=${extractSoundCloudPermalink(cleanUrl)}`)
    
    return true
  } catch (error: any) {
    console.error(`   ❌ Error processing episode ${episodeId}: ${error.message}`)
    if (error.stack) {
      console.error(error.stack)
    }
    return false
  }
}

/**
 * Main function
 */
async function main() {
  console.log('=== SoundCloud Episode Upload ===\n')
  
  // Parse command line arguments
  const args = process.argv.slice(2)
  const idIndex = args.indexOf('--id')
  const singleEpisodeId = idIndex >= 0 && args[idIndex + 1] ? args[idIndex + 1] : null
  
  try {
    // Get valid access token
    const accessToken = await getValidAccessToken()
    
    if (singleEpisodeId) {
      // Single episode mode
      console.log(`🎯 Single episode mode: ${singleEpisodeId}\n`)
      const success = await processEpisode(singleEpisodeId, accessToken)
      process.exit(success ? 0 : 1)
    } else {
      // Batch mode - query eligible episodes
      console.log('🔍 Querying eligible episodes...\n')
      const episodes = await queryEligibleEpisodes()
      
      console.log(`Found ${episodes.length} eligible episode(s)\n`)
      
      if (episodes.length === 0) {
        console.log('✅ No episodes to process')
        return
      }
      
      let successCount = 0
      let skipCount = 0
      
      for (const episode of episodes) {
        // MANDATORY DUPLICATE GUARDRAIL: Check track_id immediately
        if (episode.track_id != null) {
          console.log(`❌ Episode ${episode.id} already has track_id=${episode.track_id}. Skipping upload.`)
          skipCount++
          continue
        }
        
        const success = await processEpisode(episode.id, accessToken)
        if (success) {
          successCount++
        } else {
          skipCount++
        }
        
        // Small delay between uploads to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      
      console.log('\n' + '='.repeat(50))
      console.log('📊 Summary:')
      console.log(`   ✅ Successfully uploaded: ${successCount}`)
      console.log(`   ⏭️  Skipped: ${skipCount}`)
      console.log('='.repeat(50) + '\n')
    }
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})

