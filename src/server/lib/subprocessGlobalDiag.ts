/**
 * Global Subprocess Diagnostic Monkey-Patch
 *
 * This module patches child_process methods globally to catch ANY subprocess
 * execution, even from unwrapped code paths. Enhanced with structured logging,
 * request context, and security-aware redaction.
 *
 * Import this at the very top of entrypoints (before any other imports that might use child_process).
 */

import {
  exec as originalExec,
  execFile as originalExecFile,
  spawn as originalSpawn,
  spawnSync as originalSpawnSync,
  execSync as originalExecSync,
} from 'child_process'
import { promisify } from 'util'
import { createRequire } from 'module'
import { createHash } from 'crypto'
import { getRequestContext } from './requestContext'

const originalExecAsync = promisify(originalExec)
const originalExecFileAsync = promisify(originalExecFile)

type ExecOptions = import('child_process').ExecOptions
type ExecFileOptions = import('child_process').ExecFileOptions
type SpawnOptions = import('child_process').SpawnOptions

const DEBUG_MODE = process.env.DEBUG_SUBPROC_DIAG === 'true'
const RATE_LIMIT_MS = 1000 // Only log same command once per second
const MAX_STACK_FRAMES = 5 // Reduced from 12 to prevent stack overflow
const REPEAT_WARN_THRESHOLD = 5 // Warn if same command repeated >= 5 times in window
const REPEAT_WINDOW_MS = 60000 // 1 minute window for repeat counting

// Track if we're already logging to prevent recursion
let isLogging = false

// Rate limiting: track command signatures and their last log time
// Prevents stack overflow from malicious code calling execSync in loops
const commandLogHistory = new Map<string, { lastLog: number; count: number; firstSeen: number }>()

// Allowlist of known-safe commands (for better logging, not blocking)
const ALLOWLISTED_COMMANDS = new Set([
  'git',
  'ffprobe',
  'ffmpeg',
  'psql',
  'rsync',
  'docker',
  'node',
  'npm',
  'npx',
])

/**
 * Check if command is allowlisted (for logging purposes only)
 */
function isAllowlisted(command: string, args?: string[]): boolean {
  const cmd = command.split(/[\s|&;]/)[0].toLowerCase()
  return ALLOWLISTED_COMMANDS.has(cmd)
}

/**
 * Check if command should be logged (rate limiting)
 * Returns: { shouldLog: boolean, repeatCount: number, suppressed: boolean }
 * suppressed=true means logging was rate-limited (command still executes)
 */
function shouldLogCommand(
  method: string,
  command: string,
  args?: string[],
): { shouldLog: boolean; repeatCount: number; suppressed: boolean } {
  const cmd = args && args.length > 0 ? `${method}:${command}:${args.join(' ')}` : `${method}:${command}`
  const now = Date.now()
  const history = commandLogHistory.get(cmd)

  if (!history) {
    commandLogHistory.set(cmd, { lastLog: now, count: 1, firstSeen: now })
    return { shouldLog: true, repeatCount: 1, suppressed: false }
  }

  // Update count
  const timeSinceFirst = now - history.firstSeen
  if (timeSinceFirst > REPEAT_WINDOW_MS) {
    // Reset window
    history.count = 1
    history.firstSeen = now
  } else {
    history.count++
  }

  // Check rate limit (suppress logging, but command still executes)
  const timeSinceLastLog = now - history.lastLog
  if (timeSinceLastLog < RATE_LIMIT_MS) {
    return { shouldLog: false, repeatCount: history.count, suppressed: true }
  }

  history.lastLog = now
  return { shouldLog: true, repeatCount: history.count, suppressed: false }
}

/**
 * Redact sensitive information from command string
 */
