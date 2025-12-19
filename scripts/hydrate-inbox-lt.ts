import 'dotenv/config'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { glob } from 'glob'
import { exec } from 'child_process'
import { promisify } from 'util'
import axios from 'axios'

const execAsync = promisify(exec)

// Concurrency safety
declare global {
  var bulkImportCalled: boolean | undefined
}

if (typeof global.bulkImportCalled === 'undefined') {
  global.bulkImportCalled = false
}

const LOCKFILE_PATH = '/tmp/lt-hydrate-inbox.lock'

// Environment variables
const LIBRETIME_CONTAINER_NAME = process.env.LIBRETIME_CONTAINER_NAME || 'libretime-web'
const MEDIA_NEW_DIR = process.env.MEDIA_NEW_DIR || '/srv/media/new'
const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'
const LIBRETIME_API_URL = process.env.LIBRETIME_API_URL || 'http://api:9001'
const LIBRETIME_API_KEY = process.env.LIBRETIME_API_KEY

// Resolve Payload API URL - use internal when in Docker, public otherwise
function resolvePayloadApiUrl(): string {
  // When running via docker compose run, we're always in Docker
  // Check for docker compose indicators
  const isDockerCompose = process.env.CONTAINER || 
                          process.env.COMPOSE_PROJECT_NAME ||
                          fsSync.existsSync('/.dockerenv')
  
  // If running in Docker (via docker compose), always use internal URL to avoid Cloudflare
  if (isDockerCompose) {
    return 'http://payload:3000'
  }
  
  // Environment variable has priority for host execution
  if (process.env.PAYLOAD_API_URL) {
    return process.env.PAYLOAD_API_URL
  }
  
  // Default to public URL (for host execution)
  return 'https://content.diaradio.live'
}

const PAYLOAD_API_URL = resolvePayloadApiUrl()
const PAYLOAD_ADMIN_TOKEN = process.env.PAYLOAD_ADMIN_TOKEN
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY
const PAYLOAD_AUTH_SLUG = process.env.PAYLOAD_AUTH_SLUG || 'users'

interface HydrateOptions {
  inbox?: string
  batchSize?: number
  pollSeconds?: number
  timeoutSeconds?: number
  dryRun?: boolean
  libretimeUrl?: string
}

interface LibreTimeFile {
  id: number
  name?: string
  filepath?: string
  track_title?: string
  creator?: string
  mime: string
  length?: string
  ftype?: string
}

interface PayloadEpisode {
  id: string
  title?: string
  pendingReview?: boolean
  airStatus: 'draft' | 'queued' | 'scheduled' | 'airing' | 'aired' | 'failed'
  libretimeTrackId?: string | null
  libretimeFilepathRelative?: string | null
}

interface LibretimeData {
  id: number
  relativePath: string
}

/**
 * Build Payload authentication headers with API Key preference and JWT fallback
 */
