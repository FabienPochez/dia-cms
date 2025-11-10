import 'dotenv/config'

interface LibreTimeFile {
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

interface LibreTimeShow {
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

interface LibreTimeInstance {
  id: number
  starts_at: string
  ends_at: string
  show: number
  created_at: string
  updated_at: string
}

interface LibreTimeSchedule {
  id: number
  starts_at: string
  ends_at: string
  instance: number
  file: number | null
  stream: number | null
  created_at: string
  updated_at: string
}

interface GetFilesParams {
  limit?: number
  offset?: number
  search?: string
  hidden?: boolean
  scheduled?: boolean
}

interface GetShowsParams {
  limit?: number
  offset?: number
  search?: string
}

interface GetInstancesParams {
  limit?: number
  offset?: number
  show?: number
  starts?: string
  ends?: string
}

interface CreateScheduleParams {
  instance: number
  file?: number
  stream?: number
  starts_at: string
  ends_at: string
}

interface UpdateScheduleParams {
  starts_at?: string
  ends_at?: string
  instance?: number
  file?: number
  stream?: number
}

export class LibreTimeClient {
  private baseUrl: string
  private apiKey: string

  constructor() {
    this.baseUrl = process.env.LIBRETIME_BASE_URL || 'http://api:9001'
    this.apiKey = process.env.LIBRETIME_API_KEY || ''

    if (!this.apiKey) {
      throw new Error('LIBRETIME_API_KEY environment variable is required')
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v2${endpoint}`

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Api-Key ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `LibreTime API error: ${response.status} ${response.statusText} - ${errorText}`,
      )
    }

    return response.json()
  }

  /**
   * Get files from LibreTime
   */
  async getFiles(params: GetFilesParams = {}): Promise<LibreTimeFile[]> {
    const searchParams = new URLSearchParams()

    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.search) searchParams.set('search', params.search)
    if (params.hidden !== undefined) searchParams.set('hidden', params.hidden.toString())
    if (params.scheduled !== undefined) searchParams.set('scheduled', params.scheduled.toString())

    const queryString = searchParams.toString()
    const endpoint = queryString ? `/files?${queryString}` : '/files'

    return this.request<LibreTimeFile[]>(endpoint)
  }

  /**
   * Get shows from LibreTime
   */
  async getShows(params: GetShowsParams = {}): Promise<LibreTimeShow[]> {
    const searchParams = new URLSearchParams()

    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.search) searchParams.set('search', params.search)

    const queryString = searchParams.toString()
    const endpoint = queryString ? `/shows?${queryString}` : '/shows'

    return this.request<LibreTimeShow[]>(endpoint)
  }

  /**
   * Get show instances from LibreTime
   */
  async getInstances(params: GetInstancesParams = {}): Promise<LibreTimeInstance[]> {
    const searchParams = new URLSearchParams()

    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.show) searchParams.set('show', params.show.toString())
    if (params.starts) searchParams.set('starts', params.starts)
    if (params.ends) searchParams.set('ends', params.ends)

    const queryString = searchParams.toString()
    const endpoint = queryString ? `/show-instances?${queryString}` : '/show-instances'

    return this.request<LibreTimeInstance[]>(endpoint)
  }

  /**
   * Get schedule from LibreTime
   */
  async getSchedule(params: GetInstancesParams = {}): Promise<LibreTimeSchedule[]> {
    const searchParams = new URLSearchParams()

    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.starts) searchParams.set('starts', params.starts)
    if (params.ends) searchParams.set('ends', params.ends)

    const queryString = searchParams.toString()
    const endpoint = queryString ? `/schedule?${queryString}` : '/schedule'

    return this.request<LibreTimeSchedule[]>(endpoint)
  }

  /**
   * Create a new schedule entry
   */
  async createSchedule(params: CreateScheduleParams): Promise<LibreTimeSchedule> {
    return this.request<LibreTimeSchedule>('/schedule', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  /**
   * Update an existing schedule entry
   */
  async updateSchedule(id: number, params: UpdateScheduleParams): Promise<LibreTimeSchedule> {
    return this.request<LibreTimeSchedule>(`/schedule/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    })
  }

  /**
   * Delete a schedule entry
   */
  async deleteSchedule(id: number): Promise<void> {
    await this.request(`/schedule/${id}`, {
      method: 'DELETE',
    })
  }

  /**
   * Get a specific file by ID
   */
  async getFile(id: number): Promise<LibreTimeFile> {
    return this.request<LibreTimeFile>(`/files/${id}`)
  }

  /**
   * Get a specific show by ID
   */
  async getShow(id: number): Promise<LibreTimeShow> {
    return this.request<LibreTimeShow>(`/shows/${id}`)
  }

  /**
   * Get a specific instance by ID
   */
  async getInstance(id: number): Promise<LibreTimeInstance> {
    return this.request<LibreTimeInstance>(`/show-instances/${id}`)
  }

  /**
   * Get a specific schedule entry by ID
   */
  async getScheduleEntry(id: number): Promise<LibreTimeSchedule> {
    return this.request<LibreTimeSchedule>(`/schedule/${id}`)
  }
}

// Export types for use in other modules
export type {
  LibreTimeFile,
  LibreTimeShow,
  LibreTimeInstance,
  LibreTimeSchedule,
  GetFilesParams,
  GetShowsParams,
  GetInstancesParams,
  CreateScheduleParams,
  UpdateScheduleParams,
}
