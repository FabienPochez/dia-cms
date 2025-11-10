/**
 * Client-side LibreTime API wrapper
 *
 * Provides a clean interface for the Planner to interact with LibreTime
 * through our secure server-side API proxy.
 */

import {
  LTFile,
  LTSchedule,
  LTShow,
  LTInstance,
  CreateScheduleParams,
  UpdateScheduleParams,
} from './libretimeClient'

export interface LibreTimeApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  details?: string
}

export class LibreTimeApi {
  private baseUrl: string

  constructor() {
    this.baseUrl = '/api/libretime'
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<LibreTimeApiResponse<T>> {
    try {
      // Remove leading slash and 'api/v2' prefix since the catch-all handles it
      const cleanEndpoint = endpoint.replace(/^\/api\/v2/, '').replace(/^\//, '')
      const response = await fetch(`${this.baseUrl}/${cleanEndpoint}`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}`,
          details: data.details,
        }
      }

      return {
        success: true,
        data,
      }
    } catch (error) {
      console.error('[LT] Client request error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  /**
   * Get files from LibreTime
   */
  async getFiles(
    params: {
      q?: string
      limit?: number
      offset?: number
      hidden?: boolean
      scheduled?: boolean
    } = {},
  ): Promise<LibreTimeApiResponse<{ files: LTFile[] }>> {
    const searchParams = new URLSearchParams()

    if (params.q) searchParams.set('q', params.q)
    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.hidden !== undefined) searchParams.set('hidden', params.hidden.toString())
    if (params.scheduled !== undefined) searchParams.set('scheduled', params.scheduled.toString())

    const queryString = searchParams.toString()
    const endpoint = queryString ? `api/v2/files?${queryString}` : 'api/v2/files'

    return this.request<{ files: LTFile[] }>(endpoint)
  }

  /**
   * Get shows from LibreTime
   */
  async getShows(
    params: {
      limit?: number
      offset?: number
      search?: string
    } = {},
  ): Promise<LibreTimeApiResponse<{ shows: LTShow[] }>> {
    const searchParams = new URLSearchParams()

    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.search) searchParams.set('search', params.search)

    const queryString = searchParams.toString()
    const endpoint = queryString ? `api/v2/shows?${queryString}` : 'api/v2/shows'

    return this.request<{ shows: LTShow[] }>(endpoint)
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
  ): Promise<LibreTimeApiResponse<{ instances: LTInstance[] }>> {
    const searchParams = new URLSearchParams()

    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.show) searchParams.set('show', params.show.toString())
    if (params.starts) searchParams.set('starts', params.starts)
    if (params.ends) searchParams.set('ends', params.ends)

    const queryString = searchParams.toString()
    const endpoint = queryString ? `api/v2/show-instances?${queryString}` : 'api/v2/show-instances'

    return this.request<{ instances: LTInstance[] }>(endpoint)
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
  ): Promise<LibreTimeApiResponse<{ schedule: LTSchedule[] }>> {
    const searchParams = new URLSearchParams()

    if (params.limit) searchParams.set('limit', params.limit.toString())
    if (params.offset) searchParams.set('offset', params.offset.toString())
    if (params.starts) searchParams.set('starts', params.starts)
    if (params.ends) searchParams.set('ends', params.ends)

    const queryString = searchParams.toString()
    const endpoint = queryString ? `api/v2/schedule?${queryString}` : 'api/v2/schedule'

    return this.request<{ schedule: LTSchedule[] }>(endpoint)
  }

  /**
   * Create a new schedule entry
   */
  async createSchedule(params: CreateScheduleParams): Promise<LibreTimeApiResponse<LTSchedule>> {
    return this.request<LTSchedule>('api/v2/schedule', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  /**
   * Update an existing schedule entry
   */
  async updateSchedule(
    id: number,
    params: UpdateScheduleParams,
  ): Promise<LibreTimeApiResponse<LTSchedule>> {
    return this.request<LTSchedule>(`api/v2/schedule/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    })
  }

  /**
   * Delete a schedule entry
   */
  async deleteSchedule(id: number): Promise<LibreTimeApiResponse<void>> {
    return this.request<void>(`api/v2/schedule/${id}`, {
      method: 'DELETE',
    })
  }

  /**
   * Validate that a file exists and is available for scheduling
   */
  async validateFile(fileId: number): Promise<LibreTimeApiResponse<boolean>> {
    try {
      const response = await this.request<LTFile>(`api/v2/files/${fileId}`)
      return {
        success: true,
        data: response.exists && !response.hidden,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'File validation failed',
      }
    }
  }

  /**
   * Check for schedule overlaps in a time window
   */
  async checkOverlaps(
    startsAt: string,
    endsAt: string,
    _excludeId?: number,
  ): Promise<LibreTimeApiResponse<LTSchedule[]>> {
    const params = new URLSearchParams({
      starts: startsAt,
      ends: endsAt,
    })

    return this.request<LTSchedule[]>(`api/v2/schedule?${params.toString()}`)
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
  ): Promise<LibreTimeApiResponse<{ scheduleId: number; usedFallback: boolean }>> {
    return this.request<{ scheduleId: number; usedFallback: boolean }>('api/v2/schedule/move', {
      method: 'POST',
      body: JSON.stringify({
        scheduleId,
        fileId,
        instanceId,
        startsAt,
        endsAt,
      }),
    })
  }

  /**
   * Test connection to LibreTime API
   */
  async testConnection(): Promise<LibreTimeApiResponse<boolean>> {
    try {
      await this.request<LTFile[]>('api/v2/files?limit=1')
      return {
        success: true,
        data: true,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
        data: false,
      }
    }
  }
}

// Export a singleton instance
export const libreTimeApi = new LibreTimeApi()