function buildPayloadAuthHeaders(): { Authorization: string; 'Content-Type': 'application/json' } {
  if (PAYLOAD_API_KEY) {
    return {
      Authorization: `${PAYLOAD_AUTH_SLUG} API-Key ${PAYLOAD_API_KEY}`,
      'Content-Type': 'application/json',
    }
  }

  if (PAYLOAD_ADMIN_TOKEN) {
    return {
      Authorization: `Bearer ${PAYLOAD_ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    }
  }

  throw new Error('PAYLOAD_API_KEY or PAYLOAD_ADMIN_TOKEN environment variable is required')
}

/**
 * Build LibreTime API headers
 */
function ltHeaders(): { Authorization: string; 'Content-Type': 'application/json' } {
  if (!LIBRETIME_API_KEY) {
    throw new Error('LIBRETIME_API_KEY environment variable is required')
  }
  return {
    Authorization: `Api-Key ${LIBRETIME_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Check if we're running inside a Docker container
 */
function isInsideDocker(): boolean {
  // Check for CONTAINER or CONTAINER_TYPE env vars (set by docker compose run)
  if (process.env.CONTAINER || process.env.CONTAINER_TYPE) {
    return true
  }
  
  try {
    const fs = require('fs')
    return (
      fs.existsSync('/.dockerenv') ||
      (fs.existsSync('/proc/1/cgroup') &&
        fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker'))
    )
  } catch {
    return false
  }
}

/**
 * Resolve LibreTime API URL based on runtime context
 * FORCES internal URL - no public URL fallback
 */
function resolveLibreTimeUrl(options: HydrateOptions): string {
  // CLI flag has highest priority
  if (options.libretimeUrl) {
    return options.libretimeUrl
  }

  // Always use internal URL from environment or default
  // This ensures we bypass Cloudflare and use internal network
  return process.env.LIBRETIME_API_URL || 'http://libretime-nginx-1:8080'
}

/**
 * Detect which LibreTime files endpoint is available
 */
async function detectFilesEndpoint(baseUrl: string): Promise<'v2' | 'legacy'> {
  if (!LIBRETIME_API_KEY) {
    throw new Error('LIBRETIME_API_KEY environment variable is required')
  }

  try {
    console.log(`🔍 Testing LibreTime v2 API at: ${baseUrl}/api/v2/files`)
    const response = await axios.get(`${baseUrl}/api/v2/files`, {
      headers: {
        Authorization: `Api-Key ${LIBRETIME_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    })

    if (response.status === 200) {
      console.log(`✅ Using LibreTime v2 API endpoint`)
      return 'v2'
    }
  } catch (error: any) {
    console.log(
      `⚠️  v2 API not available (${error.response?.status || error.code}), falling back to legacy`,
    )
  }

  console.log(`📡 Using LibreTime legacy API endpoint`)
  return 'legacy'
}

/**
 * Fetch LibreTime files by episodeId prefix using v2 API
 */
async function fetchLtFilesByPrefix(episodeId: string, baseUrl: string): Promise<LibreTimeFile[]> {
  console.log(`🔍 Searching LibreTime for files with prefix: ${episodeId}__`)

  try {
    const response = await axios.get(`${baseUrl}/api/v2/files?search=${episodeId}__`, {
      headers: ltHeaders(),
      timeout: 10000,
    })

    const files: LibreTimeFile[] = response.data
    console.log(`📡 Found ${files.length} files from API search`)

    // Filter to only include files that actually match the prefix
    const matchingFiles = files.filter((file) => {
      const filepath = file.filepath || file.name || ''
      const filename = filepath.split('/').pop() || ''
      return filename.startsWith(`${episodeId}__`)
    })

    console.log(`📡 Found ${matchingFiles.length} files actually matching prefix`)

    return matchingFiles
  } catch (error: any) {
    console.log(`⚠️  LibreTime API search failed: ${error.message}`)
    return []
  }
}

/**
 * Fetch LibreTime file by ID using v2 API
 */
async function fetchLtFileById(id: number, baseUrl: string): Promise<LibreTimeFile | null> {
  console.log(`🔍 Fetching LibreTime file by ID: ${id}`)

  try {
    const response = await axios.get(`${baseUrl}/api/v2/files/${id}`, {
      headers: ltHeaders(),
      timeout: 10000,
    })

    console.log(`✅ Retrieved file details for ID: ${id}`)
    return response.data
  } catch (error: any) {
    console.log(`⚠️  Failed to fetch file by ID ${id}: ${error.message}`)
    return null
  }
}

/**
 * Find an existing LT file by episodeId prefix using API-first approach.
 * Returns the *relative* path if exactly one match; otherwise undefined.
 */
async function findLibreTimeFileByPrefix(
  episodeId: string,
  baseUrl: string,
): Promise<string | undefined> {
  console.log(`🔍 Checking if file exists in LibreTime for episode: ${episodeId}`)

  const matches = await fetchLtFilesByPrefix(episodeId, baseUrl)

  if (matches.length === 0) {
    console.log(`📁 No existing file found in LibreTime for episode: ${episodeId}`)
    return undefined
  }

  if (matches.length > 1) {
    console.error(
      `❌ Multiple matches for prefix ${episodeId}__ in LibreTime:`,
      matches.map((m) => m.filepath || m.name),
    )
    throw new Error(`Multiple LibreTime files found for episode ${episodeId} - ambiguous result`)
  }

  const file = matches[0]
  console.log(`✅ Found existing LibreTime file: ${file.filepath || file.name} (ID: ${file.id})`)

  // Convert absolute path to relative path
  const absolutePath = file.filepath || file.name || ''
  const relativePath = absolutePath.startsWith(LIBRETIME_LIBRARY_ROOT)
    ? path.relative(LIBRETIME_LIBRARY_ROOT, absolutePath)
    : absolutePath

  return relativePath
}

/**
 * Hydrate episode with LibreTime data by re-fetching file details
 */
async function hydrateEpisodeWithLtData(
  episodeId: string,
  trackId: number,
  baseUrl: string,
): Promise<{ id: number; relativePath: string }> {
  console.log(`🔄 Hydrating episode ${episodeId} with LibreTime data for track ID: ${trackId}`)

  // Retry a few times if filepath is missing
  const maxRetries = 3
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const file = await fetchLtFileById(trackId, baseUrl)

    if (file && file.filepath) {
      const relativePath = file.filepath.startsWith(LIBRETIME_LIBRARY_ROOT)
        ? path.relative(LIBRETIME_LIBRARY_ROOT, file.filepath)
        : file.filepath

      console.log(`✅ Hydrated with filepath: ${relativePath}`)
      return { id: trackId, relativePath }
    }

    if (attempt < maxRetries) {
      console.log(`   Attempt ${attempt}: filepath missing, retrying...`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  // Last-ditch filesystem fallback
  console.log(`🔍 API retries exhausted, trying filesystem fallback...`)
  const fallbackPath = await findLibreTimeFileByPrefix(episodeId, baseUrl)
  if (fallbackPath) {
    console.log(`✅ Filesystem fallback found path: ${fallbackPath}`)
    return { id: trackId, relativePath: fallbackPath }
  }

  console.log(`⚠️  Warning: No filepath found via API or filesystem fallback`)
  return { id: trackId, relativePath: '' }
}

/**
 * Check for lockfile and create one if not exists
 */
async function acquireLock(): Promise<void> {
  try {
    await fs.access(LOCKFILE_PATH)
    throw new Error(`Lockfile exists at ${LOCKFILE_PATH} - another hydration may be running`)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Lockfile doesn't exist, create it
      await fs.writeFile(LOCKFILE_PATH, `${process.pid}\n${Date.now()}`)
      console.log(`🔒 LOCKFILE: Created lockfile at ${LOCKFILE_PATH}`)
    } else {
      throw error
    }
  }
}

/**
 * Remove lockfile
 */
async function releaseLock(): Promise<void> {
  try {
    await fs.unlink(LOCKFILE_PATH)
    console.log(`🔓 LOCKFILE: Released lockfile at ${LOCKFILE_PATH}`)
  } catch (error: any) {
    console.log(`⚠️  Could not remove lockfile: ${error.message}`)
  }
}

/**
 * Update LibreTime track name (track_title) via API
 */
async function updateLibreTimeTrackName(
  trackId: number,
  trackTitle: string,
  baseUrl: string,
): Promise<void> {
  console.log(`🔄 Updating LibreTime track ${trackId} name to: "${trackTitle}"`)

  if (!LIBRETIME_API_KEY) {
    throw new Error('LIBRETIME_API_KEY environment variable is required')
  }

  try {
    // Try v2 API first (PATCH /api/v2/files/{id})
    try {
      const response = await axios.patch(
        `${baseUrl}/api/v2/files/${trackId}`,
        { track_title: trackTitle },
        {
          headers: ltHeaders(),
          timeout: 10000,
        },
      )
      console.log(`✅ Updated track name via v2 API`)
      return
    } catch (v2Error: any) {
      // If v2 API fails, try legacy API
      console.log(`⚠️  v2 API update failed, trying legacy API: ${v2Error.message}`)
    }

    // Fallback to legacy API (if available)
    // Note: Legacy API may not support PATCH, so we log a warning
    console.log(`⚠️  Legacy API may not support track name updates`)
  } catch (error: any) {
    // Non-fatal: track name update is nice-to-have, not critical
    console.log(`⚠️  Could not update track name: ${error.message}`)
  }
}

/**
 * Upload file to LibreTime via HTTP API (v2 endpoint)
 * Uses internal network URL to avoid Cloudflare blocking
 * Returns the track ID if available, or null
 */
async function uploadFileToLibreTime(
  filePath: string,
  baseUrl: string,
  episodeTitle?: string,
): Promise<number | null> {
  console.log(`🎧 Uploading to LibreTime via HTTP: ${filePath}`)

  if (!LIBRETIME_API_KEY) {
    throw new Error('LIBRETIME_API_KEY environment variable is required')
  }

  try {
    const FormData = (await import('form-data')).default
    const form = new FormData()
    const fsSync = await import('fs')
    form.append('file', fsSync.createReadStream(filePath))

    // Force creator to be "DIA" to prevent artist folder creation
    form.append('creator', 'DIA')

    // Use legacy /rest/media endpoint (works with basic auth and internal URL)
    // This endpoint doesn't require the additional fields that v2 API needs
    const response = await axios.post(`${baseUrl}/rest/media`, form, {
      auth: { username: LIBRETIME_API_KEY, password: '' },
      headers: form.getHeaders(),
      timeout: 300000, // 5 minutes for large files
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })

    console.log(`✅ LibreTime HTTP upload completed (${response.status} ${response.statusText})`)
    
    // Return the track ID if available
    const trackId = response.data?.id || null
    
    // Update track name if we have episode title and track ID
    if (trackId && episodeTitle) {
      await updateLibreTimeTrackName(trackId, episodeTitle, baseUrl)
    }
    
    return trackId
  } catch (error: any) {
    if (error.response?.status === 400) {
      const errorDetails = error.response?.data
      console.error('❌ LibreTime 400 Bad Request:', JSON.stringify(errorDetails, null, 2))
      throw new Error(`LibreTime upload failed (400): ${JSON.stringify(errorDetails)}`)
    }
    if (error.response?.status === 401) {
      throw new Error('LibreTime authentication failed (401) - check LIBRETIME_API_KEY')
    }
    if (error.response?.status === 403) {
      throw new Error('LibreTime access forbidden (403) - check API key permissions')
    }
    if (error.response?.status === 413) {
      throw new Error(
        'File too large for upload (413) - internal nginx limit (client_max_body_size)',
      )
    }
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      throw new Error(
        `Cannot connect to LibreTime API (${error.code}) - check internal URL: ${baseUrl}`,
      )
    }
    throw new Error(`LibreTime HTTP upload failed: ${error.message}`)
  }
}

/**
 * Upload multiple files to LibreTime via HTTP API (one at a time)
 * Returns a map of file paths to track IDs
 * episodeMap: Map of file paths to episode objects (for track title)
 */
async function uploadFilesToLibreTime(
  filePaths: string[],
  baseUrl: string,
  episodeMap?: Map<string, PayloadEpisode>,
): Promise<Map<string, number | null>> {
  console.log(`🎧 Uploading ${filePaths.length} files to LibreTime via HTTP`)

  const trackIds = new Map<string, number | null>()

  // Acquire lockfile for concurrency safety
  await acquireLock()

  try {
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i]
      console.log(`📤 Uploading file ${i + 1}/${filePaths.length}: ${path.basename(filePath)}`)
      
      // Get episode title if available
      const episode = episodeMap?.get(filePath)
      const episodeTitle = episode?.title
      
      const trackId = await uploadFileToLibreTime(filePath, baseUrl, episodeTitle)
      trackIds.set(filePath, trackId)
      if (trackId) {
        console.log(`   ✅ Uploaded with track ID: ${trackId}`)
        if (episodeTitle) {
          console.log(`   ✅ Track name set to: "${episodeTitle}"`)
        }
      }
    }

    console.log(`✅ All ${filePaths.length} files uploaded successfully`)
  } finally {
    // Always release lockfile
    await releaseLock()
  }

  return trackIds
}

/**
 * Discover candidate MP3 files in inbox directory
 */
async function discoverCandidateFiles(inboxPath: string): Promise<string[]> {
  console.log(`📁 Scanning inbox directory: ${inboxPath}`)

  try {
    const files = await fs.readdir(inboxPath)
    const mp3Files = files
      .filter((file) => file.endsWith('.mp3'))
      .map((file) => path.join(inboxPath, file))

    console.log(`📋 Found ${mp3Files.length} MP3 files in inbox`)
    return mp3Files
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log(`⚠️  Inbox directory does not exist: ${inboxPath}`)
      return []
    }
    throw error
  }
}

/**
 * Extract episode IDs from file paths using regex pattern
 */
function extractEpisodeIds(files: string[]): string[] {
  const episodeIds: string[] = []
  const seen = new Set<string>()

  for (const filePath of files) {
    const fileName = path.basename(filePath)
    // Match pattern: {episodeId}__...
    const match = fileName.match(/^([a-f0-9]{24})__/)

    if (match) {
      const episodeId = match[1]
      if (!seen.has(episodeId)) {
        episodeIds.push(episodeId)
        seen.add(episodeId)
      }
    } else {
      console.log(`⚠️  Skipping file with invalid pattern: ${fileName}`)
    }
  }

  console.log(`📋 Extracted ${episodeIds.length} unique episode IDs`)
  return episodeIds
}

/**
 * Fetch episodes from Payload API
 */
async function fetchEpisodesFromPayload(episodeIds: string[]): Promise<PayloadEpisode[]> {
  console.log(`📡 Fetching ${episodeIds.length} episodes from Payload`)

  const episodes: PayloadEpisode[] = []

  // Fetch in batches to avoid overwhelming the API
  const batchSize = 50
  for (let i = 0; i < episodeIds.length; i += batchSize) {
    const batch = episodeIds.slice(i, i + batchSize)

    await Promise.all(
      batch.map(async (episodeId) => {
        try {
          const response = await axios.get(`${PAYLOAD_API_URL}/api/episodes/${episodeId}`, {
            headers: buildPayloadAuthHeaders(),
            timeout: 10000,
          })

          episodes.push(response.data)
        } catch (error: any) {
          if (error.response?.status === 404) {
            console.log(`⚠️  Episode ${episodeId} not found in Payload`)
          } else if (error.response?.status === 403) {
            console.error(`❌ Failed to fetch episode ${episodeId}: 403 Forbidden - API key may not have read access`)
            if (error.response?.data) {
              console.error(`   Error details: ${JSON.stringify(error.response.data)}`)
            }
          } else {
            console.error(`❌ Failed to fetch episode ${episodeId}: ${error.message}`)
            if (error.response?.data) {
              console.error(`   Error details: ${JSON.stringify(error.response.data)}`)
            }
          }
        }
      }),
    )
  }

  console.log(`✅ Fetched ${episodes.length} episodes from Payload`)
  return episodes
}

/**
 * Filter episodes by eligibility criteria
 */
function filterEligibleEpisodes(episodes: PayloadEpisode[]): PayloadEpisode[] {
  const eligible = episodes.filter((episode) => {
    // pendingReview must be false
    if (episode.pendingReview !== false) {
      return false
    }

    // airStatus must be 'draft'
    if (episode.airStatus !== 'draft') {
      return false
    }

    // libretimeTrackId is null OR libretimeFilepathRelative is null
    if (
      episode.libretimeTrackId !== null &&
      episode.libretimeTrackId !== undefined &&
      episode.libretimeFilepathRelative !== null &&
      episode.libretimeFilepathRelative !== undefined
    ) {
      return false
    }

    return true
  })

  console.log(`✅ Found ${eligible.length} eligible episodes (out of ${episodes.length} total)`)
  return eligible
}

/**
 * Update Payload episode with LibreTime track ID and filepath, and set airStatus to 'queued'
 */
async function updateEpisodeWithAirStatus(
  episodeId: string,
  libretimeData: { id: number; relativePath: string },
): Promise<void> {
  console.log(
    `🔗 Updating Payload episode ${episodeId} with LibreTime track ID: ${libretimeData.id} and filepath: ${libretimeData.relativePath}`,
  )

  try {
    // Update the episode with LT fields and airStatus
    const patchResponse = await axios.patch(
      `${PAYLOAD_API_URL}/api/episodes/${episodeId}`,
      {
        libretimeTrackId: libretimeData.id.toString(),
        libretimeFilepathRelative: libretimeData.relativePath,
        airStatus: 'queued',
      },
      {
        headers: buildPayloadAuthHeaders(),
        timeout: 10000,
      },
    )

    console.log(`✅ Payload episode updated: ${episodeId}`)
    console.log(`   LibreTime track ID: ${libretimeData.id}`)
    console.log(`   LibreTime filepath: ${libretimeData.relativePath}`)
    console.log(`   airStatus: queued`)
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(`Episode ${episodeId} not found in Payload`)
    }
    throw new Error(`Failed to update Payload episode: ${error.message}`)
  }
}

/**
 * Poll LibreTime until all episodes are hydrated or timeout
 */
async function pollUntilHydrated(
  episodeIds: string[],
  baseUrl: string,
  timeoutSeconds: number,
  pollIntervalSeconds: number,
  dryRun: boolean,
): Promise<Map<string, LibretimeData | null>> {
  console.log(
    `🔍 Starting polling for ${episodeIds.length} episodes (timeout: ${timeoutSeconds}s, interval: ${pollIntervalSeconds}s)`,
  )

  const results = new Map<string, LibretimeData | null>()
  const startTime = Date.now()
  const timeoutMs = timeoutSeconds * 1000

  // Initialize all episodes as not found
  for (const episodeId of episodeIds) {
    results.set(episodeId, null)
  }

  while (Date.now() - startTime < timeoutMs) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    console.log(`\n⏱️  Polling iteration (elapsed: ${elapsed}s)...`)

    let allHydrated = true

    for (const episodeId of episodeIds) {
      // Skip if already hydrated
      if (results.get(episodeId) !== null) {
        continue
      }

      try {
        const matches = await fetchLtFilesByPrefix(episodeId, baseUrl)

        if (matches.length > 0) {
          if (matches.length > 1) {
            console.error(
              `⚠️  Multiple matches for ${episodeId}, using first: ${matches.map((m) => m.id)}`,
            )
          }

          const trackId = matches[0].id
          const libretimeData = await hydrateEpisodeWithLtData(episodeId, trackId, baseUrl)

          if (libretimeData.relativePath) {
            results.set(episodeId, libretimeData)
            console.log(`✅ Episode ${episodeId} hydrated: trackId=${trackId}, path=${libretimeData.relativePath}`)

            // Update Payload if not dry-run
            if (!dryRun) {
              await updateEpisodeWithAirStatus(episodeId, libretimeData)
            } else {
              console.log(`🔍 DRY-RUN: Would update episode ${episodeId} with airStatus='queued'`)
            }
          } else {
            console.log(`⚠️  Episode ${episodeId} found but filepath missing, will retry`)
            allHydrated = false
          }
        } else {
          allHydrated = false
        }
      } catch (error: any) {
        console.error(`❌ Error checking episode ${episodeId}: ${error.message}`)
        allHydrated = false
      }
    }

    if (allHydrated) {
      console.log(`\n✅ All episodes hydrated!`)
      break
    }

    // Wait before next poll
    const remaining = timeoutMs - (Date.now() - startTime)
    if (remaining > 0) {
      const waitTime = Math.min(pollIntervalSeconds * 1000, remaining)
      console.log(`⏳ Waiting ${pollIntervalSeconds}s before next poll...`)
      await new Promise((resolve) => setTimeout(resolve, waitTime))
    }
  }

  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const hydratedCount = Array.from(results.values()).filter((r) => r !== null).length

  if (elapsed >= timeoutSeconds) {
    console.log(`\n⏱️  Timeout reached after ${elapsed}s`)
  }

  console.log(`📊 Polling complete: ${hydratedCount}/${episodeIds.length} episodes hydrated`)

  return results
}

/**
 * Parse command line arguments
 */
function parseArgs(): HydrateOptions {
  const args = process.argv.slice(2)
  const options: HydrateOptions = {}

  for (const arg of args) {
    if (arg.startsWith('--inbox=')) {
      options.inbox = arg.split('=')[1]
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10)
    } else if (arg.startsWith('--poll-seconds=')) {
      options.pollSeconds = parseInt(arg.split('=')[1], 10)
    } else if (arg.startsWith('--timeout-seconds=')) {
      options.timeoutSeconds = parseInt(arg.split('=')[1], 10)
    } else if (arg.startsWith('--libretime-url=')) {
      options.libretimeUrl = arg.split('=')[1]
    } else if (arg === '--dry-run') {
      options.dryRun = true
    }
  }

  return options
}

/**
 * Main function
 */
async function hydrateInbox(): Promise<void> {
  console.log('🎧 LibreTime Inbox Hydration Script')
  console.log('===================================')

  const options = parseArgs()

  const inboxPath = options.inbox || MEDIA_NEW_DIR
  const batchSize = options.batchSize || 50
  const pollSeconds = options.pollSeconds || 30
  const timeoutSeconds = options.timeoutSeconds || 1200
  const dryRun = options.dryRun || false

  if (dryRun) {
    console.log('🔍 DRY-RUN MODE: No actual changes will be made')
  }

  const stats = {
    discovered: 0,
    eligible: 0,
    hydrated: 0,
    skipped: 0,
    errors: 0,
  }

  try {
    // Step 1: Resolve LibreTime URL and detect endpoint
    const baseUrl = resolveLibreTimeUrl(options)
    console.log(`🌐 Resolved LibreTime URL: ${baseUrl}`)
    console.log(`🔍 Docker detection: ${isInsideDocker() ? 'inside Docker' : 'host'}`)
    console.log(`🔍 LIBRETIME_API_URL env: ${process.env.LIBRETIME_API_URL || 'not set'}`)
    console.log(`🔍 PAYLOAD_API_URL: ${PAYLOAD_API_URL}`)
    console.log(`🔍 PAYLOAD_API_KEY: ${PAYLOAD_API_KEY ? 'set' : 'not set'}`)
    console.log(`🔍 PAYLOAD_ADMIN_TOKEN: ${PAYLOAD_ADMIN_TOKEN ? 'set' : 'not set'}`)

    const endpointType = await detectFilesEndpoint(baseUrl)

    // Step 2: Discover candidate files
    const candidateFiles = await discoverCandidateFiles(inboxPath)
    stats.discovered = candidateFiles.length

    if (candidateFiles.length === 0) {
      console.log('✅ No candidate files found in inbox')
      return
    }

    // Step 3: Extract episode IDs
    const episodeIds = extractEpisodeIds(candidateFiles)

    if (episodeIds.length === 0) {
      console.log('⚠️  No valid episode IDs found in filenames')
      return
    }

    // Step 4: Fetch episodes from Payload
    const episodes = await fetchEpisodesFromPayload(episodeIds)

    // Step 5: Filter eligible episodes
    const eligibleEpisodes = filterEligibleEpisodes(episodes)
    stats.eligible = eligibleEpisodes.length

    if (eligibleEpisodes.length === 0) {
      console.log('✅ No eligible episodes found')
      return
    }

    const eligibleEpisodeIds = eligibleEpisodes.map((e) => e.id)

    // Step 6: Check which episodes need import
    const needsImport: string[] = []
    const alreadyInLibreTime: string[] = []
    
    for (const episodeId of eligibleEpisodeIds) {
      const existingRelative = await findLibreTimeFileByPrefix(episodeId, baseUrl)
      if (!existingRelative) {
        needsImport.push(episodeId)
      } else {
        console.log(`✅ Episode ${episodeId} already exists in LibreTime, will hydrate from existing`)
        alreadyInLibreTime.push(episodeId)
      }
    }

    // Step 7: Trigger import if needed
    if (needsImport.length > 0) {
      console.log(`📁 ${needsImport.length} episodes need import to LibreTime`)

      if (dryRun) {
        console.log('🔍 DRY-RUN: Would upload files to LibreTime via HTTP')
      } else {
        // Collect all files that need import
        const filesToImport: string[] = []
        for (const episodeId of needsImport) {
          const file = candidateFiles.find((f) => path.basename(f).startsWith(`${episodeId}__`))
          if (file) {
            filesToImport.push(file)
          } else {
            console.error(`❌ Could not find file for episode ${episodeId}`)
          }
        }

        if (filesToImport.length > 0) {
          // Build episode map for track title updates
          const episodeMap = new Map<string, PayloadEpisode>()
          for (const filePath of filesToImport) {
            const fileName = path.basename(filePath)
            const episodeIdMatch = fileName.match(/^([a-f0-9]{24})__/)
            if (episodeIdMatch) {
              const episodeId = episodeIdMatch[1]
              const episode = eligibleEpisodes.find((e) => e.id === episodeId)
              if (episode) {
                episodeMap.set(filePath, episode)
              }
            }
          }
          
          // Upload files via HTTP API (works from container, uses internal network)
          const uploadResults = await uploadFilesToLibreTime(filesToImport, baseUrl, episodeMap)
          
          // Try immediate hydration for files that got track IDs from upload
          for (const [filePath, trackId] of uploadResults.entries()) {
            if (trackId) {
              const fileName = path.basename(filePath)
              const episodeIdMatch = fileName.match(/^([a-f0-9]{24})__/)
              if (episodeIdMatch) {
                const episodeId = episodeIdMatch[1]
                console.log(`🔄 Attempting immediate hydration for ${episodeId} using track ID ${trackId}`)
                try {
                  const libretimeData = await hydrateEpisodeWithLtData(episodeId, trackId, baseUrl)
                  if (libretimeData.relativePath) {
                    if (!dryRun) {
                      await updateEpisodeWithAirStatus(episodeId, libretimeData)
                    } else {
                      console.log(`🔍 DRY-RUN: Would update episode ${episodeId} with airStatus='queued'`)
                    }
                    stats.hydrated++
                    console.log(`✅ Episode ${episodeId} hydrated immediately after upload`)
                    // Remove from needsImport so we don't poll for it
                    const index = needsImport.indexOf(episodeId)
                    if (index > -1) {
                      needsImport.splice(index, 1)
                    }
                  } else {
                    console.log(`⚠️  Track ID ${trackId} found but filepath not ready yet, will poll`)
                  }
                } catch (error: any) {
                  console.log(`⚠️  Immediate hydration failed for ${episodeId}, will poll: ${error.message}`)
                }
              }
            }
          }
        } else {
          throw new Error('No files found to import')
        }
      }
    }

    // Step 8: Hydrate episodes that already exist in LibreTime (immediate hydration)
    for (const episodeId of alreadyInLibreTime) {
      try {
        const matches = await fetchLtFilesByPrefix(episodeId, baseUrl)
        if (matches.length > 0) {
          const trackId = matches[0].id
          const libretimeData = await hydrateEpisodeWithLtData(episodeId, trackId, baseUrl)
          
          if (libretimeData.relativePath) {
            if (!dryRun) {
              await updateEpisodeWithAirStatus(episodeId, libretimeData)
            } else {
              console.log(`🔍 DRY-RUN: Would update episode ${episodeId} with airStatus='queued'`)
            }
            stats.hydrated++
            console.log(`✅ Episode ${episodeId} hydrated from existing LibreTime file`)
          }
        }
      } catch (error: any) {
        console.error(`❌ Error hydrating existing episode ${episodeId}: ${error.message}`)
        stats.errors++
      }
    }

    // Step 9: Poll until hydrated for episodes that needed import
    const episodesToPoll = needsImport // Only poll episodes that needed import
    let hydrationResults = new Map<string, LibretimeData | null>()
    
    if (episodesToPoll.length > 0) {
      hydrationResults = await pollUntilHydrated(
        episodesToPoll,
        baseUrl,
        timeoutSeconds,
        pollSeconds,
        dryRun,
      )
    } else {
      console.log('✅ All episodes already existed in LibreTime and have been hydrated')
    }

    // Step 10: Report statistics (update from polling results)
    for (const [episodeId, result] of hydrationResults.entries()) {
      if (result !== null) {
        stats.hydrated++
      } else {
        stats.errors++
      }
    }

    console.log('\n📊 Summary:')
    console.log(`   Discovered files: ${stats.discovered}`)
    console.log(`   Eligible episodes: ${stats.eligible}`)
    console.log(`   Hydrated: ${stats.hydrated}`)
    console.log(`   Skipped: ${stats.skipped}`)
    console.log(`   Errors: ${stats.errors}`)

    if (stats.hydrated > 0) {
      console.log('\n🎉 Inbox hydration completed successfully!')
    } else if (stats.errors > 0) {
      console.log('\n⚠️  Some episodes failed to hydrate (check logs above)')
    }
  } catch (error: any) {
    console.error('\n❌ Inbox hydration failed:', error.message)
    throw error
  }
}

// Run the script if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  hydrateInbox()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error('Fatal error:', error)
      process.exit(1)
    })
}

export { hydrateInbox }

