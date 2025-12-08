/**
 * LibreTime v2 API Integration Client
 *
 * Handles scheduling operations with LibreTime v2 API:
 * - Create, update, delete schedule entries
 * - File validation and lookup
 * - Robust error handling with retries
 * - UTC timezone handling
 */

// Types aligned to LibreTime v2 API responses
export interface LTFile {
  id: number
  filepath: string
  size: number
  exists: boolean
  mime: string
  md5: string
  hidden: boolean
  scheduled: boolean
  created_at: string
  updated_at: string
  last_played_at: string | null
  bit_rate: number
  sample_rate: number
  length: string
  cue_in: string
  cue_out: string
  name: string
  description: string
  artist_name: string
  track_title: string
  album_title: string | null
  genre: string
  mood: string | null
  date: string
  track_number: number | null
  disc_number: number | null
  comment: string
  language: string | null
  label: string | null
  copyright: string | null
  composer: string | null
  conductor: string | null
  orchestra: string | null
  encoder: string | null
  encoded_by: string | null
  isrc: string | null
  lyrics: string | null
  lyricist: string | null
  original_lyricist: string | null
  subject: string | null
  contributor: string | null
  rating: string | null
  url: string | null
  info_url: string | null
  audio_source_url: string | null
  buy_this_url: string | null
  catalog_number: string | null
  radio_station_name: string | null
  radio_station_url: string | null
  report_datetime: string | null
  report_location: string | null
  report_organization: string | null
  library: string | null
  owner: number
  edited_by: number | null
}

export interface LTSchedule {
  id: number
  starts_at: string
  ends_at: string
  instance: number
  file: number | null
  stream: number | null
  created_at: string
  updated_at: string
}

export interface LTShow {
  id: number
  name: string
  description: string
  genre: string
  url: string | null
  image_path: string | null
  linked: boolean
  is_linkable: boolean
  play_out: boolean
  auto_playlist_enabled: boolean
  auto_playlist_repeat: boolean
  auto_playlist: number | null
  color: string | null
  background_color: string | null
  live_enabled: boolean
  recorded: boolean
  host: number | null
  created_at: string
  updated_at: string
}

export interface LTInstance {
  id: number
  starts_at: string
  ends_at: string
  show: number
  created_at: string
  updated_at: string
}

export interface CreateScheduleParams {
  file: number
  instance: number
  starts_at: string
  ends_at: string
  position?: number
  cue_in?: string
}

export interface UpdateScheduleParams {
  starts_at?: string
  ends_at?: string
  position?: number
  cue_in?: string
}

export interface GetFilesParams {
  q?: string
  limit?: number
  offset?: number
  hidden?: boolean
  scheduled?: boolean
}

export class LibreTimeError extends Error {
  status: number
  message: string
  details?: string

  constructor({ status, message, details }: { status: number; message: string; details?: string }) {
    super(message)
    this.name = 'LibreTimeError'
    this.status = status
    this.message = message
    this.details = details
  }
}

export class LibreTimeClient {
  private baseUrl: string
  private apiKey: string
  private maxRetries: number = 3
  private retryDelay: number = 1000 // 1 second base delay

  constructor() {
    // Use server-side environment variables
    // Prefer internal Docker network URL for better reliability
    this.baseUrl =
      process.env.LIBRETIME_API_URL || process.env.LIBRETIME_BASE_URL || 'http://api:9001'
    this.apiKey = process.env.LIBRETIME_API_KEY || 'test-key'

    if (!this.apiKey) {
      console.warn('[LT] LIBRETIME_API_KEY not set, using test-key')
    }
    
    // Log which URL we're using for debugging
    console.log(`[LT] Using baseUrl: ${this.baseUrl}`)
  }