function redactSecrets(input: string): string {
  return input
    .replace(/Api-Key\s+\S+/gi, 'Api-Key ***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/PGPASSWORD=\S+/gi, 'PGPASSWORD=***')
    .replace(/token=\S+/gi, 'token=***')
    .replace(/password=\S+/gi, 'password=***')
    .replace(/Authorization:\s*\S+/gi, 'Authorization: ***')
    .replace(/Cookie:\s*[^;]+/gi, 'Cookie: ***')
}

/**
 * Extract query string keys only (no values)
 */
function extractQueryKeys(query: string): string[] {
  if (!query || !query.startsWith('?')) return []
  try {
    const params = new URLSearchParams(query.substring(1))
    return Array.from(params.keys())
  } catch {
    return []
  }
}

/**
 * Generate SHA256 hash of payload
 */
function hashPayload(payload: string): string {
  return createHash('sha256').update(payload).digest('hex').substring(0, 16)
}

/**
 * Create payload preview (first 40 chars, no newlines)
 */
function createPreview(payload: string): string {
  return payload.replace(/\n/g, ' ').substring(0, 40)
}

/**
 * Extract source file and function from stack trace
 */
function extractSource(stack?: string): { file?: string; function?: string } {
  if (!stack) return {}
  const lines = stack.split('|')
  if (lines.length === 0) return {}
  const firstLine = lines[0].trim()
  const match = firstLine.match(/at\s+(?:async\s+)?(?:(\S+)\s+)?\(?([^:]+):(\d+):(\d+)\)?/)
  if (match) {
    return {
      function: match[1] || 'anonymous',
      file: match[2] ? match[2].split('/').pop() : undefined,
    }
  }
  return {}
}

/**
 * Classify command category for noise filtering
 */
function classifyCommandCategory(fullCmd: string): 'internal' | 'media' | 'sync' | 'unknown' {
  const cmd = fullCmd.toLowerCase()
  if (cmd.startsWith('git config')) {
    return 'internal'
  }
  if (cmd.startsWith('ffprobe') || cmd.startsWith('ffmpeg')) {
    return 'media'
  }
  if (cmd.includes('rsync')) {
    return 'sync'
  }
  return 'unknown'
}

/**
 * Determine event type and severity
 * Note: Currently we don't block execution (executed is always true), but structure supports future blocking
 */
function determineEventType(
  method: string,
  command: string,
  args: string[] | undefined,
  repeatCount: number,
  suppressed: boolean,
  category: 'internal' | 'media' | 'sync' | 'unknown',
  executionFailed: boolean = false,
): { event: string; severity: string; executed: boolean; blocked: boolean } {
  // If logging was suppressed (rate-limited), use special event
  // Always use DEBUG/INFO for suppressed events (never WARN/ERROR)
  // Skip repeat escalation for internal noise commands
  if (suppressed) {
    const severity = category === 'internal' ? 'DEBUG' : 'INFO'
    return {
      event: 'subprocess_log_suppressed',
      severity,
      executed: true, // Command still executes, only logging is suppressed
      blocked: false, // Execution not blocked
    }
  }

  // If execution failed (future: we could catch errors)
  if (executionFailed) {
    return {
      event: 'subprocess_exec_fail',
      severity: 'ERROR',
      executed: true, // Attempted to execute
      blocked: false, // Not blocked, just failed
    }
  }

  const isAllowlisted = isAllowlisted(command, args)
  if (isAllowlisted) {
    return {
      event: 'subprocess_exec_ok',
      severity: 'INFO',
      executed: true,
      blocked: false,
    }
  }

  // Suspicious command (not allowlisted)
  // Skip repeat escalation for internal noise commands
  const severity =
    category === 'internal' ? 'INFO' : repeatCount >= REPEAT_WARN_THRESHOLD ? 'WARN' : 'INFO'
  return {
    event: 'subprocess_attempt',
    severity,
    executed: true,
    blocked: false,
  }
}

/**
 * Log subprocess execution with structured output
 */
function logGlobalSubprocess(method: string, command: string, args?: string[], options?: any) {
  // Prevent recursion - if we're already logging, skip
  if (isLogging) return

  // Check rate limiting
  const { shouldLog, repeatCount, suppressed } = shouldLogCommand(method, command, args)
  if (!shouldLog && !suppressed) {
    return // Not rate limited, but shouldn't log (shouldn't happen)
  }

  isLogging = true
  try {
    const timestamp = new Date().toISOString()
    const requestContext = getRequestContext()

    // Build full command string
    const fullCmd = args && args.length > 0 ? `${command} ${args.join(' ')}` : command
    const payloadHash = hashPayload(fullCmd)
    const payloadPreview = createPreview(redactSecrets(fullCmd))

    // Classify command category for noise filtering
    const category = classifyCommandCategory(fullCmd)

    // Determine event type and severity
    // Note: executionFailed is always false currently (we don't catch execution errors yet)
    const { event, severity, executed, blocked } = determineEventType(
      method,
      command,
      args,
      repeatCount,
      suppressed,
      category,
      false, // executionFailed - future: catch and pass actual failure status
    )

    // Extract source info (minimal stack trace)
    let source: { file?: string; function?: string } = {}
    let stack: string | undefined
    if (DEBUG_MODE) {
      try {
        const stackLines = new Error().stack?.split('\n')
        if (stackLines) {
          stack = stackLines
            .slice(2, 2 + MAX_STACK_FRAMES)
            .map((line) => line.trim())
            .filter((line) => !line.includes('subprocessGlobalDiag'))
            .join(' | ')
          source = extractSource(stack)
        }
      } catch (e) {
        // Stack generation failed, skip
      }
    } else {
      // Even in non-debug, extract minimal source info
      try {
        const stackLines = new Error().stack?.split('\n')
        if (stackLines && stackLines.length > 2) {
          source = extractSource(stackLines[2])
        }
      } catch (e) {
        // Skip
      }
    }

    // Build request context (redacted)
    const request: Record<string, any> = {}
    if (requestContext) {
      if (requestContext.method) request.method = requestContext.method
      if (requestContext.path) request.path = requestContext.path
      if (requestContext.query) {
        const queryKeys = extractQueryKeys(requestContext.query)
        if (queryKeys.length > 0) {
          request.query_keys_only = queryKeys
        }
      }
      if (requestContext.cf_ip) request.cf_ip = requestContext.cf_ip
      if (requestContext.xff && !requestContext.cf_ip) request.xff = requestContext.xff
      if (requestContext.user_agent) request.user_agent_hash = requestContext.user_agent
      if (requestContext.request_id) request.request_id = requestContext.request_id
    }

    // Build user context
    const user = requestContext?.user
      ? {
          id: requestContext.user.id,
          email: requestContext.user.email,
          role: requestContext.user.role,
        }
      : null

    // Build log entry
    const isAllowlistedCmd = isAllowlisted(command, args)
    const logEntry: Record<string, any> = {
      event,
      severity,
      executed, // true if command executed (or attempted), false if blocked
      blocked, // true if execution was prevented, false otherwise
      logged: !suppressed, // false if logging was suppressed (rate-limited)
      category, // internal|media|sync|unknown
      reason: suppressed
        ? 'log_suppressed'
        : isAllowlistedCmd
          ? 'allowlisted'
          : event === 'subprocess_exec_fail'
            ? 'execution_failed'
            : 'logged',
      timestamp,
      method,
      cmd_allowlisted_name: isAllowlistedCmd ? command.split(/[\s|&;]/)[0] : undefined,
      argv_redacted: args && args.length > 0 ? args.map((a) => redactSecrets(a)) : undefined,
      payload_hash: payloadHash,
      payload_preview: payloadPreview,
      repeat_count: repeatCount,
      repeat_window_seconds: Math.floor(REPEAT_WINDOW_MS / 1000),
    }

    // Add full payload only in DEBUG mode
    if (DEBUG_MODE) {
      logEntry.payload_full = redactSecrets(fullCmd)
    }

    // Add request context if available
    if (Object.keys(request).length > 0) {
      logEntry.request = request
    }

    // Add user context if available
    if (user) {
      logEntry.user = user
    }

    // Add source info
    if (source.file || source.function) {
      logEntry.source = source
    }

    // Add stack trace only in DEBUG mode
    if (DEBUG_MODE && stack) {
      logEntry.stack = stack
    }

    // Format as key=value for easy grepping (or JSON if DEBUG)
    let logMsg: string
    if (DEBUG_MODE) {
      logMsg = `[SUBPROC_DIAG] ${JSON.stringify(logEntry, null, 2)}\n`
    } else {
      // Compact key=value format for production
      const parts = [
        `event=${logEntry.event}`,
        `severity=${logEntry.severity}`,
        `executed=${logEntry.executed}`,
        `blocked=${logEntry.blocked}`,
        `logged=${logEntry.logged}`,
        `category=${logEntry.category}`,
        `reason=${logEntry.reason}`,
        `method=${logEntry.method}`,
        `payload_hash=${logEntry.payload_hash}`,
        `payload_preview="${logEntry.payload_preview}"`,
      ]
      if (logEntry.repeat_count > 1) {
        parts.push(`repeat_count=${logEntry.repeat_count}`)
      }
      if (logEntry.request) {
        if (logEntry.request.method) parts.push(`req_method=${logEntry.request.method}`)
        if (logEntry.request.path) parts.push(`req_path=${logEntry.request.path}`)
        if (logEntry.request.cf_ip) parts.push(`req_cf_ip=${logEntry.request.cf_ip}`)
        if (logEntry.request.xff) parts.push(`req_xff=${logEntry.request.xff}`)
      }
      if (logEntry.user) {
        if (logEntry.user.id) parts.push(`user_id=${logEntry.user.id}`)
        if (logEntry.user.role) parts.push(`user_role=${logEntry.user.role}`)
      }
      if (logEntry.source?.file) {
        parts.push(`source_file=${logEntry.source.file}`)
      }
      logMsg = `[SUBPROC_DIAG] ${parts.join(' ')}\n`
    }

    // Use process.stdout.write directly to avoid console.log recursion
    process.stdout.write(logMsg)
  } catch (e) {
    // If logging fails, silently continue (prevents recursion)
  } finally {
    isLogging = false
  }
}

// Patch exec
const patchedExec = function (command: string, options?: ExecOptions, callback?: any) {
  logGlobalSubprocess('exec', command, undefined, options)
  return originalExec(command, options, callback)
}

// Patch execSync
const patchedExecSync = function (command: string, options?: ExecOptions) {
  logGlobalSubprocess('execSync', command, undefined, options)
  return originalExecSync(command, options)
}

// Patch execFile
const patchedExecFile = function (
  file: string,
  args?: string[],
  options?: ExecFileOptions,
  callback?: any,
) {
  logGlobalSubprocess('execFile', file, args, options)
  if (args && callback) {
    return originalExecFile(file, args, options, callback)
  } else if (args) {
    return originalExecFile(file, args, options as any)
  } else if (callback) {
    return originalExecFile(file, options as any, callback)
  } else {
    return originalExecFile(file, options as any)
  }
}

// Patch spawn
const patchedSpawn = function (command: string, args?: string[], options?: SpawnOptions) {
  logGlobalSubprocess('spawn', command, args, options)
  if (args) {
    return originalSpawn(command, args, options)
  } else {
    return originalSpawn(command, options as any)
  }
}

// Patch spawnSync
const patchedSpawnSync = function (command: string, args?: string[], options?: SpawnOptions) {
  logGlobalSubprocess('spawnSync', command, args, options)
  if (args) {
    return originalSpawnSync(command, args, options)
  } else {
    return originalSpawnSync(command, options as any)
  }
}

// Check if patching is disabled via environment variable
const DISABLE_SUBPROC_PATCH = process.env.DISABLE_SUBPROC_DIAG === 'true'

if (DISABLE_SUBPROC_PATCH) {
  console.log('[SUBPROC_DIAG] ⚠️  Subprocess diagnostic patch DISABLED via DISABLE_SUBPROC_DIAG=true')
} else {
  // Monkey-patch the child_process module
  // Handle ES modules - use createRequire for compatibility
  const require = createRequire(import.meta.url)
  const cp = require('child_process')

  // Patch all methods
  cp.exec = patchedExec
  cp.execSync = patchedExecSync
  cp.execFile = patchedExecFile
  cp.spawn = patchedSpawn
  cp.spawnSync = patchedSpawnSync

  // Also patch the promisified versions
  cp.execAsync = promisify(patchedExec)
  cp.execFileAsync = promisify(patchedExecFile)

  console.log('[SUBPROC_DIAG] ✅ Global child_process monkey-patch installed (rate-limited, structured logging)')
}

// Re-export patched versions for ES modules (always available, even if patching disabled)
export {
  patchedExec as exec,
  patchedExecSync as execSync,
  patchedExecFile as execFile,
  patchedSpawn as spawn,
  patchedSpawnSync as spawnSync,
}
