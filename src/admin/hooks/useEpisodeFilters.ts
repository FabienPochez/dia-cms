'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDebounce } from './useDebounce'

export interface FilterState {
  search: string
  moods: string[]
  tones: string[]
  energy: string | null
  durationPreset: 'short' | '60' | '90' | '120' | '180' | 'long' | null
  playCountMin: number | null
  playCountMax: number | null
}

const DEFAULT_STORAGE_KEY = 'planner.filters.v1'
const DEFAULT_COLLAPSED_KEY = 'planner.filters.v1.collapsed'

const DEFAULT_FILTERS: FilterState = {
  search: '',
  moods: [],
  tones: [],
  energy: null,
  durationPreset: null,
  playCountMin: null,
  playCountMax: null,
}

// Migration: map old durationMin/Max to nearest preset
function migrateLegacyDuration(
  min: number | null,
  max: number | null,
): 'short' | '60' | '90' | '120' | '180' | 'long' | null {
  if (min === null && max === null) return null

  // Only migrate if there's a clear match to avoid unwanted presets
  const center = ((min ?? 0) + (max ?? 300)) / 2

  // Be more conservative - only migrate if the range clearly matches a preset
  if (min !== null && max !== null) {
    // Check if the range is within the preset tolerance (±5 min)
    if (min >= 50 && max <= 60) return 'short'
    if (min >= 55 && max <= 65) return '60'
    if (min >= 85 && max <= 95) return '90'
    if (min >= 115 && max <= 125) return '120'
    if (min >= 175 && max <= 185) return '180'
    if (min >= 180) return 'long'
  }

  // If no clear match, don't migrate (return null)
  return null
}

export const useEpisodeFilters = (storageKey: string = DEFAULT_STORAGE_KEY) => {
  const collapsedKey = `${storageKey}.collapsed`

  const [filters, setFilters] = useState<FilterState>(() => {
    if (typeof window === 'undefined') return DEFAULT_FILTERS
    try {
      const saved = localStorage.getItem(storageKey)
      if (!saved) {
        // Check for legacy migration (only for archive tab)
        if (storageKey === 'planner.filters.v1.archive') {
          const legacySaved = localStorage.getItem(DEFAULT_STORAGE_KEY)
          if (legacySaved) {
            console.log('[filters.init] Migrating legacy filters to archive tab')
            const parsed = JSON.parse(legacySaved)
            const { genres, durationMin, durationMax, lastAiredStart, lastAiredEnd, ...rest } =
              parsed
            const durationPreset = migrateLegacyDuration(durationMin, durationMax)
            const result = { ...DEFAULT_FILTERS, ...rest, durationPreset }

            // One-time fix: if durationPreset is '120' and it seems like unwanted migration, reset it
            if (result.durationPreset === '120' && (durationMin === null || durationMax === null)) {
              console.log('[filters.init] Resetting unwanted 120 preset')
              result.durationPreset = null
            }

            // Save migrated data to new key
            localStorage.setItem(storageKey, JSON.stringify(result))
            // Remove legacy key
            localStorage.removeItem(DEFAULT_STORAGE_KEY)
            return result
          }
        }
        return DEFAULT_FILTERS
      }
      const parsed = JSON.parse(saved)

      // Debug logging
      console.log('[filters.init] Raw localStorage data:', parsed)

      // Migrate old shape
      const { genres, durationMin, durationMax, lastAiredStart, lastAiredEnd, ...rest } = parsed

      // Map old duration to preset
      const durationPreset = migrateLegacyDuration(durationMin, durationMax)

      console.log(
        '[filters.init] Migrated durationPreset:',
        durationPreset,
        'from min:',
        durationMin,
        'max:',
        durationMax,
      )

      const result = { ...DEFAULT_FILTERS, ...rest, durationPreset }
      console.log('[filters.init] Final filter state:', result)

      // One-time fix: if durationPreset is '120' and it seems like unwanted migration, reset it
      if (result.durationPreset === '120' && (durationMin === null || durationMax === null)) {
        console.log('[filters.init] Resetting unwanted 120 preset')
        result.durationPreset = null
      }

      return result
    } catch (error) {
      console.error('[filters.init] Error parsing localStorage:', error)
      return DEFAULT_FILTERS
    }
  })

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = localStorage.getItem(collapsedKey)
      return saved === 'true'
    } catch {
      return false
    }
  })

  // Debounce only search field
  const debouncedSearch = useDebounce(filters.search, 300)

  // Create debounced filter state
  const debouncedFilters = useMemo(
    () => ({
      ...filters,
      search: debouncedSearch,
    }),
    [filters, debouncedSearch],
  )

  // Persist filters to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(storageKey, JSON.stringify(filters))
    } catch (e) {
      console.error('Failed to save filters to localStorage:', e)
    }
  }, [filters, storageKey])

  // Persist collapsed state
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(collapsedKey, String(collapsed))
    } catch (e) {
      console.error('Failed to save collapsed state to localStorage:', e)
    }
  }, [collapsed, collapsedKey])

  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  return {
    filters,
    debouncedFilters,
    collapsed,
    setCollapsed,
    setSearch: (v: string) => updateFilter('search', v),
    setMoods: (v: string[]) => updateFilter('moods', v),
    setTones: (v: string[]) => updateFilter('tones', v),
    setEnergy: (v: string | null) => updateFilter('energy', v),
    setDurationPreset: (v: FilterState['durationPreset']) => updateFilter('durationPreset', v),
    setPlayCountMin: (v: number | null) => updateFilter('playCountMin', v),
    setPlayCountMax: (v: number | null) => updateFilter('playCountMax', v),
    clearAll: () => setFilters(DEFAULT_FILTERS),
  }
}
