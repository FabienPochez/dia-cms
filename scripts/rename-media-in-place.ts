import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import NodeID3 from 'node-id3'
import payload from 'payload'

import { generateEpisodeFilename } from '../utils/generateEpisodeFilename.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../src/payload.config.ts')

interface RenameOptions {
  root: string
  dryRun: boolean
  limit: number
  mapFile?: string
}

interface FileMapping {
  source: string
  episodeId: string
  showSlug: string
  titleSlug: string
  episodeNumber: number
}

interface LogEntry {
  ts: string
  event: 'plan' | 'renamed' | 'skipped' | 'quarantine' | 'error'
  oldName: string
  newName?: string
  episodeId?: string
  showSlug?: string
  titleSlug?: string
  episodeNumber?: number
  id3Applied?: boolean
  artistCleared?: boolean
  albumCleared?: boolean
  reason: string
}

// Canonical pattern matcher
const CANONICAL_PATTERN = /^([a-f0-9]{24})__([^_]+)__([^_]+)__(\d+)\.(mp3|wav|aiff|m4a)$/i

function parseArgs(): RenameOptions {
  const args = process.argv.slice(2)
  const options: RenameOptions = {
    root: '',
    dryRun: false,
    limit: 0,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--root' && i + 1 < args.length) {
      options.root = args[i + 1]
      i++ // Skip next argument
    } else if (arg.startsWith('--root=')) {
      options.root = arg.split('=')[1]
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10) || 0
      i++ // Skip next argument
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10) || 0
    } else if (arg === '--map' && i + 1 < args.length) {
      options.mapFile = args[i + 1]
      i++ // Skip next argument
    } else if (arg.startsWith('--map=')) {
      options.mapFile = arg.split('=')[1]
    }
  }

  if (!options.root) {
    throw new Error('--root is required')
  }

  return options
}

async function loadMapping(mapFile: string): Promise<Map<string, FileMapping>> {
  const content = await fs.readFile(mapFile, 'utf-8')
  const extension = path.extname(mapFile).toLowerCase()

  if (extension === '.json') {
    const mappings: FileMapping[] = JSON.parse(content)
    return new Map(mappings.map((m) => [m.source, m]))
  } else if (extension === '.csv') {
    const lines = content.trim().split('\n')
    const _headers = lines[0].split(',').map((h) => h.trim())
    const mappings: FileMapping[] = lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim())
      return {
        source: values[0],
        episodeId: values[1],
        showSlug: values[2],
        titleSlug: values[3],
        episodeNumber: parseInt(values[4], 10),
      }
    })
    return new Map(mappings.map((m) => [m.source, m]))
  }

  throw new Error('Unsupported mapping file format. Use .json or .csv')
}

async function logEntry(entry: LogEntry): Promise<void> {
  const logDir = '/var/log/dia-import'
  const logFile = path.join(logDir, 'rename-media-in-place.jsonl')

  try {
    await fs.mkdir(logDir, { recursive: true })
    await fs.appendFile(logFile, JSON.stringify(entry) + '\n')
  } catch (error) {
    console.warn(`⚠️ Failed to write log: ${(error as Error).message}`)
  }
}

function isCanonical(filename: string): boolean {
  return CANONICAL_PATTERN.test(filename)
}

function extractTrackIdFromFilename(filename: string): number | null {
  const match = filename.match(/^track-(\d+)_.*\.(mp3|wav|aiff|m4a)$/i)
  return match ? parseInt(match[1], 10) : null
}

async function sanitizeId3(
  filePath: string,
  title: string,
  genre?: string,
): Promise<{ id3Applied: boolean; artistCleared: boolean; albumCleared: boolean }> {
  // Skip ID3 for non-MP3 files (M4A uses MP4 atoms, not ID3 tags)
  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.mp3') {
    console.log(`⏭️  Skipping ID3 for ${ext} file (not MP3)`)
    return {
      id3Applied: false,
      artistCleared: false,
      albumCleared: false,
    }
  }

  try {
    const tags = {
      title,
      genre: genre || undefined,
      artist: '', // Explicitly clear
      album: '', // Explicitly clear
    }

    const success = NodeID3.write(tags, filePath)
    if (!success) {
      throw new Error('Failed to write ID3 tags')
    }

    // Verify artist/album are cleared
    const readTags = NodeID3.read(filePath)
    const artistCleared = !readTags.artist || readTags.artist === ''
    const albumCleared = !readTags.album || readTags.album === ''

    return {
      id3Applied: true,
      artistCleared,
      albumCleared,
    }
  } catch (error) {
    console.warn(`⚠️ ID3 sanitization failed for ${filePath}: ${(error as Error).message}`)
    return {
      id3Applied: false,
      artistCleared: false,
      albumCleared: false,
    }
  }
}

