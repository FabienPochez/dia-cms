import dotenv from 'dotenv'
dotenv.config()

import payload from 'payload'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.resolve(__dirname, '../../src/payload.config.ts')

// ============================================================================
// CLI Arguments
// ============================================================================
const args = process.argv.slice(2)
const isDryRun = !args.includes('--apply')
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null
const skip = args.includes('--skip') ? parseInt(args[args.indexOf('--skip') + 1]) : 0

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize string for fuzzy matching (lowercase, remove dots/spaces/dashes)
 */
function normalizeForMatch(str: string): string {
  return str.toLowerCase().replace(/[.\s-]+/g, '').trim()
}

/**
 * Fuzzy match show title
 */
function fuzzyMatchShowTitle(titlePart: string, showTitle: string): boolean {
  return normalizeForMatch(titlePart) === normalizeForMatch(showTitle)
}

/**
 * Extract episode number from title
 * Returns: { number: string | null, cleaned: string }
 */
function extractEpisodeNumber(title: string): { number: string | null; cleaned: string } {
  let cleaned = title
  let number: string | null = null

  // Pattern 1: #24, # 24
  const hashMatch = title.match(/#\s*(\d+)/i)
  if (hashMatch) {
    number = hashMatch[1].padStart(3, '0')
    cleaned = cleaned.replace(/#\s*\d+/i, '')
  }

  // Pattern 2: ep16, episode 16, ep.16
  if (!number) {
    const epMatch = title.match(/ep(?:isode)?\.?\s*(\d+)/i)
    if (epMatch) {
      number = epMatch[1].padStart(3, '0')
      cleaned = cleaned.replace(/ep(?:isode)?\.?\s*\d+/i, '')
    }
  }

  // Pattern 3: (16) but only if not part of a date
  if (!number) {
    const parenMatch = title.match(/\((\d+)\)/)
    if (parenMatch) {
      // Check if it's part of a date pattern (e.g., (24.06.25))
      const isDate = /\(\d{2}\.\d{2}\.\d{2,4}\)/.test(title)
      if (!isDate) {
        number = parenMatch[1].padStart(3, '0')
        cleaned = cleaned.replace(/\(\d+\)/, '')
      }
    }
  }

  return { number, cleaned }
}

/**
 * Extract date from title
 * Returns: { date: Date | null, cleaned: string }
 */
function extractDate(title: string): { date: Date | null; cleaned: string } {
  let cleaned = title
  let date: Date | null = null

  // Pattern 1: (24.06.25) or (24:06:25) - European format DD.MM.YY or DD:MM:YY
  const euroShortMatch = title.match(/\((\d{2})[.:/-](\d{2})[.:/-](\d{2})\)/)
  if (euroShortMatch) {
    const day = parseInt(euroShortMatch[1])
    const month = parseInt(euroShortMatch[2])
    const year = 2000 + parseInt(euroShortMatch[3]) // Assume 20XX
    date = new Date(year, month - 1, day)
    cleaned = cleaned.replace(/\(\d{2}[.:/-]\d{2}[.:/-]\d{2}\)/, '')
  }

  // Pattern 2: (24.06.2025) or (24:06:2025) - European format DD.MM.YYYY or DD:MM:YYYY
  if (!date) {
    const euroLongMatch = title.match(/\((\d{2})[.:/-](\d{2})[.:/-](\d{4})\)/)
    if (euroLongMatch) {
      const day = parseInt(euroLongMatch[1])
      const month = parseInt(euroLongMatch[2])
      const year = parseInt(euroLongMatch[3])
      date = new Date(year, month - 1, day)
      cleaned = cleaned.replace(/\(\d{2}[.:/-]\d{2}[.:/-]\d{4}\)/, '')
    }
  }

  // Pattern 3: 24.06.25 or 24:06:25 (not in parens)
  if (!date) {
    const euroStandaloneMatch = title.match(/\b(\d{2})[.:/-](\d{2})[.:/-](\d{2})\b/)
    if (euroStandaloneMatch) {
      const day = parseInt(euroStandaloneMatch[1])
      const month = parseInt(euroStandaloneMatch[2])
      const year = 2000 + parseInt(euroStandaloneMatch[3])
      date = new Date(year, month - 1, day)
      cleaned = cleaned.replace(/\b\d{2}[.:/-]\d{2}[.:/-]\d{2}\b/, '')
    }
  }

  // Pattern 4: 2025-06-24 (ISO-style)
  if (!date) {
    const isoMatch = title.match(/\b(\d{4})[./-](\d{2})[./-](\d{2})\b/)
    if (isoMatch) {
      const year = parseInt(isoMatch[1])
      const month = parseInt(isoMatch[2])
      const day = parseInt(isoMatch[3])
      date = new Date(year, month - 1, day)
      cleaned = cleaned.replace(/\b\d{4}[./-]\d{2}[./-]\d{2}\b/, '')
    }
  }

  return { date, cleaned }
}

/**
 * Check if two dates differ (comparing only the date part, not time)
 */
function datesDiffer(date1: Date, date2: Date | string): boolean {
  const d1 = new Date(date1)
  const d2 = new Date(date2)
  return d1.toISOString().split('T')[0] !== d2.toISOString().split('T')[0]
}

/**
 * Normalize show title in episode title
 */
function normalizeShowTitle(title: string, canonicalShowTitle: string): string {
  // Split on first ' - ' to get show and host parts
  const parts = title.split(/\s+-\s+/)
  if (parts.length < 2) return title

  const [showPart, ...rest] = parts
  
  // Fuzzy match
  if (fuzzyMatchShowTitle(showPart, canonicalShowTitle)) {
    return [canonicalShowTitle, ...rest].join(' - ')
  }

  return title
}

/**
 * Replace first ' - ' with ' w/ '
 */
function normalizeSeparator(title: string): string {
  return title.replace(/\s+-\s+/, ' w/ ')
}

/**
 * Clean up title: trim, collapse spaces, remove empty parens, trailing dashes
 */
function cleanupTitle(title: string): string {
  return title
    .replace(/\(\s*\)/g, '') // Remove empty parens
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .replace(/\s*[-–—]\s*$/g, '') // Remove trailing dashes/hyphens
    .trim()
}

/**
 * Detect and extract tracklist from description
 */
function extractTracklist(description: string): {
  found: boolean
  tracklist: string
  cleanedDescription: string
} {
  if (!description) {
    return { found: false, tracklist: '', cleanedDescription: description }
  }

  const lines = description.split('\n')
  const trackPattern = /^[\u2022\-\*]?\s*[A-Za-zÀ-ÿ0-9\s"'.()]+\s*[-·—–]\s*.+$/

  // Find consecutive lines matching track pattern
  let trackBlocks: string[][] = []
  let currentBlock: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trackPattern.test(trimmed)) {
      currentBlock.push(trimmed)
    } else {
      if (currentBlock.length >= 3) {
        trackBlocks.push([...currentBlock])
      }
      currentBlock = []
    }
  }

  // Check last block
  if (currentBlock.length >= 3) {
    trackBlocks.push(currentBlock)
  }

  if (trackBlocks.length === 0) {
    return { found: false, tracklist: '', cleanedDescription: description }
  }

  // Use the largest block as tracklist
  const tracklist = trackBlocks.reduce((a, b) => (a.length > b.length ? a : b))
  const tracklistText = tracklist.join('\n')

  // Remove tracklist from description
  let cleanedDescription = description
  for (const track of tracklist) {
    cleanedDescription = cleanedDescription.replace(track, '')
  }

  return {
    found: true,
    tracklist: tracklistText,
    cleanedDescription,
  }
}

/**
 * Clean description: remove social links, excess whitespace
 */
function cleanDescription(description: string): string {
  if (!description) return description

  let cleaned = description

  // Remove lines with social media patterns
  const socialPatterns = [
    /^.*https?:\/\/.*$/gim, // Lines with URLs
    /^.*(instagram|facebook|twitter|soundcloud|bandcamp|linktree).*$/gim,
    /^.*(follow us|check out|listen on|subscribe).*$/gim,
  ]

  for (const pattern of socialPatterns) {
    cleaned = cleaned.replace(pattern, '')
  }

  // Collapse multiple newlines to max 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')

  // Trim
  cleaned = cleaned.trim()

  return cleaned
}

/**
 * Normalize a single episode
 */
function normalizeEpisode(episode: any) {
  const changes: any = {}
  const actions: string[] = []

  let title = episode.title || ''
  let description = episode.description || ''

  // Extract episode number
  const epNumResult = extractEpisodeNumber(title)
  if (epNumResult.number && (!episode.episodeNumber || episode.episodeNumber !== epNumResult.number)) {
    changes.episodeNumber = epNumResult.number
    title = epNumResult.cleaned
    actions.push('extract_episode_num')
  }

  // Extract date
  const dateResult = extractDate(title)
  if (dateResult.date) {
    // Always remove date from title
    title = dateResult.cleaned
    
    // Update publishedAt if empty or different
    const shouldUpdate = !episode.publishedAt || datesDiffer(dateResult.date, episode.publishedAt)
    if (shouldUpdate) {
      changes.publishedAt = dateResult.date.toISOString()
      actions.push('extract_date')
    } else {
      // Date removed from title but publishedAt already correct
      actions.push('remove_date')
    }
  }

  // Normalize show title
  if (episode.show && typeof episode.show === 'object' && episode.show.title) {
    const normalizedTitle = normalizeShowTitle(title, episode.show.title)
    if (normalizedTitle !== title) {
      title = normalizedTitle
      actions.push('fix_show_title')
    }
  }

  // Normalize separator
  const separatorNormalized = normalizeSeparator(title)
  if (separatorNormalized !== title) {
    title = separatorNormalized
    actions.push('normalize_separator')
  }

  // Cleanup title
  title = cleanupTitle(title)

  if (title !== episode.title) {
    changes.title = title
  }

  // Extract tracklist
  const tracklistResult = extractTracklist(description)
  if (tracklistResult.found && !episode.tracklistRaw) {
    changes.tracklistRaw = tracklistResult.tracklist
    description = tracklistResult.cleanedDescription
    actions.push('extract_tracklist')
  }

  // Clean description
  const cleanedDesc = cleanDescription(description)
  if (cleanedDesc !== episode.description) {
    changes.description = cleanedDesc
    actions.push('clean_description')
  }

  return { changes, actions }
}

// ============================================================================
// Main Script
// ============================================================================

async function run() {
  console.log('🔧 Episode Cleanup & Normalization Script')
  console.log('==========================================')
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (no changes will be made)' : 'APPLY (will update database)'}`)
  console.log(`Limit: ${limit || 'all'}`)
  console.log(`Skip: ${skip}`)
  console.log()

  const config = (await import(configPath)).default

  await payload.init({
    secret: process.env.PAYLOAD_SECRET!,
    local: true,
    config,
  })

  // Ensure logs directory exists
  const logsDir = path.resolve(__dirname, '../../logs')
  await fs.mkdir(logsDir, { recursive: true })

  // Fetch episodes (excluding submitted)
  console.log('📚 Fetching episodes...')
  
  let allEpisodes: any[] = []
  let page = 1
  let hasMore = true
  const pageSize = 1000

  while (hasMore) {
    const result = await payload.find({
      collection: 'episodes',
      where: {
        publishedStatus: {
          not_equals: 'submitted',
        },
      },
      depth: 1, // Populate show relationship
      limit: pageSize,
      page,
    })

    allEpisodes = allEpisodes.concat(result.docs)
    hasMore = result.hasNextPage
    page++
    
    if (limit && allEpisodes.length >= skip + limit) {
      allEpisodes = allEpisodes.slice(skip, skip + limit)
      break
    }
  }

  // Apply skip and limit
  if (!limit) {
    allEpisodes = allEpisodes.slice(skip)
  }

  console.log(`✅ Found ${allEpisodes.length} episodes to process (after filters)`)
  console.log()

  // Process episodes
  const diffResults: any[] = []
  let stats = {
    scanned: 0,
    showTitlesNormalized: 0,
    episodeNumbersExtracted: 0,
    datesExtracted: 0,
    datesUpdated: 0,
    datesRemoved: 0,
    separatorsNormalized: 0,
    descriptionsChanged: 0,
    tracklistsExtracted: 0,
    noChanges: 0,
  }

  console.log('🔄 Processing episodes...')
  
  for (let i = 0; i < allEpisodes.length; i++) {
    const episode = allEpisodes[i]
    stats.scanned++

    if (i > 0 && i % 100 === 0) {
      console.log(`📊 Progress: ${i}/${allEpisodes.length} episodes processed`)
    }

    try {
      const { changes, actions } = normalizeEpisode(episode)

      if (Object.keys(changes).length === 0) {
        stats.noChanges++
        continue
      }

      // Update stats
      if (actions.includes('fix_show_title')) stats.showTitlesNormalized++
      if (actions.includes('extract_episode_num')) stats.episodeNumbersExtracted++
      if (actions.includes('extract_date')) {
        if (episode.publishedAt) {
          stats.datesUpdated++
        } else {
          stats.datesExtracted++
        }
      }
      if (actions.includes('remove_date')) stats.datesRemoved++
      if (actions.includes('normalize_separator')) stats.separatorsNormalized++
      if (actions.includes('clean_description')) stats.descriptionsChanged++
      if (actions.includes('extract_tracklist')) stats.tracklistsExtracted++

      // Build diff result
      const diffResult: any = {
        id: episode.id,
        publishedStatus: episode.publishedStatus,
        show: episode.show ? { id: episode.show.id, title: episode.show.title } : null,
        changes: {},
        actions,
      }

      if (changes.title) {
        diffResult.changes.title = {
          old: episode.title,
          new: changes.title,
        }
      }

      if (changes.episodeNumber) {
        diffResult.changes.episodeNumber = {
          old: episode.episodeNumber || null,
          new: changes.episodeNumber,
        }
      }

      if (changes.publishedAt) {
        diffResult.changes.publishedAt = {
          old: episode.publishedAt || null,
          new: changes.publishedAt,
          changed: !!episode.publishedAt,
        }
      }

      if (changes.description) {
        diffResult.changes.description = {
          changed: true,
          summary: 'Description cleaned',
        }
      }

      if (changes.tracklistRaw) {
        const trackCount = changes.tracklistRaw.split('\n').length
        diffResult.changes.tracklistRaw = {
          extracted: trackCount,
          preview: changes.tracklistRaw.substring(0, 100) + (changes.tracklistRaw.length > 100 ? '...' : ''),
        }
      }

      diffResults.push(diffResult)

      // Apply changes if not dry-run
      if (!isDryRun) {
        await payload.update({
          collection: 'episodes',
          id: episode.id,
          data: changes,
          overrideAccess: true,
          context: {
            skipSlugRegeneration: true, // Signal to hook to preserve slug
          },
        })
      }
    } catch (error: any) {
      console.error(`❌ Error processing episode ${episode.id}:`, error.message)
    }
  }

  console.log()
  console.log('✅ Processing complete!')
  console.log()

  // Print summary
  console.log('📊 Summary:')
  console.log(`   - Episodes scanned: ${stats.scanned}`)
  console.log(`   - Show titles normalized: ${stats.showTitlesNormalized}`)
  console.log(`   - Episode numbers extracted: ${stats.episodeNumbersExtracted}`)
  console.log(`   - Dates extracted (new): ${stats.datesExtracted}`)
  console.log(`   - Dates updated (changed): ${stats.datesUpdated}`)
  console.log(`   - Dates removed from titles: ${stats.datesRemoved}`)
  console.log(`   - Separators normalized: ${stats.separatorsNormalized}`)
  console.log(`   - Descriptions cleaned: ${stats.descriptionsChanged}`)
  console.log(`   - Tracklists extracted: ${stats.tracklistsExtracted}`)
  console.log(`   - No changes needed: ${stats.noChanges}`)
  console.log()

  // Write logs
  if (diffResults.length > 0) {
    const timestamp = new Date().toISOString().split('T')[0]
    const csvPath = path.join(logsDir, `episode-cleanup.${timestamp}.csv`)
    const jsonPath = path.join(logsDir, `episode-cleanup.${timestamp}.json`)

    // Generate CSV
    const csvLines = [
      'id,showTitle,publishedStatus,oldTitle,newTitle,epNum,pubAt,pubAtChg,descChg,trackExtracted,actions',
    ]

    for (const diff of diffResults) {
      const row = [
        diff.id,
        diff.show?.title || '',
        diff.publishedStatus || '',
        diff.changes.title?.old || '',
        diff.changes.title?.new || '',
        diff.changes.episodeNumber?.new || '',
        diff.changes.publishedAt?.new || '',
        diff.changes.publishedAt?.changed || false,
        diff.changes.description?.changed || false,
        diff.changes.tracklistRaw?.extracted || 0,
        diff.actions.join('|'),
      ]
      csvLines.push(row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    }

    await fs.writeFile(csvPath, csvLines.join('\n'))
    await fs.writeFile(jsonPath, JSON.stringify(diffResults, null, 2))

    console.log('📁 Logs written to:')
    console.log(`   - ${csvPath}`)
    console.log(`   - ${jsonPath}`)
    console.log()
  }

  if (isDryRun) {
    console.log('💡 This was a DRY-RUN. No changes were made to the database.')
    console.log('   Review the logs and run with --apply to apply changes.')
  } else {
    console.log('✅ Changes have been applied to the database.')
  }

  process.exit(0)
}

run().catch((error) => {
  console.error('💥 Fatal error:', error)
  process.exit(1)
})

