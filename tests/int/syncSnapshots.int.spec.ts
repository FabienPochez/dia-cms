import { describe, expect, it, vi } from 'vitest'

import { getSnapshot, saveSnapshot } from '@/lib/schedule/syncSnapshots'

describe('syncSnapshots', () => {
  it('stores and expires snapshots according to TTL', () => {
    vi.useFakeTimers()
    try {
      const now = new Date('2025-01-01T00:00:00Z')
      vi.setSystemTime(now)

      const snapshot = saveSnapshot({
        window: {
          utcStart: '2025-01-01T00:00:00.000Z',
          utcEnd: '2025-01-08T00:00:00.000Z',
          parisStart: '2025-01-01T01:00:00+01:00',
          parisEnd: '2025-01-08T01:00:00+01:00',
          weeksLabel: '2025-W01..2025-W02',
          nowUtc: now.toISOString(),
          nowParis: '2025-01-01T01:00:00+01:00',
        },
        playouts: [
          {
            playoutId: 101,
            instanceId: 55,
            fileId: 1234,
            startsAt: '2025-01-02T10:00:00.000Z',
            endsAt: '2025-01-02T11:00:00.000Z',
          },
        ],
      })

      expect(getSnapshot(snapshot.id)).not.toBeNull()

      vi.setSystemTime(now.getTime() + 24 * 60 * 60 * 1000 + 5_000)
      expect(getSnapshot(snapshot.id)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})


