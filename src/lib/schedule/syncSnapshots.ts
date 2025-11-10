import { randomUUID } from 'node:crypto'

const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000

export interface SnapshotWindow {
  utcStart: string
  utcEnd: string
  parisStart: string
  parisEnd: string
  weeksLabel: string
  nowUtc: string
  nowParis: string
}

export interface SnapshotPlayout {
  playoutId: number
  instanceId: number
  fileId: number | null
  startsAt: string
  endsAt: string
}

export interface SyncSnapshot {
  id: string
  createdAt: number
  expiresAt: number
  window: SnapshotWindow
  playouts: SnapshotPlayout[]
}

const snapshots = new Map<string, SyncSnapshot>()

function pruneSnapshots(): void {
  const now = Date.now()
  for (const [id, snapshot] of snapshots.entries()) {
    if (snapshot.expiresAt <= now) {
      snapshots.delete(id)
    }
  }
}

export function saveSnapshot(data: {
  window: SnapshotWindow
  playouts: SnapshotPlayout[]
}): SyncSnapshot {
  pruneSnapshots()
  const id = randomUUID()
  const now = Date.now()
  const snapshot: SyncSnapshot = {
    id,
    createdAt: now,
    expiresAt: now + SNAPSHOT_TTL_MS,
    window: data.window,
    playouts: data.playouts,
  }
  snapshots.set(id, snapshot)
  return snapshot
}

export function getSnapshot(id: string): SyncSnapshot | null {
  pruneSnapshots()
  const snapshot = snapshots.get(id)
  if (!snapshot) {
    return null
  }
  if (snapshot.expiresAt <= Date.now()) {
    snapshots.delete(id)
    return null
  }
  return snapshot
}

export function listSnapshots(): SyncSnapshot[] {
  pruneSnapshots()
  return Array.from(snapshots.values())
}


