import 'dotenv/config'
import fs from 'fs/promises'
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

const LOCKFILE_PATH = '/tmp/lt-bulk-import-archives.lock'

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
  // Check for common Docker indicators
  try {
    const fs = require('fs')
    return (
      fs.existsSync('/.dockerenv') ||
      (fs.existsSync('/proc/1/cgroup') &&
        fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker'))
    )
  } catch {
    return !!process.env.CONTAINER
  }
}

/**
 * Resolve LibreTime API URL based on runtime context
 */
function resolveLibreTimeUrl(options: ImportOptions): string {
  // CLI flag has highest priority
  if (options.libretimeUrl) {
    return options.libretimeUrl
  }

  // Always use public URL when inside Docker (hardcoded for reliability)
  return 'https://schedule.diaradio.live'
}

// Environment variables
const LIBRETIME_CONTAINER_NAME = process.env.LIBRETIME_CONTAINER_NAME || 'libretime-web'
const MEDIA_TRACKS_DIR = process.env.MEDIA_TRACKS_DIR || '/srv/media/tracks'
const LIBRETIME_LIBRARY_ROOT = process.env.LIBRETIME_LIBRARY_ROOT || '/srv/media'
const LIBRETIME_API_URL = process.env.LIBRETIME_API_URL || 'http://api:9001'
const LIBRETIME_API_KEY = process.env.LIBRETIME_API_KEY
const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL || 'https://content.diaradio.live'
const PAYLOAD_ADMIN_TOKEN = process.env.PAYLOAD_ADMIN_TOKEN
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY
const PAYLOAD_AUTH_SLUG = process.env.PAYLOAD_AUTH_SLUG || 'users'

