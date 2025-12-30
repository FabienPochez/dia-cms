'use client'

import { useState, useEffect, useRef } from 'react'

export interface ActiveShow {
  id: string
  title: string
  slug?: string | null
  hosts?: Array<{ id: string; name?: string }> | null
  cover?: { url?: string } | string | null
}

export interface UseActiveShowsOptions {
  searchQuery?: string
  limit?: number
}

export interface UseActiveShowsReturn {
  shows: ActiveShow[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export const useActiveShows = ({
  searchQuery = '',
  limit = 200,
}: UseActiveShowsOptions = {}): UseActiveShowsReturn => {
  const [shows, setShows] = useState<ActiveShow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchShows = async () => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    abortControllerRef.current = new AbortController()

    try {
      setLoading(true)
      setError(null)

      // Build query parameters for active shows
      const query: Record<string, any> = {
        'where[status][equals]': 'active',
        limit: limit.toString(),
        depth: '2', // Include hosts and cover
        sort: 'title',
      }

      const params = new URLSearchParams(query)
      const response = await fetch(`/api/shows?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch shows: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      const showsList: ActiveShow[] = (data.docs || []).map((show: any) => ({
        id: show.id,
        title: show.title || 'Untitled Show',
        slug: show.slug,
        hosts: show.hosts
          ? Array.isArray(show.hosts)
            ? show.hosts.map((h: any) => ({
                id: typeof h === 'string' ? h : h.id,
                name: typeof h === 'object' ? h.name : undefined,
              }))
            : []
          : null,
        cover: show.cover,
      }))

      // Client-side search filtering
      let filteredShows = showsList
      if (searchQuery.trim()) {
        const queryLower = searchQuery.toLowerCase()
        filteredShows = showsList.filter((show) => {
          const titleMatch = show.title?.toLowerCase().includes(queryLower)
          const slugMatch = show.slug?.toLowerCase().includes(queryLower)
          const hostMatch = show.hosts?.some((h) => h.name?.toLowerCase().includes(queryLower))
          return titleMatch || slugMatch || hostMatch
        })
      }

      setShows(filteredShows)
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return // Request was cancelled, ignore
      }
      console.error('[useActiveShows] Error fetching shows:', err)
      setError(err.message || 'Failed to fetch shows')
      setShows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchShows()
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [limit])

  // Refetch when search query changes (debounced by parent)
  useEffect(() => {
    fetchShows()
  }, [searchQuery])

  return {
    shows,
    loading,
    error,
    refetch: fetchShows,
  }
}