  /**
   * Make authenticated request to LibreTime v2 API
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v2${path}`
    console.log(`[LT] Request URL: ${url}, API Key: ${this.apiKey ? this.apiKey.substring(0, 10) + '...' : 'MISSING'}`)

    const requestOptions: RequestInit = {
      ...options,
      headers: {
        Authorization: `Api-Key ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    }

    // Add retry logic for 429/5xx errors
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, requestOptions)

        if (response.ok) {
          // Handle empty responses (204 No Content) for DELETE operations
          const contentType = response.headers.get('content-type')
          if (contentType && contentType.includes('application/json')) {
            return response.json()
          } else {
            // Empty response or non-JSON - return success indicator
            return { success: true }
          }
        }

        // Handle specific error cases
        if (response.status === 401 || response.status === 403) {
          throw new LibreTimeError({
            status: response.status,
            message: 'LibreTime auth failed — check API key',
            details: await response.text().catch(() => 'Unknown auth error'),
          })
        }

        if (response.status === 400 || response.status === 422) {
          const errorText = await response.text().catch(() => 'Unknown validation error')
          throw new LibreTimeError({
            status: response.status,
            message: 'Invalid schedule (ends_at required or overlap by server)',
            details: errorText,
          })
        }

        if (response.status === 409) {
          throw new LibreTimeError({
            status: response.status,
            message: 'LibreTime refused schedule (possible overlap)',
            details: await response.text().catch(() => 'Schedule conflict'),
          })
        }

        // For 429/5xx, retry with exponential backoff
        if ((response.status === 429 || response.status >= 500) && attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1)
          console.warn(
            `[LT] Request failed (${response.status}), retrying in ${delay}ms (attempt ${attempt}/${this.maxRetries})`,
          )
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }

        // Final attempt failed or non-retryable error
        const errorText = await response.text().catch(() => 'Unknown error')
        throw new LibreTimeError({
          status: response.status,
          message: `LibreTime API error: ${response.status} ${response.statusText}`,
          details: errorText,
        })
      } catch (error) {
        if (error instanceof LibreTimeError) {
          throw error
        }

        // Network or other errors - retry if not final attempt
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1)
          console.warn(
            `[LT] Request failed (${error}), retrying in ${delay}ms (attempt ${attempt}/${this.maxRetries})`,
          )
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }

        throw new LibreTimeError({
          status: 0,
          message: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          details: error instanceof Error ? error.stack : undefined,
        })
      }
    }

    // This should never be reached due to the loop structure
    throw new LibreTimeError({
      status: 0,
      message: 'Max retries exceeded',
      details: 'Unexpected error in retry logic',
    })
  }

  /**
   * Convert Date to UTC ISO string
   */
  private toUTCISO(date: Date): string {
    return date.toISOString()
  }

  /**
   * Convert Europe/Paris time to UTC
   */
  private parisToUTC(date: Date): string {
    // For now, assume the date is already in the correct timezone
    // In production, you might want to use a proper timezone library
    return date.toISOString()
  }

  /**
   * Get files from LibreTime
   */
  async getFiles(params: GetFilesParams = {}): Promise<LTFile[]> {
    const searchParams = new URLSearchParams()

    if (params.q) searchParams.set('search', params.q)
    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.hidden !== undefined) searchParams.set('hidden', params.hidden.toString())
    if (params.scheduled !== undefined) searchParams.set('scheduled', params.scheduled.toString())

    const queryString = searchParams.toString()
    const endpoint = queryString ? `/files?${queryString}` : '/files'

