'use client'

import React from 'react'
import { FilterState } from '../hooks/useEpisodeFilters'

interface EpisodeFiltersProps {
  filters: FilterState
  filterControls: {
    setSearch: (v: string) => void
    setMoods: (v: string[]) => void
    setTones: (v: string[]) => void
    setEnergy: (v: string | null) => void
    setDurationPreset: (v: FilterState['durationPreset']) => void
    setPlayCountMin: (v: number | null) => void
    setPlayCountMax: (v: number | null) => void
    clearAll: () => void
  }
  collapsed: boolean
  onToggleCollapsed: () => void
}

// Duration preset options
const DURATION_PRESETS = [
  { value: 'short' as const, label: 'Short', hint: '< 55 min' },
  { value: '60' as const, label: '≈ 60', hint: '55-65 min' },
  { value: '90' as const, label: '≈ 90', hint: '85-95 min' },
  { value: '120' as const, label: '≈ 120', hint: '115-125 min' },
  { value: '180' as const, label: '≈ 180', hint: '175-185 min' },
  { value: 'long' as const, label: 'Long', hint: '> 185 min' },
]

export const EpisodeFilters: React.FC<EpisodeFiltersProps> = ({
  filters,
  filterControls,
  collapsed,
  onToggleCollapsed,
}) => {
  // Toggle helper for multi-select buttons
  const toggleArrayValue = (arr: string[], value: string) => {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
  }

  return (
    <div
      style={{
        marginBottom: '12px',
        background: '#fff',
        borderRadius: '4px',
        border: '1px solid #ddd',
      }}
    >
      {/* Header */}
      <div
        onClick={onToggleCollapsed}
        style={{
          padding: '8px 10px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: collapsed ? 'none' : '1px solid #e0e0e0',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: '600', color: '#333' }}>Filters</span>
        <span style={{ fontSize: '11px', color: '#666' }}>{collapsed ? '▼' : '▲'}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: '10px', maxHeight: '40vh', overflowY: 'auto' }}>
          {/* Search */}
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Search</label>
            <input
              type="text"
              placeholder="Title, show..."
              value={filters.search}
              onChange={(e) => filterControls.setSearch(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Mood Button Multi-Select */}
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Moods</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {MOOD_OPTIONS.map((m) => (
                <button
                  key={m}
                  onClick={() => filterControls.setMoods(toggleArrayValue(filters.moods, m))}
                  style={{
                    padding: '4px 8px',
                    fontSize: '10px',
                    fontWeight: '600',
                    textTransform: 'capitalize',
                    border: `1px solid ${filters.moods.includes(m) ? '#007bff' : '#ced4da'}`,
                    borderRadius: '3px',
                    background: filters.moods.includes(m) ? '#007bff' : '#fff',
                    color: filters.moods.includes(m) ? '#fff' : '#333',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (!filters.moods.includes(m)) {
                      e.currentTarget.style.background = '#f8f9fa'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!filters.moods.includes(m)) {
                      e.currentTarget.style.background = '#fff'
                    }
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Tone Button Multi-Select */}
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Tones</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {TONE_OPTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => filterControls.setTones(toggleArrayValue(filters.tones, t))}
                  style={{
                    padding: '4px 8px',
                    fontSize: '10px',
                    fontWeight: '600',
                    textTransform: 'capitalize',
                    border: `1px solid ${filters.tones.includes(t) ? '#007bff' : '#ced4da'}`,
                    borderRadius: '3px',
                    background: filters.tones.includes(t) ? '#007bff' : '#fff',
                    color: filters.tones.includes(t) ? '#fff' : '#333',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (!filters.tones.includes(t)) {
                      e.currentTarget.style.background = '#f8f9fa'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!filters.tones.includes(t)) {
                      e.currentTarget.style.background = '#fff'
                    }
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Energy Toggle */}
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Energy</label>
            <div style={{ display: 'flex', gap: '5px' }}>
              {ENERGY_OPTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => filterControls.setEnergy(e === filters.energy ? null : e)}
                  style={{
                    flex: 1,
                    padding: '5px 8px',
                    fontSize: '11px',
                    fontWeight: '600',
                    textTransform: 'capitalize',
                    border: `1px solid ${e === filters.energy ? '#007bff' : '#ced4da'}`,
                    borderRadius: '3px',
                    background: e === filters.energy ? '#007bff' : '#fff',
                    color: e === filters.energy ? '#fff' : '#333',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(ev) => {
                    if (e !== filters.energy) {
                      ev.currentTarget.style.background = '#f8f9fa'
                    }
                  }}
                  onMouseLeave={(ev) => {
                    if (e !== filters.energy) {
                      ev.currentTarget.style.background = '#fff'
                    }
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Duration Preset Buttons */}
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Duration</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() =>
                    filterControls.setDurationPreset(
                      preset.value === filters.durationPreset ? null : preset.value,
                    )
                  }
                  title={preset.hint}
                  style={{
                    padding: '5px 10px',
                    fontSize: '11px',
                    fontWeight: '600',
                    border: `1px solid ${preset.value === filters.durationPreset ? '#007bff' : '#ced4da'}`,
                    borderRadius: '3px',
                    background: preset.value === filters.durationPreset ? '#007bff' : '#fff',
                    color: preset.value === filters.durationPreset ? '#fff' : '#333',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (preset.value !== filters.durationPreset) {
                      e.currentTarget.style.background = '#f8f9fa'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (preset.value !== filters.durationPreset) {
                      e.currentTarget.style.background = '#fff'
                    }
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Play Count Range */}
          <div style={{ marginBottom: '10px' }}>
            <label style={labelStyle}>Play Count</label>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <input
                type="number"
                placeholder="Min"
                value={filters.playCountMin ?? ''}
                onChange={(e) =>
                  filterControls.setPlayCountMin(e.target.value ? +e.target.value : null)
                }
                style={{ ...inputStyle, flex: 1, padding: '5px 6px', fontSize: '12px' }}
              />
              <span style={{ color: '#999', fontSize: '11px' }}>–</span>
              <input
                type="number"
                placeholder="Max"
                value={filters.playCountMax ?? ''}
                onChange={(e) =>
                  filterControls.setPlayCountMax(e.target.value ? +e.target.value : null)
                }
                style={{ ...inputStyle, flex: 1, padding: '5px 6px', fontSize: '12px' }}
              />
            </div>
          </div>

          {/* Clear All */}
          <button
            onClick={filterControls.clearAll}
            style={{
              width: '100%',
              padding: '7px',
              fontSize: '12px',
              fontWeight: '600',
              color: '#dc3545',
              background: '#fff',
              border: '1px solid #dc3545',
              borderRadius: '3px',
              cursor: 'pointer',
              transition: 'all 0.15s',
              marginTop: '6px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#dc3545'
              e.currentTarget.style.color = '#fff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fff'
              e.currentTarget.style.color = '#dc3545'
            }}
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  )
}

// Styles
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '10px',
  fontWeight: '600',
  color: '#555',
  marginBottom: '3px',
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '13px',
  border: '1px solid #ced4da',
  borderRadius: '3px',
  background: '#fff',
  outline: 'none',
}

// Constants from Episodes.ts schema
const MOOD_OPTIONS = [
  'sedative',
  'cozy',
  'groovy',
  'club',
  'adrenaline',
  'hard',
  'psychedelic',
  'leftfield',
  'research',
]

const TONE_OPTIONS = ['dark', 'bright', 'melancholic', 'dreamy', 'nostalgic', 'neutral']

const ENERGY_OPTIONS = ['low', 'medium', 'high']
