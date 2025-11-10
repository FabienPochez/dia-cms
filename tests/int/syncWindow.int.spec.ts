import { describe, expect, it } from 'vitest'

import { computeSyncWindow } from '@/lib/schedule/syncWindow'

describe('computeSyncWindow', () => {
  it('covers the previous, current, and next weeks around DST start (Europe/Paris)', () => {
    const now = new Date('2025-03-30T10:00:00Z') // Sunday of DST change

    const result = computeSyncWindow({ now })

    expect(result.parisStart).toBe('2025-03-17T00:00:00+01:00')
    expect(result.parisEnd).toBe('2025-04-06T23:59:59+02:00')
    expect(result.weeksLabel).toBe('2025-W12..2025-W14')
  })

  it('snaps window start to current show when it predates previous Monday', () => {
    const now = new Date('2025-10-15T12:00:00Z') // Wednesday
    const currentShowStartUtc = '2025-10-05T21:30:00Z' // Show started before computed window start

    const result = computeSyncWindow({ now, currentShowStartUtc })

    expect(result.utcStart).toBe('2025-10-05T21:30:00.000Z')
    expect(result.parisStart).toBe('2025-10-05T23:30:00+02:00')
  })

  it('maintains idempotent ISO outputs', () => {
    const now = new Date('2025-02-05T12:00:00Z')

    const first = computeSyncWindow({ now })
    const second = computeSyncWindow({ now })

    expect(first).toEqual(second)
  })

  it('reports three-week duration in milliseconds', () => {
    const now = new Date('2025-01-08T08:00:00Z')
    const { windowDurationMs } = computeSyncWindow({ now })

    const threeWeeksMs = 21 * 24 * 60 * 60 * 1000
    // Allow slight variance due to DST transitions
    expect(windowDurationMs).toBeGreaterThanOrEqual(threeWeeksMs - 2 * 60 * 60 * 1000)
    expect(windowDurationMs).toBeLessThanOrEqual(threeWeeksMs + 2 * 60 * 60 * 1000)
  })
})
