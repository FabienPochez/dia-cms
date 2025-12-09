import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execFileAsync = promisify(execFile)

interface AudioMetadata {
  durationSec: number
  bitrateKbps: number
  sampleRateHz: number
}

interface ValidationResult {
  valid: boolean
  error?: string
  metadata?: AudioMetadata
}

/**
 * Extract audio metadata using ffprobe
 */
async function getAudioMetadata(filePath: string): Promise<AudioMetadata> {
  try {
    // Use system ffprobe (installed via apk in Alpine container)
    // Security: Use execFile with array arguments to prevent command injection
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath, // Safe - passed as array argument, not string interpolation
    ])

    const data = JSON.parse(stdout)

    // Find audio stream
    const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio')

    if (!audioStream) {
      throw new Error('No audio stream found in file')
    }

    // Extract metadata
    const durationSec = Math.round(parseFloat(data.format?.duration || '0'))
    const bitrateKbps = Math.round(parseInt(data.format?.bit_rate || '0') / 1000)
    const sampleRateHz = parseInt(audioStream.sample_rate || '0')

    return {
      durationSec,
      bitrateKbps,
      sampleRateHz,
    }
  } catch (error) {
    console.error('[AUDIO_VALIDATION] ffprobe failed:', error)
    throw new Error(
      `Failed to extract audio metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Validate audio file against requirements
 * - Bitrate: exactly 320 kbps
 * - Sample rate: exactly 44100 Hz
 * - Duration: must match expected duration ±1 second
 * - Duration must be multiple of 60 seconds (full minutes)
 * - Duration must be ≤ 21600 seconds (360 minutes)
 */
export async function validateAudioFile(
  filePath: string,
  expectedDurationMinutes: number,
): Promise<ValidationResult> {
  try {
    console.log('[AUDIO_VALIDATION] Validating:', filePath)
    console.log('[AUDIO_VALIDATION] Expected duration:', expectedDurationMinutes, 'minutes')

    const metadata = await getAudioMetadata(filePath)

    console.log('[AUDIO_VALIDATION] Extracted metadata:', metadata)

    const expectedDurationSec = expectedDurationMinutes * 60
    const errors: string[] = []

    // Check bitrate (must be exactly 320 kbps)
    if (metadata.bitrateKbps !== 320) {
      errors.push(`Bitrate must be 320 kbps (found: ${metadata.bitrateKbps} kbps)`)
    }

    // Check sample rate (must be exactly 44100 Hz)
    if (metadata.sampleRateHz !== 44100) {
      errors.push(`Sample rate must be 44100 Hz (found: ${metadata.sampleRateHz} Hz)`)
    }

    // Check duration - matches planner rules:
    // - 60min slot requires ≥59min
    // - 90min slot requires ≥89min
    // - 120min slot requires ≥119min
    // - 180min slot requires ≥179min
    // - >180min slots: no quality check applied
    if (expectedDurationMinutes <= 180) {
      const minRequiredMinutes = expectedDurationMinutes - 1
      const actualMinutes = metadata.durationSec / 60

      if (actualMinutes < minRequiredMinutes) {
        const actualMin = Math.floor(metadata.durationSec / 60)
        const actualSec = metadata.durationSec % 60
        errors.push(
          `Duration must be at least ${minRequiredMinutes} minutes for ${expectedDurationMinutes}min slot (found: ${actualMin}m ${actualSec}s)`,
        )
      }
    }
    // For slots >180min, no duration quality check applied

    // Check duration is within reasonable bounds (≤ 360 minutes)
    if (metadata.durationSec > 21600) {
      errors.push(
        `Duration must be ≤ 360 minutes (found: ${Math.floor(metadata.durationSec / 60)} minutes)`,
      )
    }

    if (errors.length > 0) {
      return {
        valid: false,
        error: errors.join('; '),
        metadata,
      }
    }

    console.log('[AUDIO_VALIDATION] ✅ Validation passed')

    return {
      valid: true,
      metadata,
    }
  } catch (error) {
    console.error('[AUDIO_VALIDATION] Validation error:', error)
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Audio validation failed',
    }
  }
}

/**
 * Get absolute file path from media-tracks record
 */
export async function getMediaTrackFilePath(mediaId: string, payload: any): Promise<string | null> {
  try {
    const media = await payload.findByID({
      collection: 'media-tracks',
      id: mediaId,
    })

    if (!media || !media.filename) {
      return null
    }

    // Media files are stored in /srv/media/new/
    const filePath = path.join('/srv/media/new', media.filename)
    return filePath
  } catch (error) {
    console.error('[AUDIO_VALIDATION] Failed to get media file path:', error)
    return null
  }
}
