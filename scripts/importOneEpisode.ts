import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { glob } from 'glob'
import { exec } from 'child_process'
import { promisify } from 'util'
import axios from 'axios'
import FormData from 'form-data'
import ffmpeg from '@ffmpeg-installer/ffmpeg'

const execAsync = promisify(exec)

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

  // Environment variable has second priority, but only if running inside Docker
  // When running from host, we need localhost regardless of env var
  if (process.env.LIBRETIME_API_URL && isInsideDocker()) {
    return process.env.LIBRETIME_API_URL
  }

  // Default based on runtime context
  if (isInsideDocker()) {
    return 'http://libretime-nginx-1:8080'
  } else {
    return 'http://localhost:8080'
  }
}

// Environment variables
const LIBRETIME_CONTAINER_NAME = process.env.LIBRETIME_CONTAINER_NAME || 'libretime-web'
const MEDIA_NEW_DIR = process.env.MEDIA_NEW_DIR || '/srv/media/new'
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
 * Auto-detect episode ID from staging directory
 */
async function autoDetectEpisodeId(): Promise<string> {
  const stagingDir = '/srv/media/staging'

  try {
    const files = await fs.readdir(stagingDir)
    const mp3Files = files.filter((file) => file.endsWith('.mp3'))

    if (mp3Files.length === 0) {
      throw new Error(`No MP3 files found in ${stagingDir}`)
    }

    if (mp3Files.length > 1) {
      console.log(`⚠️  Warning: Multiple MP3 files found in staging:`)
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
    throw new Error(`Failed to auto-detect episode ID from staging directory: ${error.message}`)
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): ImportOptions {
  const args = process.argv.slice(2)
  const options: ImportOptions = { episodeId: '' }

  for (const arg of args) {
    if (arg.startsWith('--episodeId=')) {
      options.episodeId = arg.split('=')[1]
    } else if (arg.startsWith('--file=')) {
      options.filePath = arg.split('=')[1]
    } else if (arg.startsWith('--ingest=')) {
      options.ingestMode = arg.split('=')[1] as 'http' | 'cli'
    } else if (arg.startsWith('--libretime-url=')) {
      options.libretimeUrl = arg.split('=')[1]
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

  // Check staging directory first
  const stagingDir = '/srv/media/staging'
  try {
    const stagingFiles = await fs.readdir(stagingDir)
    const stagingMp3 = stagingFiles.find((file) => file.endsWith('.mp3'))
    if (stagingMp3) {
      const stagingPath = path.join(stagingDir, stagingMp3)
      console.log(`📁 Found staging file: ${stagingPath}`)
      return stagingPath
    }
  } catch {
    // Staging directory doesn't exist or is empty, continue with normal search
  }

  console.log(`🔍 Searching for audio file with episode ID: ${episodeId}`)
  const pattern = path.join(MEDIA_NEW_DIR, `${episodeId}__*.mp3`)
  const matches = await glob(pattern)

  if (matches.length === 0) {
    throw new Error(`No audio file found for episode ${episodeId} in ${MEDIA_NEW_DIR}`)
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
 * Upload file to LibreTime via HTTP API
 */
async function uploadFileToLibreTime(filePath: string): Promise<void> {
  console.log(`🎧 Uploading to LibreTime via HTTP: ${filePath}`)

  if (!LIBRETIME_API_KEY) {
    throw new Error('LIBRETIME_API_KEY environment variable is required')
  }

  try {
    const form = new FormData()
    const fsSync = await import('fs')
    form.append('file', fsSync.createReadStream(filePath))

    // Force creator to be "DIA" to prevent artist folder creation
    form.append('creator', 'DIA')

    const response = await axios.post(`${LIBRETIME_API_URL}/api/v2/files`, form, {
      headers: {
        Authorization: `Api-Key ${LIBRETIME_API_KEY}`,
        ...form.getHeaders(),
      },
      timeout: 300000, // 5 minutes for large files
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })

    console.log(`✅ LibreTime HTTP upload completed (${response.status} ${response.statusText})`)
  } catch (error: any) {
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
        `Cannot connect to LibreTime API (${error.code}) - check internal URL: ${LIBRETIME_API_URL}`,
      )
    }
    throw new Error(`LibreTime HTTP upload failed: ${error.message}`)
  }
}

/**
 * Check if MP3 file has Artist/Album metadata
 */
async function hasArtistAlbumMetadata(filePath: string): Promise<boolean> {
  try {
    const command = `"${ffmpeg.path}" -i "${filePath}" -f null - 2>&1 | grep -E "(artist|album)" || echo "no metadata"`
    const { stdout } = await execAsync(command)
    const hasMetadata = !stdout.includes('no metadata') && stdout.toLowerCase().includes('artist')
    console.log(
      `🔍 File metadata check: ${hasMetadata ? 'Has Artist/Album metadata' : 'No Artist/Album metadata'}`,
    )
    return hasMetadata
  } catch (error: any) {
    console.log(`⚠️  Could not check metadata, assuming it needs stripping: ${error.message}`)
    return true // Assume it needs stripping if we can't check
  }
}

/**
 * Strip Artist/Album metadata from MP3 file to prevent LibreTime from using it as creator
 */
async function stripMetadata(filePath: string): Promise<string> {
  console.log(`🧹 Checking metadata in: ${filePath}`)

  // First check if file has Artist/Album metadata
  const hasMetadata = await hasArtistAlbumMetadata(filePath)

  if (!hasMetadata) {
    console.log(`✅ No Artist/Album metadata found, skipping strip phase`)
    return filePath
  }

  console.log(`🧹 Stripping Artist/Album metadata from: ${filePath}`)
  const tempPath = filePath.replace('.mp3', '_temp.mp3')

  try {
    // Use installed ffmpeg binary to remove only Artist and Album metadata
    const command = `"${ffmpeg.path}" -i "${filePath}" -metadata artist="" -metadata album="" -c copy "${tempPath}" -y`
    console.log(`📤 Executing: ${command}`)
    const { stdout, stderr } = await execAsync(command)

    if (stderr && !stderr.includes('Deprecated')) {
      console.log('📤 ffmpeg stderr:', stderr.trim())
    }

    // Replace original file with cleaned version
    await fs.unlink(filePath)
    await fs.rename(tempPath, filePath)

    console.log(`✅ Artist/Album metadata removed from original file: ${filePath}`)
    return filePath
  } catch (error: any) {
    console.log(`⚠️  Failed to strip metadata, using original file: ${error.message}`)
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath)
    } catch {
      // Ignore cleanup errors
    }
    return filePath
  }
}

/**
 * Execute bulk import in LibreTime container (CLI mode)
 */
async function bulkImportToLibreTime(filePath: string): Promise<void> {
  console.log(`🎧 Importing to LibreTime via CLI: ${filePath}`)

  // Strip Artist/Album metadata first to prevent LibreTime from using embedded creator info
  const cleanFilePath = await stripMetadata(filePath)

  const fileDir = path.dirname(cleanFilePath)
  const fileName = path.basename(cleanFilePath)

  // Use the correct container name and bulk import approach
  const command = `docker exec libretime_api_1 libretime-api bulk_import --path "${fileDir}" --allowed-extensions "mp3"`

  try {
    console.log(`📤 Executing: ${command}`)
    const { stdout, stderr } = await execAsync(command)

    if (stdout) {
      console.log('📤 LibreTime import output:', stdout.trim())
    }

    if (stderr) {
      console.log('📤 LibreTime import stderr:', stderr.trim())
    }

    console.log('✅ LibreTime bulk import completed')
  } catch (error: any) {
    console.error('❌ CLI import failed:', error.message)
    throw new Error(`LibreTime bulk import failed: ${error.message}`)
  }
}

/**
 * Update LibreTime creator field to "DIA" after import
 */
async function updateLibreTimeCreator(fileName: string): Promise<void> {
  try {
    console.log(`🔄 Attempting to update LibreTime creator for: ${fileName}`)

    // Try to update creator via LibreTime database directly
    const updateCommand = `docker exec libretime_api_1 python3 -c "
import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'libretime.settings')
django.setup()

from libretime_api.models import File
try:
    # Find file by name and update creator
    files = File.objects.filter(filepath__icontains='${fileName}')
    for file in files:
        file.creator = 'DIA'
        file.save()
        print(f'Updated creator for file: {file.filepath}')
    print('Creator update completed')
except Exception as e:
    print(f'Error updating creator: {e}')
"`

    console.log(`📤 Executing creator update: ${updateCommand}`)
    const { stdout, stderr } = await execAsync(updateCommand)

    if (stdout) {
      console.log('📤 Creator update output:', stdout.trim())
    }
    if (stderr) {
      console.log('📤 Creator update stderr:', stderr.trim())
    }

    console.log(`✅ Creator update completed`)
  } catch (error: any) {
    console.log(`⚠️  Could not update creator: ${error.message}`)
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
 * Main import function
 */
async function importOneEpisode(): Promise<void> {
  console.log('🎧 LibreTime Episode Import Script')
  console.log('=====================================')

  const options = parseArgs()

  try {
    // Auto-detect episode ID if not provided
    if (!options.episodeId) {
      options.episodeId = await autoDetectEpisodeId()
    }

    // Step 1: Resolve LibreTime URL and detect endpoint
    const baseUrl = resolveLibreTimeUrl(options)
    console.log(`🌐 Resolved LibreTime URL: ${baseUrl}`)

    const endpointType = await detectFilesEndpoint(baseUrl)

    // Step 1.5: Check if a file already exists in LT by episodeId prefix (API-first)
    const audioFilePath = await resolveAudioFile(options.episodeId, options.filePath)
    const existingRelative = await findLibreTimeFileByPrefix(options.episodeId, baseUrl)

    if (existingRelative) {
      console.log(`✅ File already exists in LibreTime: ${existingRelative}`)
      console.log(`🔄 Skipping import, proceeding to hydration...`)

      // Get the track ID from the existing file
      const matches = await fetchLtFilesByPrefix(options.episodeId, baseUrl)
      if (matches.length === 1) {
        const trackId = matches[0].id
        const libretimeData = await hydrateEpisodeWithLtData(options.episodeId, trackId, baseUrl)
        await updatePayloadEpisode(options.episodeId, libretimeData, audioFilePath)
        console.log('\n🎉 Hydration completed successfully!')
        return
      }
    }

    console.log(`📁 File not found in LibreTime library, proceeding with import...`)

    // Step 2: Resolve audio file
    console.log(`📁 Resolved audio file: ${audioFilePath}`)

    // Step 3: Import to LibreTime (HTTP by default, CLI as fallback)
    if (options.ingestMode === 'http') {
      await uploadFileToLibreTime(audioFilePath)
    } else {
      await bulkImportToLibreTime(audioFilePath)
    }

    // Step 4: Poll for file in LibreTime
    const libretimeData = await pollLibreTimeFiles(options.episodeId, baseUrl, endpointType)

    // Step 5: Hydrate with fresh data from LibreTime API
    const hydratedData = await hydrateEpisodeWithLtData(
      options.episodeId,
      libretimeData.id,
      baseUrl,
    )

    // Store the actual LT path from hydration
    await updatePayloadEpisode(options.episodeId, hydratedData, audioFilePath)

    console.log('\n🎉 Import completed successfully!')
    console.log(`   Episode ID: ${options.episodeId}`)
    console.log(`   Audio file: ${audioFilePath}`)
    console.log(`   LibreTime track ID: ${hydratedData.id}`)
    console.log(`   LibreTime filepath: ${hydratedData.relativePath}`)
    console.log(`   Ingest mode: ${options.ingestMode}`)
  } catch (error: any) {
    console.error('\n❌ Import failed:', error.message)
    process.exit(1)
  }
}

// Run the script if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  importOneEpisode()
}

export { importOneEpisode }
