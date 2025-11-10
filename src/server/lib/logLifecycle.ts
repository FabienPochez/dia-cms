/**
 * Lifecycle Operations Logger
 * Appends JSONL entries to /srv/media/logs/rehydrate-operations.jsonl
 */

import fs from 'fs/promises'
import path from 'path'

const LOG_DIR = '/srv/media/logs'
const LOG_FILE = path.join(LOG_DIR, 'rehydrate-operations.jsonl')

export interface LifecycleLogEntry {
  operation: 'rehydrate'
  event: 'start' | 'ok' | 'copied' | 'error'
  episodeId: string
  workingPath?: string
  archivePath?: string
  bytes?: number
  duration_ms?: number
  code?: string
  message?: string
  ts: string
}

/**
 * Append JSONL log entry for lifecycle operation
 */
export async function logLifecycle(entry: LifecycleLogEntry): Promise<void> {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true })
    await fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n')
  } catch (error) {
    console.warn(`⚠️  Failed to write lifecycle log: ${(error as Error).message}`)
  }
}
