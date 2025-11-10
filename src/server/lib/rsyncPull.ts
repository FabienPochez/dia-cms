/**
 * Rsync Pull Utility
 * Copies files from Hetzner archive to local working directory
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'

const execAsync = promisify(exec)

export interface RsyncPullResult {
  bytes: number
  duration_ms: number
}

export class RsyncPullError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'RsyncPullError'
  }
}

/**
 * Pull file from Hetzner archive to local working directory
 *
 * @param srcArchivePath - Relative path in archive (e.g., "legacy/file.mp3")
 * @param dstWorkingPath - Relative path in working dir (e.g., "imported/1/Artist/Album/file.mp3")
 * @returns Result with bytes transferred and duration
 */
export async function rsyncPull(
  srcArchivePath: string,
  dstWorkingPath: string,
): Promise<RsyncPullResult> {
  const startTime = Date.now()

  // Build absolute paths
  const srcAbs = `bx-archive:/home/archive/${srcArchivePath}`
  const dstAbs = `/srv/media/${dstWorkingPath}`

  // Check if destination already exists (idempotent - skip if exists)
  try {
    await fs.access(dstAbs)
    // File already exists, get size and return (no copy needed)
    const stats = await fs.stat(dstAbs)
    return {
      bytes: stats.size,
      duration_ms: Date.now() - startTime,
    }
  } catch {
    // File doesn't exist, proceed with copy
  }

  // Call rsync_pull.sh script on HOST via docker exec
  // This is necessary because the container doesn't have SSH access to bx-archive
  const scriptPath = `${process.cwd()}/scripts/sh/archive/rsync_pull.sh`
  const hostCmd = `bash "${scriptPath}" "${srcArchivePath}" "${dstWorkingPath}"`

  // Execute rsync with retry logic
  const maxRetries = 2
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { stdout } = await execAsync(hostCmd, { timeout: 300000 }) // 5 min timeout

      // Parse file size from stdout (last line from script is the byte count)
      const bytes = parseInt(stdout.trim().split('\n').pop() || '0', 10)

      return {
        bytes: bytes || 0,
        duration_ms: Date.now() - startTime,
      }
    } catch (error: any) {
      lastError = error

      // Check if error indicates source file not found
      const errorMsg = error.message || ''
      const isFileNotFound =
        errorMsg.includes('No such file or directory') ||
        errorMsg.includes('failed: No such file') ||
        errorMsg.includes('rsync error: some files') ||
        error.code === 23 // rsync exit code 23 = partial transfer (source missing)

      if (isFileNotFound) {
        throw new RsyncPullError(
          'E_ARCHIVE_MISSING',
          `Archive file not found on remote: ${srcArchivePath}`,
        )
      }

      if (attempt < maxRetries) {
        const backoffTime = Math.pow(2, attempt + 1) + 1
        console.log(
          `⚠️  Rsync failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffTime}s...`,
        )
        await new Promise((resolve) => setTimeout(resolve, backoffTime * 1000))
      }
    }
  }

  throw new RsyncPullError(
    'E_COPY_FAILED',
    `Rsync failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
  )
}