interface ImportOptions {
  episodeId: string
  filePath?: string
  ingestMode?: 'http' | 'cli'
  libretimeUrl?: string
  dryRun?: boolean
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
  title: string
  libretimeTrackId?: string
  libretimeFilepathRelative?: string
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
 * Auto-detect episode ID from media/tracks directory
 */
async function autoDetectEpisodeId(): Promise<string> {
  const mediaTracksDir = '/srv/media/tracks'

  try {
    const files = await fs.readdir(mediaTracksDir)
    const mp3Files = files.filter((file) => file.endsWith('.mp3'))

    if (mp3Files.length === 0) {
      throw new Error(`No MP3 files found in ${mediaTracksDir}`)
    }

    if (mp3Files.length > 1) {
      console.log(`⚠️  Warning: Multiple MP3 files found in media/tracks:`)
      mp3Files.forEach((file) => console.log(`   - ${file}`))
      console.log(`   Using first file: ${mp3Files[0]}`)
    }

    const fileName = mp3Files[0]
    // Extract episode ID from filename pattern: <episodeId>__<rest>.mp3
    const match = fileName.match(/^([^_]+)__/)

    if (!match) {
      throw new Error(
        `Cannot extract episode ID from filename: ${fileName}. Expected format: <episodeId>__<rest>.mp3`,
      )
    }

    const episodeId = match[1]
    console.log(`🔍 Auto-detected episode ID: ${episodeId} from file: ${fileName}`)
    return episodeId
  } catch (error: any) {
    throw new Error(
      `Failed to auto-detect episode ID from media/tracks directory: ${error.message}`,
    )
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): ImportOptions {
  const args = process.argv.slice(2)
  const options: ImportOptions = { episodeId: '' }

  for (const arg of args) {
    if (arg.startsWith('--episode-id=') || arg.startsWith('--episodeId=')) {
      options.episodeId = arg.split('=')[1]
    } else if (arg.startsWith('--file=')) {
      options.filePath = arg.split('=')[1]
    } else if (arg.startsWith('--ingest=')) {
      options.ingestMode = arg.split('=')[1] as 'http' | 'cli'
    } else if (arg.startsWith('--libretime-url=')) {
      options.libretimeUrl = arg.split('=')[1]
    } else if (arg === '--dry-run') {
      options.dryRun = true
    }
  }

  // Default to CLI ingest mode
  if (!options.ingestMode) {
    options.ingestMode = 'cli'
  }

  return options
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
 * Resolve the audio file for the episode
 */
async function resolveAudioFile(episodeId: string, filePath?: string): Promise<string> {
  if (filePath) {
    console.log(`📁 Using provided file path: ${filePath}`)
    await fs.access(filePath)
    return filePath
  }

  // Check media/tracks directory first
  const mediaTracksDir = '/srv/media/tracks'
  try {
    const mediaTracksFiles = await fs.readdir(mediaTracksDir)
    const mediaTracksMp3 = mediaTracksFiles.find((file) => file.endsWith('.mp3'))
    if (mediaTracksMp3) {
      const mediaTracksPath = path.join(mediaTracksDir, mediaTracksMp3)
      console.log(`📁 Found media/tracks file: ${mediaTracksPath}`)
      return mediaTracksPath
    }
  } catch {
    // Media/tracks directory doesn't exist or is empty, continue with normal search
  }

  console.log(`🔍 Searching for audio file with episode ID: ${episodeId}`)
  const pattern = path.join(MEDIA_TRACKS_DIR, `${episodeId}__*.mp3`)
  const matches = await glob(pattern)

  if (matches.length === 0) {
    throw new Error(`No audio file found for episode ${episodeId} in ${MEDIA_TRACKS_DIR}`)
  }

  if (matches.length > 1) {
    console.log(`⚠️  Warning: Multiple files found for episode ${episodeId}:`)
    matches.forEach((match) => console.log(`   - ${match}`))

    // Pick the newest file by modification time
    const fileStats = await Promise.all(
      matches.map(async (file) => ({
        file,
        mtime: (await fs.stat(file)).mtime,
      })),
    )

    const newest = fileStats.reduce((latest, current) =>
      current.mtime > latest.mtime ? current : latest,
    )

    console.log(`📁 Using newest file: ${newest.file}`)
    return newest.file
  }

  console.log(`📁 Found audio file: ${matches[0]}`)
  return matches[0]
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
 * Check for lockfile and create one if not exists
 */
async function acquireLock(): Promise<void> {
  try {
    await fs.access(LOCKFILE_PATH)
    throw new Error(`Lockfile exists at ${LOCKFILE_PATH} - another bulk import may be running`)
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
 * Perform single bulk import with concurrency safety
 */
async function performSingleBulkImport(directoryPath: string): Promise<void> {
  // Runtime assert: bulk_import called once
  if (global.bulkImportCalled) {
    throw new Error('bulk_import already called in this process - single-run safety violation')
  }
  global.bulkImportCalled = true

  console.log(`🎧 BULK_IMPORT_START: Performing single bulk import for directory: ${directoryPath}`)

  // Use internal nginx URL to bypass Cloudflare's 100MB upload limit
  const command = `docker exec -e LIBRETIME_PUBLIC_URL=http://nginx:8080 libretime-api-1 libretime-api bulk_import --path "${directoryPath}" --allowed-extensions "mp3"`

  try {
    console.log(`📤 Executing: ${command}`)
    const { stdout, stderr } = await execAsync(command)

    if (stdout) {
      console.log('📤 LibreTime import output:', stdout.trim())
    }

    if (stderr) {
      console.log('📤 LibreTime import stderr:', stderr.trim())
    }

    console.log('✅ BULK_IMPORT_DONE: LibreTime bulk import completed')
  } catch (error: any) {
    console.error('❌ CLI import failed:', error.message)
    throw new Error(`LibreTime bulk import failed: ${error.message}`)
  }
}

async function bulkImportToLibreTime(filePath: string): Promise<void> {
  console.log(`🎧 Importing to LibreTime via CLI: ${filePath}`)

  const fileDir = path.dirname(filePath)

  // Acquire lockfile for concurrency safety
  await acquireLock()

  try {
    // Skip metadata stripping for archive imports (already done by rename-media-in-place.ts)
    console.log(`🚀 ARCHIVE_IMPORT: Files pre-sanitized, proceeding to bulk import`)

    // Single bulk import for entire directory
    await performSingleBulkImport(fileDir)
  } finally {
    // Always release lockfile
    await releaseLock()
  }
}

/**
 * Poll LibreTime files API until the imported file appears with exponential backoff
 */
async function pollLibreTimeFiles(
  episodeId: string,
  baseUrl: string,
  endpointType: 'v2' | 'legacy',
): Promise<{ id: number; relativePath: string }> {
  console.log(`🔍 Polling LibreTime files for episode: ${episodeId}`)
  console.log(`📡 Using ${endpointType} endpoint at: ${baseUrl}`)

  if (!LIBRETIME_API_KEY) {
    throw new Error('LIBRETIME_API_KEY environment variable is required')
  }

  let delay = 1000 // Start with 1 second
  const maxDelay = 10000 // Cap at 10 seconds
  const totalTimeout = 90000 // 90 seconds total
  const startTime = Date.now()
  let foundFile: LibreTimeFile | null = null

  for (let attempt = 1; ; attempt++) {
    try {
      console.log(`   Attempt ${attempt} (${delay / 1000}s delay)...`)

      let files: LibreTimeFile[] = []

      if (endpointType === 'v2') {
        // Use v2 API
        const response = await axios.get(`${baseUrl}/api/v2/files?search=${episodeId}`, {
          headers: {
            Authorization: `Api-Key ${LIBRETIME_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        })
        files = response.data
      } else {
        // Use legacy API
        const response = await axios.get(
          `${baseUrl}/api/list-all-files/format/json/api_key/${LIBRETIME_API_KEY}`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        )
        files = response.data
      }

      // Look for file whose name or filepath starts with episodeId__
      const matchingFiles = files.filter(
        (file) =>
          (file.name && file.name.startsWith(`${episodeId}__`)) ||
          (file.filepath && file.filepath.includes(`${episodeId}__`)) ||
          (file.track_title && file.track_title.startsWith(`${episodeId}__`)),
      )

      if (matchingFiles.length > 0) {
        // If multiple matches, pick the latest created_at
        const latestFile = matchingFiles.reduce((latest, current) => {
          // Note: LibreTime API might not include created_at, so we'll use the first match for now
          // In a real implementation, you'd sort by created_at timestamp
          return current
        })

        const displayName = latestFile.name || latestFile.filepath || 'Unknown'
        console.log(`✅ Found LibreTime file: ${displayName} (ID: ${latestFile.id})`)

        // Convert absolute path to relative path
        const absolutePath = latestFile.filepath || latestFile.name || ''
        const relativePath = absolutePath.startsWith(LIBRETIME_LIBRARY_ROOT)
          ? path.relative(LIBRETIME_LIBRARY_ROOT, absolutePath)
          : absolutePath

        foundFile = latestFile

        // If filepath is missing, retry briefly to wait for LibreTime to finalize
        if (!relativePath || relativePath === '') {
          if (attempt <= 3) {
            console.log(`   Poll returned no filepath, retrying... (${attempt}/3)`)
            await new Promise((resolve) => setTimeout(resolve, 500))
            continue
          } else {
            console.log(`   Poll still missing filepath, will use filesystem fallback`)
          }
        }

        return { id: latestFile.id, relativePath }
      }

      console.log(`   No matching file found yet (${files.length} total files)`)

      // Check if we've exceeded total timeout
      if (Date.now() - startTime > totalTimeout) {
        throw new Error(
          `Timeout: Failed to find LibreTime file for episode ${episodeId} after ${totalTimeout / 1000}s`,
        )
      }

      // Exponential backoff with cap
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 1.5, maxDelay)
    } catch (error: any) {
      console.log(`   Attempt ${attempt} failed: ${error.message}`)

      // Check if we've exceeded total timeout
      if (Date.now() - startTime > totalTimeout) {
        throw new Error(
          `Timeout: Failed to find LibreTime file for episode ${episodeId} after ${totalTimeout / 1000}s`,
        )
      }

      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 1.5, maxDelay)
    }
  }
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
 * Update Payload episode with LibreTime track ID
 */
async function updatePayloadEpisode(
  episodeId: string,
  libretimeData: { id: number; relativePath: string },
  audioFilePath: string,
): Promise<void> {
  console.log(
    `🔗 Updating Payload episode ${episodeId} with LibreTime track ID: ${libretimeData.id} and filepath: ${libretimeData.relativePath}`,
  )

  // Authentication handled by buildPayloadAuthHeaders()

  try {
    // First, check if episode already has the same track ID
    const getResponse = await axios.get(`${PAYLOAD_API_URL}/api/episodes/${episodeId}`, {
      headers: buildPayloadAuthHeaders(),
      timeout: 10000,
    })

    const episode: PayloadEpisode = getResponse.data

    if (
      episode.libretimeTrackId === libretimeData.id.toString() &&
      episode.libretimeFilepathRelative === libretimeData.relativePath &&
      libretimeData.relativePath &&
      libretimeData.relativePath !== ''
    ) {
      console.log(
        '✅ Episode already has the same LibreTime track ID and filepath - no update needed',
      )
      return
    }

    // If we have track ID but missing/different filepath, force update
    if (
      episode.libretimeTrackId === libretimeData.id.toString() &&
      (!libretimeData.relativePath || libretimeData.relativePath === '')
    ) {
      console.log('🔧 PATCH forced because filepath missing/different')
    }

    // Update the episode
    const patchResponse = await axios.patch(
      `${PAYLOAD_API_URL}/api/episodes/${episodeId}`,
      {
        libretimeTrackId: libretimeData.id.toString(),
        libretimeFilepathRelative: libretimeData.relativePath,
      },
      {
        headers: buildPayloadAuthHeaders(),
        timeout: 10000,
      },
    )

    console.log(`✅ Payload episode updated: ${episode.title || episodeId}`)
    console.log(`   LibreTime track ID: ${libretimeData.id}`)
    console.log(`   LibreTime filepath: ${libretimeData.relativePath}`)
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(`Episode ${episodeId} not found in Payload`)
    }
    throw new Error(`Failed to update Payload episode: ${error.message}`)
  }
}

/**
 * Extract all episode IDs from files in the directory
 */
async function extractAllEpisodeIds(directoryPath: string): Promise<string[]> {
  try {
    const files = await fs.readdir(directoryPath)
    const mp3Files = files.filter((file) => file.endsWith('.mp3'))

    const episodeIds: string[] = []

    for (const fileName of mp3Files) {
      const match = fileName.match(/^([a-f0-9]{24})__/)
      if (match) {
        episodeIds.push(match[1])
      }
    }

    return episodeIds
  } catch (error: any) {
    console.error(`❌ Failed to extract episode IDs from directory: ${error.message}`)
    throw new Error(`Episode ID extraction failed: ${error.message}`)
  }
}

/**
 * Hydrate all episodes after bulk import
 */
async function hydrateAllEpisodes(directoryPath: string, baseUrl: string): Promise<void> {
  console.log('🔄 HYDRATE_ALL: Starting hydration of all episodes...')

  try {
    const episodeIds = await extractAllEpisodeIds(directoryPath)
    console.log(`📋 Found ${episodeIds.length} episodes to hydrate: ${episodeIds.join(', ')}`)

    let successCount = 0
    let errorCount = 0

    for (const episodeId of episodeIds) {
      try {
        console.log(`\n🔍 Processing episode: ${episodeId}`)

        // Check if episode already exists in LibreTime
        const existingRelative = await findLibreTimeFileByPrefix(episodeId, baseUrl)

        if (existingRelative) {
          console.log(`✅ File already exists in LibreTime: ${existingRelative}`)

          // Get the track ID from the existing file
          const matches = await fetchLtFilesByPrefix(episodeId, baseUrl)
          if (matches.length === 1) {
            const trackId = matches[0].id
            const libretimeData = await hydrateEpisodeWithLtData(episodeId, trackId, baseUrl)

            // Resolve audio file path for this episode
            const audioFilePath = await resolveAudioFile(episodeId)
            await updatePayloadEpisode(episodeId, libretimeData, audioFilePath)

            console.log(`✅ Episode ${episodeId} hydrated successfully`)
            console.log(`   LibreTime track ID: ${libretimeData.id}`)
            console.log(`   LibreTime filepath: ${libretimeData.relativePath}`)
            successCount++
          } else {
            console.log(`⚠️  Episode ${episodeId}: Multiple or no matches found`)
            errorCount++
          }
        } else {
          console.log(`⚠️  Episode ${episodeId}: No file found in LibreTime`)
          errorCount++
        }
      } catch (error: any) {
        console.error(`❌ Episode ${episodeId} hydration failed: ${error.message}`)
        errorCount++
      }
    }

    console.log(`\n🎉 HYDRATE_ALL completed!`)
    console.log(`   ✅ Successfully hydrated: ${successCount} episodes`)
    console.log(`   ❌ Failed to hydrate: ${errorCount} episodes`)
  } catch (error: any) {
    console.error(`❌ HYDRATE_ALL failed: ${error.message}`)
    throw error
  }
}

async function importBatchArchives(): Promise<void> {
  console.log('🎧 LibreTime Batch Archive Media Import Script')
  console.log('==============================================')

  const options = parseArgs()

  if (options.dryRun) {
    console.log('🔍 DRY-RUN MODE: No actual changes will be made')
  }

  try {
    // Step 1: Resolve LibreTime URL and detect endpoint
    const baseUrl = resolveLibreTimeUrl(options)
    console.log(`🌐 Resolved LibreTime URL: ${baseUrl}`)

    const endpointType = await detectFilesEndpoint(baseUrl)

    // Step 2: Get directory path (use tracks directory for archives)
    const directoryPath = '/srv/media/tracks'
    console.log(`📁 Processing directory: ${directoryPath}`)

    // Step 3: Check if we should skip import (all files already exist)
    const episodeIds = await extractAllEpisodeIds(directoryPath)
    console.log(`📋 Found ${episodeIds.length} episodes to process: ${episodeIds.join(', ')}`)

    let shouldImport = false
    for (const episodeId of episodeIds) {
      const existingRelative = await findLibreTimeFileByPrefix(episodeId, baseUrl)
      if (!existingRelative) {
        shouldImport = true
        break
      }
    }

    if (!shouldImport) {
      console.log(`✅ All files already exist in LibreTime, skipping import...`)
    } else {
      console.log(`📁 Some files not found in LibreTime library, proceeding with import...`)

      // Step 4: Import to LibreTime (CLI mode only)
      if (options.ingestMode === 'http') {
        console.log('⚠️  HTTP mode not supported for archive import, using CLI mode')
      }

      if (options.dryRun) {
        console.log('🔍 DRY-RUN: Would perform bulk import (metadata already sanitized)')
        return
      }

      // Use the first file as the trigger for bulk import
      const firstEpisodeId = episodeIds[0]
      const audioFilePath = await resolveAudioFile(firstEpisodeId)
      await bulkImportToLibreTime(audioFilePath)
    }

    // Step 5: Hydrate ALL episodes
    await hydrateAllEpisodes(directoryPath, baseUrl)

    console.log('\n🎉 Batch archive import completed successfully!')
    console.log(`   Processed directory: ${directoryPath}`)
    console.log(`   Episodes processed: ${episodeIds.length}`)
    console.log(`   Ingest mode: ${options.ingestMode}`)
  } catch (error: any) {
    console.error('\n❌ Batch archive import failed:', error.message)
    process.exit(1)
  }
}

// Run the script if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  importBatchArchives()
}

export { importBatchArchives }
