/**
 * Rsync Pull Utility
 * Copies files from Hetzner archive to local working directory
 */

import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { isValidRelativePath, escapeShellArg } from '../../lib/utils/pathSanitizer'
import { diagExec } from './subprocessDiag'

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

  // SECURITY: rsyncPull must run on HOST or in authorized jobs container
  // The Payload container doesn't have SSH access to bx-archive and doesn't have bash
  // The jobs container is authorized and will have SSH keys mounted

  // Check for Docker container indicators using ESM-compatible detection
  let isInsideContainer = false
  let isAuthorizedContainer = false
  let detectionContext: Record<string, any> = {
    HOSTNAME: process.env.HOSTNAME,
    CONTAINER: process.env.CONTAINER,
    cwd: process.cwd(),
  }

  try {
    // Use ESM-compatible fs (already imported at top of file)
    const hasDockerenv = fsSync.existsSync('/.dockerenv')
    let hasDockerCgroup = false

    if (fsSync.existsSync('/proc/1/cgroup')) {
      const cgroupContent = fsSync.readFileSync('/proc/1/cgroup', 'utf8')
      hasDockerCgroup = cgroupContent.includes('docker')
    }

    detectionContext.hasDockerenv = hasDockerenv
    detectionContext.hasDockerCgroup = hasDockerCgroup

    isInsideContainer = hasDockerenv || hasDockerCgroup
    
    // SECURITY: Only allow jobs container (ephemeral, authorized for cron)
    // Jobs container is identified by CONTAINER_TYPE=jobs environment variable
    isAuthorizedContainer = process.env.CONTAINER_TYPE === 'jobs'
    
  } catch (error) {
    // Fallback to env var checks if file system checks fail
    isInsideContainer = !!process.env.CONTAINER || process.env.HOSTNAME?.includes('payload')
    // SECURITY: Only allow jobs container (identified by CONTAINER_TYPE env var)
    isAuthorizedContainer = process.env.CONTAINER_TYPE === 'jobs'
    detectionContext.fallbackUsed = true
    detectionContext.fallbackError = (error as Error).message
  }

  // Log detection context for debugging
  console.log(`[RSYNCPULL] Detection context:`, JSON.stringify(detectionContext))

  if (isInsideContainer && !isAuthorizedContainer) {
    // SECURITY: Block execution from unauthorized containers (e.g., Payload container)
    // Only allow jobs container (ephemeral, authorized for cron jobs)
    console.log(
      `[RSYNCPULL] EXECUTION_BLOCKED: Running inside unauthorized container (HOSTNAME=${process.env.HOSTNAME || 'unknown'})`,
    )
    throw new RsyncPullError(
      'E_EXECUTION_BLOCKED',
      'rsyncPull cannot be executed from inside unauthorized container. Only jobs container (ephemeral cron) is allowed.',
    )
  }
  
  // If in authorized jobs container, proceed (SSH keys will be mounted)
  // If on host, proceed normally

  // Execute on host only
  const scriptPath = `${process.cwd()}/scripts/sh/archive/rsync_pull.sh`
  const escapedSrc = escapeShellArg(srcArchivePath)
  const escapedDst = escapeShellArg(dstWorkingPath)
  const hostCmd = `bash ${escapeShellArg(scriptPath)} ${escapedSrc} ${escapedDst}`

  console.log(`[SUBPROC] rsyncPull.exec exec: cmd=`, hostCmd)

  // Execute rsync with retry logic
  const maxRetries = 2
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { stdout } = await diagExec(hostCmd, { timeout: 300000 }, 'rsyncPull.host')

      // Parse file size from stdout (last line from script is the byte count)
      const bytes = parseInt(stdout.trim().split('\n').pop() || '0', 10)

      return {
        bytes: bytes || 0,
        duration_ms: Date.now() - startTime,
      }
    } catch (error: any) {
      lastError = error

      // Log the actual error for debugging
      const stackPreview =
        typeof error?.stack === 'string'
          ? error.stack
              .split('\n')
              .slice(0, 10)
              .map((line: string) => line.trim())
              .join(' | ')
          : undefined
      console.error(`[RSYNCPULL] Error on attempt ${attempt + 1}:`, {
        message: error.message,
        code: error.code,
        stdout: error.stdout?.substring(0, 200),
        stderr: error.stderr?.substring(0, 200),
        // Only include stack when we hit unexpected Node API misuse / signature issues
        stack: error.code === 'ERR_INVALID_ARG_TYPE' ? stackPreview : undefined,
      })

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
