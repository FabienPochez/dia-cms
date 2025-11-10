import type { Payload } from 'payload'

interface LogErrorParams {
  payload: Payload
  user: any
  collection: 'episodes' | 'media-tracks' | 'media-images' | 'shows'
  operation: 'create' | 'update' | 'upload'
  errorType: 'validation' | 'audio_quality' | 'file_upload' | 'permission' | 'server' | 'other'
  errorCode?: string
  errorMessage: string
  stackTrace?: string
  context?: Record<string, any>
  httpStatus?: number
  targetDocumentId?: string
  req?: any
}

/**
 * Log an upload/creation error to the upload-error-logs collection
 */
export async function logUploadError(params: LogErrorParams): Promise<void> {
  const {
    payload,
    user,
    collection,
    operation,
    errorType,
    errorCode,
    errorMessage,
    stackTrace,
    context,
    httpStatus,
    targetDocumentId,
    req,
  } = params

  try {
    const logData: any = {
      user: typeof user === 'string' ? user : user?.id,
      userEmail: user?.email,
      userRole: user?.role,
      collection,
      operation,
      errorType,
      errorCode,
      errorMessage,
      stackTrace,
      context,
      httpStatus: httpStatus || 500,
      targetDocumentId,
    }

    // Try to extract IP and user agent from request
    if (req) {
      logData.ipAddress =
        req.headers['x-forwarded-for']?.split(',')[0] ||
        req.headers['x-real-ip'] ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress
      logData.userAgent = req.headers['user-agent']
    }

    await payload.create({
      collection: 'upload-error-logs',
      data: logData,
    })

    console.log('[ERROR_LOGGER] Logged error:', {
      user: user?.email,
      errorType,
      errorCode,
      collection,
    })
  } catch (error) {
    // Don't throw - we don't want error logging to break the main flow
    console.error('[ERROR_LOGGER] Failed to log error:', error)
  }
}

/**
 * Parse error code from validation error messages
 */
export function parseErrorCode(errorMessage: string): string | undefined {
  if (errorMessage.includes('Bitrate')) return 'BITRATE_VALIDATION_FAILED'
  if (errorMessage.includes('Duration')) return 'DURATION_VALIDATION_FAILED'
  if (errorMessage.includes('Sample rate')) return 'SAMPLE_RATE_VALIDATION_FAILED'
  if (errorMessage.includes('validation failed')) return 'AUDIO_VALIDATION_FAILED'
  if (errorMessage.includes('file not found')) return 'FILE_NOT_FOUND'
  if (errorMessage.includes('permission')) return 'PERMISSION_DENIED'
  return undefined
}

/**
 * Extract validation context from error for logging
 */
export function extractValidationContext(error: any, data: any): Record<string, any> {
  const context: Record<string, any> = {}

  // Add relevant data fields
  if (data.media) context.mediaId = typeof data.media === 'string' ? data.media : data.media.id
  if (data.show) context.showId = typeof data.show === 'string' ? data.show : data.show.id
  if (data.roundedDuration) context.expectedDuration = data.roundedDuration
  if (data.title) context.episodeTitle = data.title

  // Extract validation details from error message
  const bitrateMatch = error.message?.match(/found: (\d+) kbps/)
  if (bitrateMatch) context.actualBitrate = parseInt(bitrateMatch[1], 10)

  const expectedBitrateMatch = error.message?.match(/must be (\d+) kbps/)
  if (expectedBitrateMatch) context.expectedBitrate = parseInt(expectedBitrateMatch[1], 10)

  return context
}