async function quarantineFile(sourcePath: string, reason: string): Promise<void> {
  const quarantineDir = path.join(path.dirname(sourcePath), '_conflicts')
  await fs.mkdir(quarantineDir, { recursive: true })

  const filename = path.basename(sourcePath)
  const quarantinePath = path.join(quarantineDir, filename)

  // Handle name conflicts in quarantine
  let finalPath = quarantinePath
  let counter = 1
  while (
    await fs
      .access(finalPath)
      .then(() => true)
      .catch(() => false)
  ) {
    const ext = path.extname(filename)
    const base = path.basename(filename, ext)
    finalPath = path.join(quarantineDir, `${base}_${counter}${ext}`)
    counter++
  }

  await fs.rename(sourcePath, finalPath)
  console.log(
    `🚨 Quarantined: ${filename} → ${path.relative(quarantineDir, finalPath)} (${reason})`,
  )
}

async function processFile(
  filePath: string,
  mapping: Map<string, FileMapping>,
  options: RenameOptions,
): Promise<'renamed' | 'skipped' | 'quarantined'> {
  const filename = path.basename(filePath)

  // Skip if already canonical
  if (isCanonical(filename)) {
    await logEntry({
      ts: new Date().toISOString(),
      event: 'skipped',
      oldName: filename,
      reason: 'Already canonical',
    })
    console.log(`⏭️  Skipping canonical file: ${filename}`)
    return 'skipped'
  }

  // Try to extract track_id from filename
  const trackId = extractTrackIdFromFilename(filename)

  if (!trackId) {
    // Try mapping lookup for non-track files
    const mappingEntry = mapping.get(filename)
    if (mappingEntry) {
      // Use mapping data
      const newFilename = `${mappingEntry.episodeId}__${mappingEntry.showSlug}__${mappingEntry.titleSlug}__${mappingEntry.episodeNumber}${path.extname(filename)}`
      const newPath = path.join(path.dirname(filePath), newFilename)

      if (options.dryRun) {
        await logEntry({
          ts: new Date().toISOString(),
          event: 'plan',
          oldName: filename,
          newName: newFilename,
          episodeId: mappingEntry.episodeId,
          showSlug: mappingEntry.showSlug,
          titleSlug: mappingEntry.titleSlug,
          episodeNumber: mappingEntry.episodeNumber,
          reason: 'Dry run - would rename using mapping',
        })
        console.log(`🔍 Would rename: ${filename} → ${newFilename}`)
        return 'renamed' // In dry-run, count as "would be renamed"
      }

      // Process with mapping data
      const result = await processRename(filePath, newPath, mappingEntry.titleSlug, options)
      return result
    } else {
      await quarantineFile(filePath, 'Cannot resolve track_id or mapping')
      await logEntry({
        ts: new Date().toISOString(),
        event: 'quarantine',
        oldName: filename,
        reason: 'Cannot resolve track_id or mapping',
      })
      return 'quarantined'
    }
  }

  // Look up episode in Payload using track_id
  try {
    const { docs } = await payload.find({
      collection: 'episodes',
      where: { track_id: { equals: trackId } },
      limit: 1,
    })

    if (!docs.length) {
      await quarantineFile(filePath, `No episode found for track_id ${trackId}`)
      await logEntry({
        ts: new Date().toISOString(),
        event: 'quarantine',
        oldName: filename,
        reason: `No episode found for track_id ${trackId}`,
      })
      return 'quarantined'
    }

    const episode = docs[0]

    // Get show information
    let show = null
    if (episode.show) {
      if (typeof episode.show === 'object' && episode.show.id) {
        show = episode.show
      } else {
        try {
          show = await payload.findByID({ collection: 'shows', id: episode.show })
        } catch {
          console.warn(`⚠️ Show ${episode.show} not found for episode ${episode.id}.`)
        }
      }
    }

    // Generate canonical filename using the same logic as attach-media-to-episodes.ts
    const newFilename = generateEpisodeFilename({
      id: episode.id as string,
      show: show as any,
      title: episode.title || 'untitled',
      episodeNumber: episode.episodeNumber || 1,
    })

    const newPath = path.join(path.dirname(filePath), newFilename)

    // Check for conflicts
    try {
      await fs.access(newPath)
      await quarantineFile(filePath, 'Target file exists')
      await logEntry({
        ts: new Date().toISOString(),
        event: 'quarantine',
        oldName: filename,
        newName: newFilename,
        reason: 'Target file exists',
      })
      return 'quarantined'
    } catch {
      // Target doesn't exist, proceed
    }

    if (options.dryRun) {
      await logEntry({
        ts: new Date().toISOString(),
        event: 'plan',
        oldName: filename,
        newName: newFilename,
        episodeId: episode.id as string,
        showSlug: (show?.slug || show?.title || 'untitled') as string,
        titleSlug: episode.title || 'untitled',
        episodeNumber: episode.episodeNumber || 1,
        reason: 'Dry run - would rename and sanitize ID3',
      })
      console.log(`🔍 Would rename: ${filename} → ${newFilename}`)
      return 'renamed' // In dry-run, count as "would be renamed"
    }

    // Process the rename with episode data
    const result = await processRename(filePath, newPath, episode.title || 'untitled', options)
    return result
  } catch (error) {
    await quarantineFile(filePath, `Payload lookup failed: ${(error as Error).message}`)
    await logEntry({
      ts: new Date().toISOString(),
      event: 'quarantine',
      oldName: filename,
      reason: `Payload lookup failed: ${(error as Error).message}`,
    })
    return 'quarantined'
  }
}

