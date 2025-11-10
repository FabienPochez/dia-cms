import fs from 'fs/promises'
import path from 'path'

/**
 * Per-episode locking mechanism to prevent concurrent processing
 */

const LOCK_DIR = '/tmp'
const LOCK_PREFIX = 'cron-episode-'

/**
 * Acquire a lock for a specific episode
 * Creates a lockfile with PID to prevent concurrent processing
 *
 * @param episodeId - The episode ID to lock
 * @returns Promise<boolean> - true if lock acquired, false if already locked
 */
export async function acquireEpisodeLock(episodeId: string): Promise<boolean> {
  const lockPath = path.join(LOCK_DIR, `${LOCK_PREFIX}${episodeId}.lock`)

  try {
    // Check if lockfile exists
    await fs.access(lockPath)

    // Lockfile exists, check if it's stale (older than 1 hour)
    const stats = await fs.stat(lockPath)
    const age = Date.now() - stats.mtime.getTime()
    const maxAge = 60 * 60 * 1000 // 1 hour in milliseconds

    if (age > maxAge) {
      // Stale lock, remove it and create new one
      await fs.unlink(lockPath)
      console.log(`🔓 Removed stale lock for episode ${episodeId}`)
    } else {
      // Active lock exists
      return false
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      // Some other error occurred
      throw error
    }
    // Lockfile doesn't exist, which is what we want
  }

  try {
    // Create lockfile with PID and timestamp
    const lockContent = `${process.pid}\n${Date.now()}\n`
    await fs.writeFile(lockPath, lockContent)
    console.log(`🔒 Acquired lock for episode ${episodeId}`)
    return true
  } catch (error: any) {
    // Failed to create lockfile (race condition)
    console.warn(`⚠️ Failed to acquire lock for episode ${episodeId}: ${error.message}`)
    return false
  }
}

/**
 * Release a lock for a specific episode
 * Removes the lockfile if it belongs to this process
 *
 * @param episodeId - The episode ID to unlock
 * @returns Promise<boolean> - true if lock released, false if not owned by this process
 */
export async function releaseEpisodeLock(episodeId: string): Promise<boolean> {
  const lockPath = path.join(LOCK_DIR, `${LOCK_PREFIX}${episodeId}.lock`)

  try {
    // Read lockfile content
    const content = await fs.readFile(lockPath, 'utf-8')
    const lines = content.trim().split('\n')
    const lockPid = parseInt(lines[0], 10)

    // Check if this process owns the lock
    if (lockPid !== process.pid) {
      console.warn(`⚠️ Cannot release lock for episode ${episodeId}: owned by PID ${lockPid}`)
      return false
    }

    // Remove lockfile
    await fs.unlink(lockPath)
    console.log(`🔓 Released lock for episode ${episodeId}`)
    return true
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Lockfile doesn't exist
      return true
    }
    console.warn(`⚠️ Failed to release lock for episode ${episodeId}: ${error.message}`)
    return false
  }
}

/**
 * Check if an episode is currently locked
 *
 * @param episodeId - The episode ID to check
 * @returns Promise<boolean> - true if locked, false if not
 */
export async function isEpisodeLocked(episodeId: string): Promise<boolean> {
  const lockPath = path.join(LOCK_DIR, `${LOCK_PREFIX}${episodeId}.lock`)

  try {
    await fs.access(lockPath)

    // Check if lock is stale
    const stats = await fs.stat(lockPath)
    const age = Date.now() - stats.mtime.getTime()
    const maxAge = 60 * 60 * 1000 // 1 hour in milliseconds

    if (age > maxAge) {
      // Stale lock, consider it unlocked
      return false
    }

    return true
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

/**
 * Clean up stale locks (older than 1 hour)
 * Useful for maintenance tasks
 *
 * @returns Promise<number> - Number of stale locks removed
 */
export async function cleanupStaleLocks(): Promise<number> {
  let removedCount = 0

  try {
    const files = await fs.readdir(LOCK_DIR)
    const lockFiles = files.filter((file) => file.startsWith(LOCK_PREFIX))

    for (const file of lockFiles) {
      const lockPath = path.join(LOCK_DIR, file)

      try {
        const stats = await fs.stat(lockPath)
        const age = Date.now() - stats.mtime.getTime()
        const maxAge = 60 * 60 * 1000 // 1 hour in milliseconds

        if (age > maxAge) {
          await fs.unlink(lockPath)
          removedCount++
          console.log(`🧹 Removed stale lock: ${file}`)
        }
      } catch (error: any) {
        console.warn(`⚠️ Failed to process lock file ${file}: ${error.message}`)
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ Failed to cleanup stale locks: ${error.message}`)
  }

  return removedCount
}
