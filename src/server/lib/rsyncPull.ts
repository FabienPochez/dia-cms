/**
 * Rsync Pull Utility
 * Copies files from Hetzner archive to local working directory
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import { isValidRelativePath, escapeShellArg } from '../../lib/utils/pathSanitizer'

const execAsync = promisify(exec)
// Note: execAsync is only used for host-side execution (when not in container)

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

  // Security: Validate paths to prevent command injection
  if (!isValidRelativePath(srcArchivePath)) {
    throw new RsyncPullError(
      'E_INVALID_PATH',
      `Invalid source archive path: contains dangerous characters or traversal attempts`,
    )
  }

  if (!isValidRelativePath(dstWorkingPath)) {
    throw new RsyncPullError(
      'E_INVALID_PATH',
      `Invalid destination working path: contains dangerous characters or traversal attempts`,
    )
  }

  // Build absolute paths (paths are now validated as safe)
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

  // SECURITY: rsyncPull must run on HOST, not in container
  // The container doesn't have SSH access to bx-archive and doesn't have bash
  // This function should NOT be called from inside the Payload container

  // Check for Docker container indicators using robust detection
  let isInsideContainer = false
  let detectionContext: Record<string, any> = {
    HOSTNAME: process.env.HOSTNAME,
    CONTAINER: process.env.CONTAINER,
    cwd: process.cwd(),
  }

  try {
    const fs = require('fs')
    const hasDockerenv = fs.existsSync('/.dockerenv')
    let hasDockerCgroup = false

    if (fs.existsSync('/proc/1/cgroup')) {
      const cgroupContent = fs.readFileSync('/proc/1/cgroup', 'utf8')
      hasDockerCgroup = cgroupContent.includes('docker')
    }

    detectionContext.hasDockerenv = hasDockerenv
    detectionContext.hasDockerCgroup = hasDockerCgroup

    isInsideContainer = hasDockerenv || hasDockerCgroup
  } catch (error) {
    // Fallback to env var checks if file system checks fail
    isInsideContainer =
      !!process.env.CONTAINER || process.env.HOSTNAME?.includes('payload')
    detectionContext.fallbackUsed = true
    detectionContext.fallbackError = (error as Error).message
  }

  // Log detection context for debugging
  console.log(`[RSYNCPULL] Detection context:`, JSON.stringify(detectionContext))

  if (isInsideContainer) {
    // SECURITY: Block execution from inside container
    // rsyncPull must be called from host-side scripts only
    console.log(
      `[RSYNCPULL] EXECUTION_BLOCKED: Running inside container (HOSTNAME=${process.env.HOSTNAME || 'unknown'})`,
    )
    throw new RsyncPullError(
      'E_EXECUTION_BLOCKED',
      'rsyncPull cannot be executed from inside container. This function must be called from host-side scripts only (e.g., cron jobs running on host).',
    )
  }

  // Execute on host only
  const scriptPath = `${process.cwd()}/scripts/sh/archive/rsync_pull.sh`
  const escapedSrc = escapeShellArg(srcArchivePath)
  const escapedDst = escapeShellArg(dstWorkingPath)
  const hostCmd = `bash ${escapeShellArg(scriptPath)} ${escapedSrc} ${escapedDst}`

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