    return this.request<LTFile[]>(endpoint)
  }

  /**
   * Get a specific file by ID
   */
  async getFile(id: number): Promise<LTFile> {
    return this.request<LTFile>(`/files/${id}`)
  }

  /**
   * Get shows from LibreTime
   */
  async getShows(
    params: { limit?: number; offset?: number; search?: string } = {},
  ): Promise<LTShow[]> {
    const searchParams = new URLSearchParams()

    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.search) searchParams.set('search', params.search)

    const queryString = searchParams.toString()
    const endpoint = queryString ? `/shows?${queryString}` : '/shows'

    return this.request<LTShow[]>(endpoint)
  }

  /**
   * Get show instances
   */
  async getInstances(
    params: {
      limit?: number
      offset?: number
      show?: number
      starts?: string
      ends?: string
    } = {},
  ): Promise<LTInstance[]> {
    const searchParams = new URLSearchParams()

    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.show) searchParams.set('show', params.show.toString())
    if (params.starts) searchParams.set('starts', params.starts)
    if (params.ends) searchParams.set('ends', params.ends)

    const queryString = searchParams.toString()
    const endpoint = queryString ? `/show-instances?${queryString}` : '/show-instances'

    return this.request<LTInstance[]>(endpoint)
  }

  /**
   * Get schedule entries
   */
  async getSchedule(
    params: {
      limit?: number
      offset?: number
      starts?: string
      ends?: string
    } = {},
  ): Promise<LTSchedule[]> {
    const searchParams = new URLSearchParams()

    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.starts) searchParams.set('starts', params.starts)
    if (params.ends) searchParams.set('ends', params.ends)

    const queryString = searchParams.toString()
    const endpoint = queryString ? `/schedule?${queryString}` : '/schedule'

    return this.request<LTSchedule[]>(endpoint)
  }

  /**
   * Create a new schedule entry
   */
  async createSchedule(params: CreateScheduleParams): Promise<LTSchedule> {
    // Ensure times are in UTC
    const scheduleData = {
      ...params,
      starts_at: this.toUTCISO(new Date(params.starts_at)),
      ends_at: this.toUTCISO(new Date(params.ends_at)),
      position: params.position || 0,
      cue_in: params.cue_in || '00:00:00',
    }

    console.log('[LT] Creating schedule:', {
      file: scheduleData.file,
      instance: scheduleData.instance,
      starts_at: scheduleData.starts_at,
      ends_at: scheduleData.ends_at,
    })

    return this.request<LTSchedule>('/schedule', {
      method: 'POST',
      body: JSON.stringify(scheduleData),
    })
  }

  /**
   * Update an existing schedule entry
   */
  async updateSchedule(id: number, params: UpdateScheduleParams): Promise<LTSchedule> {
    // Ensure both timestamps are provided for PUT
    if (!params.starts_at || !params.ends_at) {
      throw new Error('[LT] Both starts_at and ends_at are required for schedule updates')
    }

    const updateData: any = {
      starts_at: this.toUTCISO(new Date(params.starts_at)),
      ends_at: this.toUTCISO(new Date(params.ends_at)),
      position: params.position || 0,
      cue_in: params.cue_in || '00:00:00',
    }

    console.log('[LT] Updating schedule:', { id, ...updateData })

    return this.request<LTSchedule>(`/schedule/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updateData),
    })
  }

  /**
   * Delete a schedule entry
   */
  async deleteSchedule(id: number): Promise<void> {
    console.log('[LT] Deleting schedule:', { id })

    await this.request(`/schedule/${id}`, {
      method: 'DELETE',
    })
  }

  /**
   * Validate that a file exists and is available for scheduling
   */
  async validateFile(fileId: number): Promise<boolean> {
    try {
      const file = await this.getFile(fileId)
      return file.exists && !file.hidden
    } catch (error) {
      console.warn('[LT] File validation failed:', error)
      return false
    }
  }

  /**
   * Check for schedule overlaps in a time window
   */
  async checkOverlaps(startsAt: string, endsAt: string, excludeId?: number): Promise<LTSchedule[]> {
    try {
      const schedules = await this.getSchedule({
        starts: startsAt,
        ends: endsAt,
      })

      // Filter out the excluded schedule (for updates)
      return excludeId ? schedules.filter((s) => s.id !== excludeId) : schedules
    } catch (error) {
      console.warn('[LT] Overlap check failed:', error)
      return []
    }
  }

  /**
   * Move schedule with fallback delete+create when PATCH fails
   */
  async moveScheduleWithFallback(
    scheduleId: number,
    fileId: number,
    instanceId: number,
    startsAt: string,
    endsAt: string,
  ): Promise<{ success: boolean; scheduleId?: number; error?: string; usedFallback?: boolean }> {
    console.log(`[LT][move] PATCH id=${scheduleId} -> attempting`)

    try {
      // Try PATCH first
      const updateData = {
        starts_at: this.toUTCISO(new Date(startsAt)),
        ends_at: this.toUTCISO(new Date(endsAt)),
        position: 0,
        cue_in: '00:00:00',
      }

      const response = await fetch(`${this.baseUrl}/api/v2/schedule/${scheduleId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      })

      console.log(`[LT][move] PATCH id=${scheduleId} -> ${response.status}`)

      // Check if PATCH succeeded
      if (response.ok) {
        const updatedSchedule = await response.json()
        console.log(`[LT][move] PATCH success, keeping id=${scheduleId}`)
        return {
          success: true,
          scheduleId: updatedSchedule.id,
          usedFallback: false,
        }
      }

      // Check if we should trigger fallback
      const contentType = response.headers.get('content-type') || ''
      const shouldFallback = response.status >= 500 || !contentType.includes('application/json')

      if (!shouldFallback) {
        // PATCH failed but not a server error, return the error
        const errorText = await response.text().catch(() => 'Unknown error')
        return {
          success: false,
          error: `PATCH failed: ${response.status} ${errorText}`,
        }
      }

      console.log(`[LT][move] FALLBACK: delete ${scheduleId}, create new schedule`)

      // Fallback: Delete old schedule
      const deleteResponse = await fetch(`${this.baseUrl}/api/v2/schedule/${scheduleId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
        },
      })

      console.log(`[LT][move] FALLBACK: delete ${scheduleId} -> ${deleteResponse.status}`)

      if (!deleteResponse.ok && deleteResponse.status !== 204) {
        return {
          success: false,
          error: `Delete failed: ${deleteResponse.status}`,
        }
      }

      // Create new schedule
      const createData = {
        file: fileId,
        instance: instanceId,
        starts_at: this.toUTCISO(new Date(startsAt)),
        ends_at: this.toUTCISO(new Date(endsAt)),
        position: 0,
        cue_in: '00:00:00',
        cue_out: '00:05:00',
        broadcasted: 0,
      }

      const createResponse = await fetch(`${this.baseUrl}/api/v2/schedule`, {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createData),
      })

      console.log(`[LT][move] FALLBACK: create -> ${createResponse.status}`)

      if (!createResponse.ok) {
        // Try to restore original schedule as last resort
        console.log(`[LT][move] FALLBACK: create failed, attempting restore`)
        try {
          const restoreData = {
            file: fileId,
            instance: instanceId,
            starts_at: this.toUTCISO(new Date(startsAt)),
            ends_at: this.toUTCISO(new Date(endsAt)),
            position: 0,
            cue_in: '00:00:00',
            cue_out: '00:05:00',
            broadcasted: 0,
          }

          const restoreResponse = await fetch(`${this.baseUrl}/api/v2/schedule`, {
            method: 'POST',
            headers: {
              Authorization: `Api-Key ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(restoreData),
          })

          if (restoreResponse.ok) {
            const restoredSchedule = await restoreResponse.json()
            console.log(`[LT][move] FALLBACK: restore success id=${restoredSchedule.id}`)
            return {
              success: true,
              scheduleId: restoredSchedule.id,
              usedFallback: true,
            }
          }
        } catch (restoreError) {
          console.error('[LT][move] FALLBACK: restore failed:', restoreError)
        }

        return {
          success: false,
          error: `Create failed: ${createResponse.status} ${await createResponse.text().catch(() => 'Unknown error')}`,
        }
      }

      const newSchedule = await createResponse.json()
      console.log(
        `[LT][move] FALLBACK: delete ${deleteResponse.status}, create ${createResponse.status} newId=${newSchedule.id}`,
      )

      return {
        success: true,
        scheduleId: newSchedule.id,
        usedFallback: true,
      }
    } catch (error) {
      console.error('[LT][move] PATCH failed with error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Test connection to LibreTime API
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getFiles({ limit: 1 })
      return true
    } catch (error) {
      console.error('[LT] Connection test failed:', error)
      return false
    }
  }

  /**
   * Ensure LibreTime show exists, create if missing
   * Prefers stored libretimeShowId over name matching unless allowNameMatch is true
   */
  async ensureShow(showPayload: any, allowNameMatch: boolean = false): Promise<LTShow | null> {
    try {
      let createdShow: LTShow | null = null

      // If show already has LT show ID, verify it exists
      if (showPayload.libretimeShowId) {
        try {
          const existingShow = await this.request<LTShow>(`/shows/${showPayload.libretimeShowId}`)
          return existingShow
        } catch (error) {
          console.warn(
            '[LT] Stored show ID not found, will create new show:',
            showPayload.libretimeShowId,
          )
        }
      }

      // Only search by name if explicitly allowed
      if (allowNameMatch) {
        const existingShows = await this.getShows({ search: showPayload.title })
        const existingShow = existingShows.find((s) => s.name === showPayload.title)

        if (existingShow) {
          return existingShow
        }
      }

      // Create new show with all required fields from shell script exploration
      const showData = {
        name: showPayload.title,
        description: showPayload.description || '',
        live_enabled: true,
        linked: false,
        linkable: true,
        // auto_playlist: 1, // REMOVED 2025-10-23 - playlist ID 1 no longer exists
        auto_playlist_enabled: false, // DISABLED on 2025-10-23 to prevent jingle spam until file rehydration fixed
        auto_playlist_repeat: false,
        override_intro_playlist: false,
        override_outro_playlist: false,
      }

      createdShow = await this.request<LTShow>('/shows', {
        method: 'POST',
        body: JSON.stringify(showData),
      })

      return createdShow
    } catch (error) {
      console.error('[LT] Failed to ensure show:', error)
      return null
    }
  }

  /**
   * Ensure LibreTime instance exists for time window
   * All times normalized to UTC ISO format
   * Ensures uniqueness by exact time match or creates new one
   */
  async ensureInstance(
    showId: number,
    startsAt: string,
    endsAt: string,
    currentInstanceId?: number,
  ): Promise<LTInstance | null> {
    try {
      // Normalize times to UTC ISO
      const normalizedStart = this.toUTCISO(new Date(startsAt))
      const normalizedEnd = this.toUTCISO(new Date(endsAt))

      // Search for existing instances in a broader time window to catch overlaps
      const searchStart = new Date(normalizedStart)
      searchStart.setHours(searchStart.getHours() - 1) // Search 1 hour before
      const searchEnd = new Date(normalizedEnd)
      searchEnd.setHours(searchEnd.getHours() + 1) // Search 1 hour after

      const allInstances = await this.getInstances({
        show: showId,
        starts: searchStart.toISOString(),
        ends: searchEnd.toISOString(),
      })

      // Filter to only instances that actually belong to this show (LibreTime API bug workaround)
      const existingInstances = allInstances.filter((instance) => instance.show === showId)

      console.log(
        `[LT] ensureInstance: showId=${showId} timeWindow=${normalizedStart} to ${normalizedEnd} currentInstanceId=${currentInstanceId}`,
      )
      console.log(
        `[LT] Found ${existingInstances.length} existing instances:`,
        existingInstances.map((i) => `${i.id}(${i.starts_at}-${i.ends_at})`),
      )

      // If we have a current instance ID, try to reuse it (for moved episodes)
      if (currentInstanceId) {
        const currentInstance = existingInstances.find((i) => i.id === currentInstanceId)
        if (currentInstance) {
          console.log(
            `[LT] Found current instance ${currentInstanceId} - updating time window from ${currentInstance.starts_at} to ${normalizedStart}`,
          )

          // Update the instance time window
          const updated = await this.updateInstance(
            currentInstanceId,
            normalizedStart,
            normalizedEnd,
          )
          if (updated) {
            // Return the updated instance
            return {
              ...currentInstance,
              starts_at: normalizedStart,
              ends_at: normalizedEnd,
            }
          } else {
            console.log(`[LT] Failed to update instance ${currentInstanceId}, will create new one`)
          }
        } else {
          console.log(`[LT] Current instance ${currentInstanceId} not found in search results`)
        }
      }

      // Look for exact match first (can reuse empty instances or add more playouts to existing instance)
      // Normalize instance times to match our format (LibreTime may return different ISO formats)
      const exactMatch = existingInstances.find((i) => {
        const instanceStart = this.toUTCISO(new Date(i.starts_at))
        const instanceEnd = this.toUTCISO(new Date(i.ends_at))
        return instanceStart === normalizedStart && instanceEnd === normalizedEnd
      })

      if (exactMatch) {
        console.log(
          `[LT] Found exact matching instance ${exactMatch.id} for show ${showId} - reusing it`,
        )
        return exactMatch
      }

      // Check for overlapping instances (conflicts) - but exclude exact matches
      const overlappingInstances = existingInstances.filter((instance) => {
        // Normalize instance times for comparison
        const instanceStartNorm = this.toUTCISO(new Date(instance.starts_at))
        const instanceEndNorm = this.toUTCISO(new Date(instance.ends_at))

        // Skip exact matches (already handled above)
        if (instanceStartNorm === normalizedStart && instanceEndNorm === normalizedEnd) {
          return false
        }

        const instanceStart = new Date(instance.starts_at).getTime()
        const instanceEnd = new Date(instance.ends_at).getTime()
        const requestStart = new Date(normalizedStart).getTime()
        const requestEnd = new Date(normalizedEnd).getTime()

        // Check for actual time overlap
        return instanceStart < requestEnd && instanceEnd > requestStart
      })

      if (overlappingInstances.length > 0) {
        throw new Error(
          `Time slot conflicts with existing instance(s) ${overlappingInstances.map((i) => i.id).join(', ')} for show ${showId} in time window ${normalizedStart} to ${normalizedEnd}`,
        )
      }

      // No exact match and no conflicts - create new instance
      console.log(
        `[LT] No exact match found. Creating new instance for show ${showId} at ${normalizedStart} to ${normalizedEnd}.`,
      )

      // Create new instance with all required fields from shell script
      const instanceData = {
        show: showId,
        starts_at: normalizedStart,
        ends_at: normalizedEnd,
        created_at: normalizedStart,
        record_enabled: 0,
        modified: false,
        auto_playlist_built: false,
      }

      return await this.request<LTInstance>('/show-instances', {
        method: 'POST',
        body: JSON.stringify(instanceData),
      })
    } catch (error) {
      console.error('[LT] Failed to ensure instance:', error)
      return null
    }
  }

  /**
   * Ensure playout exists in instance
   * No forced cue_out to support hard-timed blocks
   */
  async ensurePlayout(
    instanceId: number,
    trackId: number,
    startsAt: string,
    endsAt: string,
  ): Promise<LTSchedule | null> {
    try {
      // Normalize times to UTC ISO
      const normalizedStart = this.toUTCISO(new Date(startsAt))
      const normalizedEnd = this.toUTCISO(new Date(endsAt))

      // Check if playout already exists
      const existingPlayouts = await this.listPlayouts(instanceId)
      const existingPlayout = existingPlayouts.find(
        (p) => p.file === trackId && p.starts_at === normalizedStart && p.ends_at === normalizedEnd,
      )

      if (existingPlayout) {
        return existingPlayout
      }

      // Get file info to set proper cue_out (full track length)
      const fileInfo = await this.getFile(trackId)
      const cueOut = fileInfo?.length || '02:00:00' // Default to 2 hours if not available

      // Create new playout with all required fields from shell script
      const playoutData = {
        instance: instanceId,
        file: trackId,
        starts_at: normalizedStart,
        ends_at: normalizedEnd,
        position: 0,
        cue_in: '00:00:00',
        cue_out: cueOut, // Use full track length to prevent early cutoff
        fade_in: '00:00:01', // 1 second fade in for smooth show-to-show transitions
        fade_out: '00:00:01', // 1 second fade out for smooth show-to-show transitions
        broadcasted: 0,
      }

      return await this.request<LTSchedule>('/schedule', {
        method: 'POST',
        body: JSON.stringify(playoutData),
      })
    } catch (error) {
      console.error('[LT] Failed to ensure playout:', error)
      return null
    }
  }

  /**
   * List playouts in instance (using cached /show-instances/files endpoint)
   * NOTE: This endpoint may return stale data after deletions
   */
  async listPlayouts(instanceId: number): Promise<LTSchedule[]> {
    try {
      return await this.request<LTSchedule[]>(`/schedule?instance=${instanceId}`)
    } catch (error) {
      console.error('[LT] Failed to list playouts:', error)
      return []
    }
  }

  /**
   * List schedules by instance using authoritative /schedule endpoint
   * This endpoint is more reliable than listPlayouts for checking instance emptiness
   * as it queries the schedules table directly
   */
  async listSchedulesByInstance(
    instanceId: number,
    range?: { startISO: string; endISO: string },
  ): Promise<number> {
    try {
      const params: { instance?: number; starts?: string; ends?: string } = {
        instance: instanceId,
      }

      // Add time range if provided
      if (range) {
        params.starts = range.startISO
        params.ends = range.endISO
      }

      const schedules = await this.getSchedule(params)

      // Filter to ensure we only count schedules for this exact instance
      const instanceSchedules = schedules.filter((s) => s.instance === instanceId)

      console.log(
        `[LT] listSchedulesByInstance(${instanceId}): found ${instanceSchedules.length} schedules`,
      )

      return instanceSchedules.length
    } catch (error) {
      console.error('[LT] Failed to list schedules by instance:', error)
      return 0
    }
  }

  /**
   * Get playout by ID
   */
  async getPlayout(playoutId: number): Promise<LTSchedule | null> {
    try {
      return await this.request<LTSchedule>(`/schedule/${playoutId}`)
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null
      }
      console.error('[LT] Failed to get playout:', error)
      return null
    }
  }

  /**
   * Delete playout
   */
  async deletePlayout(playoutId: number): Promise<boolean> {
    try {
      await this.request(`/schedule/${playoutId}`, {
        method: 'DELETE',
      })
      return true
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return false // Playout already missing
      }
      console.error('[LT] Failed to delete playout:', error)
      return false
    }
  }

  /**
   * Update instance time window
   */
  async updateInstance(instanceId: number, startsAt: string, endsAt: string): Promise<boolean> {
    try {
      const normalizedStart = this.toUTCISO(new Date(startsAt))
      const normalizedEnd = this.toUTCISO(new Date(endsAt))

      await this.request(`/show-instances/${instanceId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          starts_at: normalizedStart,
          ends_at: normalizedEnd,
        }),
      })

      console.log(`[LT] Updated instance ${instanceId} to ${normalizedStart} to ${normalizedEnd}`)
      return true
    } catch (error) {
      console.error('[LT] Failed to update instance:', error)
      return false
    }
  }

  /**
   * Delete instance (for rollback) - only if empty
   */
  async deleteInstance(instanceId: number): Promise<boolean> {
    try {
      // Check if instance is empty before deleting
      const remainingPlayouts = await this.listPlayouts(instanceId)
      if (remainingPlayouts.length > 0) {
        console.log(`[LT] Instance ${instanceId} not empty, skipping deletion`)
        return false
      }

      await this.request(`/show-instances/${instanceId}`, {
        method: 'DELETE',
      })
      return true
    } catch (error) {
      console.error('[LT] Failed to delete instance:', error)
      return false
    }
  }

  /**
   * Force delete instance - used when we know it should be empty
   */
  async forceDeleteInstance(instanceId: number): Promise<boolean> {
    try {
      console.log(`[LT] Force deleting instance ${instanceId}`)
      await this.request(`/show-instances/${instanceId}`, {
        method: 'DELETE',
      })
      console.log(`[LT] Successfully force deleted instance ${instanceId}`)
      return true
    } catch (error) {
      console.error('[LT] Failed to force delete instance:', error)
      return false
    }
  }

  /**
   * Get file by ID
   */
  async getFile(fileId: number): Promise<any> {
    try {
      return await this.request(`/files/${fileId}`)
    } catch (error) {
      console.error('[LT] Failed to get file:', error)
      return null
    }
  }
}

// LibreTimeError is already exported as a class above
