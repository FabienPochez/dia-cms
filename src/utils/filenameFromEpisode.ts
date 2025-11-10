/**
 * Build canonical episode filename
 * Pattern: {episodeId}__{showSlug}__{titleSlug}__{episodeNumber}.{extension}
 * 
 * Based on utils/generateEpisodeFilename.ts and scripts/rename-media-in-place.ts
 */

import * as mime from 'mime-types'

interface EpisodeData {
  id: string
  show?: { slug?: string; title?: string } | null
  title?: string
  episodeNumber?: number
}

/**
 * Slugify a string using the same rules as generateEpisodeFilename.ts
 */
function slugify(str: string): string {
  if (!str) return 'untitled'
  
  return (
    str
      .normalize('NFD') // decompose accents
      .replace(/[\u0300-\u036f]/g, '') // remove diacritics
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // replace non-alphanum with dash
      .replace(/(^-|-$)/g, '') // trim leading/trailing dashes
  ) || 'untitled'
}

/**
 * Get file extension from MIME type (NOT from original filename)
 */
function getExtensionFromMime(mimeType: string): string {
  const ext = mime.extension(mimeType)
  if (!ext) {
    // Fallback for common audio/image types
    if (mimeType.includes('audio')) return 'mp3'
    if (mimeType.includes('image')) return 'jpg'
    return 'bin'
  }
  
  // Normalize some extensions
  if (ext === 'jpeg') return 'jpg'
  if (ext === 'mpga' || ext === 'mpeg') return 'mp3'
  
  return ext
}

/**
 * Build episode filename from episode data
 * 
 * @param episode - Episode data (must include id, optionally show/title/episodeNumber)
 * @param mimeType - MIME type to derive extension
 * @param originalFilename - Optional original filename to preserve (sanitized)
 * @param maxLength - Maximum filename length (default 120 chars including extension)
 * @returns Canonical filename
 */
export function buildEpisodeFilename(
  episode: EpisodeData,
  mimeType: string,
  originalFilename?: string,
  maxLength: number = 120,
): string {
  const { id, show, title, episodeNumber } = episode
  const extension = getExtensionFromMime(mimeType)
  
  // If originalFilename provided, use simplified pattern: {id}__{sanitizedOriginal}
  if (originalFilename) {
    // Remove extension from original filename
    const nameWithoutExt = originalFilename.replace(/\.[^.]+$/, '')
    
    // Sanitize the original filename
    const sanitized = slugify(nameWithoutExt)
    
    // Build filename: {id}__{sanitizedOriginal}.{ext}
    let filename = `${id}__${sanitized}.${extension}`
    
    // Enforce length cap
    if (filename.length > maxLength) {
      const extensionLength = extension.length + 1
      const idLength = 24
      const separatorLength = 2 // "__"
      const availableForName = maxLength - idLength - extensionLength - separatorLength
      const truncatedName = sanitized.substring(0, availableForName)
      filename = `${id}__${truncatedName}.${extension}`
    }
    
    return filename
  }
  
  // Otherwise use full canonical pattern: {id}__{showSlug}__{titleSlug}__{episodeNumber}.{ext}
  const showSlug = show?.title ? slugify(show.title) : slugify(title || 'untitled')
  const titleSlug = slugify(title || 'untitled')
  const epNum = episodeNumber || 1
  
  // Build filename: {id}__{showSlug}__{titleSlug}__{episodeNumber}.{ext}
  let filename = `${id}__${showSlug}__${titleSlug}__${epNum}.${extension}`
  
  // Enforce length cap (truncate slugs if needed)
  if (filename.length > maxLength) {
    const extensionLength = extension.length + 1 // +1 for dot
    const idLength = 24 // MongoDB ObjectID
    const separatorLength = 8 // 4 x "__" and 2 digits for episode number (approx)
    const availableForSlugs = maxLength - idLength - extensionLength - separatorLength
    const slugLength = Math.floor(availableForSlugs / 2)
    
    const truncatedShowSlug = showSlug.substring(0, slugLength)
    const truncatedTitleSlug = titleSlug.substring(0, slugLength)
    
    filename = `${id}__${truncatedShowSlug}__${truncatedTitleSlug}__${epNum}.${extension}`
  }
  
  return filename
}

/**
 * Build cover image filename (simpler pattern)
 * Pattern: {episodeId}__cover.{extension}
 */
export function buildCoverFilename(episodeId: string, mimeType: string): string {
  const extension = getExtensionFromMime(mimeType)
  return `${episodeId}__cover.${extension}`
}