async function processRename(
  filePath: string,
  newPath: string,
  title: string,
  _options: RenameOptions,
): Promise<'renamed' | 'quarantined'> {
  const filename = path.basename(filePath)
  const newFilename = path.basename(newPath)
  const ext = path.extname(filePath).toLowerCase()

  // Sanitize ID3 tags (only for MP3 files)
  const id3Result = await sanitizeId3(filePath, title)

  // Only fail if ID3 was attempted but failed (not if it was skipped for non-MP3)
  if (ext === '.mp3' && !id3Result.id3Applied) {
    await quarantineFile(filePath, 'ID3 sanitization failed')
    await logEntry({
      ts: new Date().toISOString(),
      event: 'quarantine',
      oldName: filename,
      newName: newFilename,
      reason: 'ID3 sanitization failed',
    })
    return 'quarantined'
  }

  // Rename file
  try {
    await fs.rename(filePath, newPath)

    await logEntry({
      ts: new Date().toISOString(),
      event: 'renamed',
      oldName: filename,
      newName: newFilename,
      id3Applied: id3Result.id3Applied,
      artistCleared: id3Result.artistCleared,
      albumCleared: id3Result.albumCleared,
      reason: id3Result.id3Applied
        ? 'Successfully renamed and sanitized'
        : 'Successfully renamed (ID3 skipped for non-MP3)',
    })

    console.log(`✅ Renamed: ${filename} → ${newFilename}`)
    if (id3Result.id3Applied) {
      console.log(`   ID3: title set, artist/album cleared`)
    } else {
      console.log(`   ID3: skipped (${ext} file)`)
    }
    return 'renamed'
  } catch (error) {
    await logEntry({
      ts: new Date().toISOString(),
      event: 'error',
      oldName: filename,
      newName: newFilename,
      reason: `Rename failed: ${(error as Error).message}`,
    })
    console.error(`❌ Failed to rename ${filename}: ${(error as Error).message}`)
    return 'quarantined'
  }
}

async function main(): Promise<void> {
  console.log('🎧 Media Rename In-Place Script')
  console.log('================================')

  const options = parseArgs()

  console.log(`📁 Root directory: ${options.root}`)
  console.log(`🔍 Dry run: ${options.dryRun}`)
  console.log(`📊 Limit: ${options.limit || 'unlimited'}`)

  // Initialize Payload
  const config = (await import(configPath)).default
  await payload.init({ local: true, config })

  // Load mapping if provided
  let mapping = new Map<string, FileMapping>()
  if (options.mapFile) {
    console.log(`📋 Loading mapping from: ${options.mapFile}`)
    mapping = await loadMapping(options.mapFile)
    console.log(`📋 Loaded ${mapping.size} mappings`)
  }

  // Scan directory for audio files
  const files = await fs.readdir(options.root)
  const audioFiles = files.filter((file) => {
    const ext = path.extname(file).toLowerCase()
    return ['.mp3', '.wav', '.aiff', '.m4a'].includes(ext)
  })

  console.log(`🔍 Found ${audioFiles.length} audio files`)

  let scanned = 0
  let renamed = 0
  let skipped = 0
  let quarantined = 0

  for (const file of audioFiles) {
    if (options.limit > 0 && scanned >= options.limit) {
      console.log(`⏹️  Reached limit of ${options.limit} files`)
      break
    }

    const filePath = path.join(options.root, file)
    const result = await processFile(filePath, mapping, options)
    scanned++

    if (result === 'renamed') renamed++
    else if (result === 'skipped') skipped++
    else if (result === 'quarantined') quarantined++
  }

  console.log(`\n🎉 Processing complete!`)
  console.log(`   Files scanned: ${scanned}`)
  console.log(`   Renamed: ${renamed}`)
  console.log(`   Skipped: ${skipped}`)
  console.log(`   Quarantined: ${quarantined}`)
  console.log(`   Dry run: ${options.dryRun}`)

  // Clean exit
  process.exit(0)
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Script failed:', error.message)
    process.exit(1)
  })
}

export { main }
