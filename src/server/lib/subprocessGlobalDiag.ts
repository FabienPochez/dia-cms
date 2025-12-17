/**
 * Global Subprocess Diagnostic Monkey-Patch
 *
 * This module patches child_process methods globally to catch ANY subprocess
 * execution, even from unwrapped code paths. Enhanced with structured logging,
 * request context, and security-aware redaction.
 *
 * Import this at the very top of entrypoints (before any other imports that might use child_process).
 */

// CRITICAL: Capture original functions BEFORE any patching
// Import directly from node:child_process to ensure we get the true originals (ESM consistency)
import * as childProcess from 'node:child_process'
const originalExec = childProcess.exec
const originalExecFile = childProcess.execFile
const originalSpawn = childProcess.spawn
const originalSpawnSync = childProcess.spawnSync
const originalExecSync = childProcess.execSync
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

// SECURITY KILL-SWITCH: Default ON (can be disabled via env var for emergency)
const KILL_SWITCH_ENABLED = process.env.SUBPROCESS_KILL_SWITCH !== '0' // Default: enabled

// SECURITY: Allowlist of known-safe binaries (default, can be overridden via env)
const DEFAULT_ALLOWLIST = ['ffprobe', 'ffmpeg', 'psql', 'rsync', 'docker', 'git']
const ALLOWLIST_OVERRIDE = process.env.SUBPROCESS_ALLOWLIST
  ? process.env.SUBPROCESS_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean)
  : null
const SECURITY_ALLOWLIST = new Set(ALLOWLIST_OVERRIDE || DEFAULT_ALLOWLIST)

// SECURITY: Hard deny list of dangerous binaries (always blocked)
const DENY_LIST = new Set([
  'curl',
  'wget',
  'sh',
  'bash',
  'nc',
  'ncat',
  'python',
  'perl',
  'php',
  'ruby',
  'powershell',
  'cmd',
  'certutil',
  'busybox', // Often used in attacks
])

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
 * SECURITY: Check if command should be blocked by kill-switch
 * Returns: { blocked: boolean, reason?: string }
 */
function shouldBlockCommand(
  method: string,
  command: string,
  args?: string[],
  options?: any,
): { blocked: boolean; reason?: string } {
  // Kill-switch disabled
  if (!KILL_SWITCH_ENABLED) {
    return { blocked: false }
  }

  // Extract base command (first word, before any shell metacharacters)
  const baseCmd = command.split(/[\s|&;<>`$(){}[\]"'\\]/)[0].toLowerCase().trim()
  
  // SECURITY EXCEPTION: Allow bash for authorized rsync operations
  // Check if this is bash calling our authorized rsync_pull.sh script
  if (baseCmd === 'bash' && command.includes('rsync_pull.sh')) {
    // Verify it's the correct script path (authorized location)
    const scriptPathMatch = command.match(/bash\s+['"]?([^'"]*rsync_pull\.sh)/)
    if (scriptPathMatch && scriptPathMatch[1]) {
      const scriptPath = scriptPathMatch[1]
      // Only allow if script is in the authorized location
      if (scriptPath.includes('/scripts/sh/archive/rsync_pull.sh') || 
          scriptPath.includes('scripts/sh/archive/rsync_pull.sh')) {
        // This is an authorized rsync operation - allow it
        return { blocked: false }
      }
    }
  }
  
  // Check deny list first (hard deny)
  if (DENY_LIST.has(baseCmd)) {
    return { blocked: true, reason: `deny_list: ${baseCmd}` }
  }

  // For exec/execSync: check if command contains shell metacharacters
  // If it does, and command is not allowlisted, block it
  if (method === 'exec' || method === 'execSync') {
    const hasShellMetachars = /[|&;<>`$(){}[\]"'\\]/.test(command)
    if (hasShellMetachars && !SECURITY_ALLOWLIST.has(baseCmd)) {
      return { blocked: true, reason: `shell_metacharacters_in_exec: ${baseCmd}` }
    }
  }

  // For spawn/execFile: check if shell:true is set
  if ((method === 'spawn' || method === 'spawnSync' || method === 'execFile') && options?.shell) {
    // Only allow shell:true if command is in allowlist
    if (!SECURITY_ALLOWLIST.has(baseCmd)) {
      return { blocked: true, reason: `shell_mode_not_allowed: ${baseCmd}` }
    }
  }

  // Check allowlist (default deny)
  if (!SECURITY_ALLOWLIST.has(baseCmd)) {
    return { blocked: true, reason: `not_in_allowlist: ${baseCmd}` }
  }

  return { blocked: false }
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
 * Log security block event
 */
function logSecurityBlock(
  method: string,
  command: string,
  args: string[] | undefined,
  reason: string,
  options?: any,
) {
  try {
    const timestamp = new Date().toISOString()
    const requestContext = getRequestContext()
    
    // Extract stack trace
    let stack: string | undefined
    try {
      const stackLines = new Error().stack?.split('\n')
      if (stackLines) {
        stack = stackLines
          .slice(2, 2 + 10) // More frames for security blocks
          .map((line) => line.trim())
          .filter((line) => !line.includes('subprocessGlobalDiag'))
          .join(' | ')
      }
    } catch (e) {
      // Skip stack if generation fails
    }

    const fullCmd = args && args.length > 0 ? `${command} ${args.join(' ')}` : command
    const payloadPreview = createPreview(redactSecrets(fullCmd))

    const logEntry: Record<string, any> = {
      event: 'subprocess_security_block',
      severity: 'ERROR',
      executed: false,
      blocked: true,
      timestamp,
      method,
      command: redactSecrets(command),
      args_redacted: args && args.length > 0 ? args.map((a) => redactSecrets(a)) : undefined,
      payload_preview: payloadPreview,
      block_reason: reason,
    }

    if (requestContext) {
      if (requestContext.method) logEntry.req_method = requestContext.method
      if (requestContext.path) logEntry.req_path = requestContext.path
      if (requestContext.cf_ip) logEntry.req_cf_ip = requestContext.cf_ip
      if (requestContext.user) {
        logEntry.user_id = requestContext.user.id
        logEntry.user_role = requestContext.user.role
      }
    }

    if (stack) {
      logEntry.stack = stack
    }

    const logMsg = `[SECURITY BLOCK] ${JSON.stringify(logEntry, null, 2)}\n`
    process.stdout.write(logMsg)
  } catch (e) {
    // If logging fails, silently continue (prevents recursion)
  }
}

/**
 * Log subprocess execution with structured output
 */
function logGlobalSubprocess(method: string, command: string, args?: string[], options?: any) {
  // Prevent recursion - if we're already logging, skip immediately
  // NOTE: isLogging is set by patchedSpawn/patchedSpawnSync BEFORE calling this function
  // CRITICAL: This check must happen FIRST, before any operations that might trigger spawn
  if (isLogging) {
    return
  }

  // SECURITY: Check kill-switch BEFORE logging
  const blockCheck = shouldBlockCommand(method, command, args, options)
  if (blockCheck.blocked) {
    logSecurityBlock(method, command, args, blockCheck.reason || 'unknown', options)
    // Throw error to prevent execution
    const error = new Error(
      `[SECURITY BLOCK] Subprocess execution blocked: ${blockCheck.reason || 'unknown'}`,
    ) as any
    error.code = 'SECURITY_BLOCK'
    error.blocked = true
    error.reason = blockCheck.reason
    throw error
  }

  // Build full command string early to check for malicious payload
  const fullCmd = args && args.length > 0 ? `${command} ${args.join(' ')}` : command
  const payloadHash = hashPayload(fullCmd)
  const MALICIOUS_PAYLOAD_HASH = '3877e9a32afab409'
  const MALICIOUS_INDICATORS = ['167.86.107.35', 'muie.sh', 'curl http://167']
  const isMaliciousPayload = 
    payloadHash === MALICIOUS_PAYLOAD_HASH ||
    MALICIOUS_INDICATORS.some(indicator => fullCmd.includes(indicator))

  // CRITICAL: Never suppress logging for malicious payloads
  let shouldLog, repeatCount, suppressed
  if (isMaliciousPayload) {
    // Force logging, no suppression
    const cmd = args && args.length > 0 ? `${method}:${command}:${args.join(' ')}` : `${method}:${command}`
    const history = commandLogHistory.get(cmd)
    repeatCount = history ? history.count + 1 : 1
    shouldLog = true
    suppressed = false
  } else {
    // Normal rate limiting
    const result = shouldLogCommand(method, command, args)
    shouldLog = result.shouldLog
    repeatCount = result.repeatCount
    suppressed = result.suppressed
  }
  
  if (!shouldLog && !suppressed) {
    return // Not rate limited, but shouldn't log (shouldn't happen)
  }

  // NOTE: isLogging is already set by the caller (patchedSpawn/patchedSpawnSync)
  // We don't set it here to avoid double-setting
  try {
    const timestamp = new Date().toISOString()
    const requestContext = getRequestContext()

    // Build full command string (already computed above for malicious check)
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
    // CRITICAL: Always capture full stack for malicious payloads (no suppression)
    if (DEBUG_MODE || isMaliciousPayload) {
      try {
        const stackLines = new Error().stack?.split('\n')
        if (stackLines) {
          // For malicious payloads, capture MORE stack frames (up to 20)
          const maxFrames = isMaliciousPayload ? 20 : MAX_STACK_FRAMES
          stack = stackLines
            .slice(2, 2 + maxFrames)
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
      suspicious: isMaliciousPayload ? true : undefined, // Mark as suspicious
    }

    // Add full payload in DEBUG mode OR for malicious payloads
    if (DEBUG_MODE || isMaliciousPayload) {
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

    // Add stack trace in DEBUG mode OR for malicious payloads
    if ((DEBUG_MODE || isMaliciousPayload) && stack) {
      logEntry.stack = stack
      logEntry.stack_full = stack.split(' | ') // Also include as array for easier parsing
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
    // NOTE: Do NOT reset isLogging here - it's managed by the caller (patchedSpawn/patchedSpawnSync)
  }
}

// Patch exec
// CRITICAL: Must handle all argument variants:
// - exec(cmd, cb) - callback only
// - exec(cmd, opts, cb) - options + callback
// - exec(cmd, opts) - options only, returns ChildProcess
const patchedExec = function (command: string, optionsOrCallback?: ExecOptions | ((error: any, stdout: string, stderr: string) => void), callback?: (error: any, stdout: string, stderr: string) => void) {
  // Detect argument pattern
  let options: ExecOptions | undefined
  let actualCallback: ((error: any, stdout: string, stderr: string) => void) | undefined
  
  if (typeof optionsOrCallback === 'function') {
    // exec(cmd, cb) - second argument is callback
    actualCallback = optionsOrCallback
    options = undefined
  } else if (typeof callback === 'function') {
    // exec(cmd, opts, cb) - third argument is callback
    options = optionsOrCallback
    actualCallback = callback
  } else {
    // exec(cmd, opts) - second argument is options, returns ChildProcess
    options = optionsOrCallback
    actualCallback = undefined
  }
  
  try {
    logGlobalSubprocess('exec', command, undefined, options)
    // CRITICAL: Use apply() to preserve all argument variants and this context
    return originalExec.apply(this, arguments)
  } catch (error: any) {
    if (error.code === 'SECURITY_BLOCK') {
      // Security block - don't execute
      if (actualCallback) {
        actualCallback(error, '', '')
        return {} as any // Return dummy ChildProcess to match signature
      }
      throw error
    }
    throw error
  }
}

// Patch execSync
const patchedExecSync = function (command: string, options?: ExecOptions) {
  try {
  logGlobalSubprocess('execSync', command, undefined, options)
  return originalExecSync(command, options)
  } catch (error: any) {
    if (error.code === 'SECURITY_BLOCK') {
      // Security block - rethrow to prevent execution
      throw error
    }
    throw error
  }
}

// Patch execFile
const patchedExecFile = function (
  file: string,
  args?: string[],
  options?: ExecFileOptions,
  callback?: any,
) {
  try {
    // SECURITY: Force shell:false for execFile (safer)
    const safeOptions = options ? { ...options, shell: false } : { shell: false }
    logGlobalSubprocess('execFile', file, args, safeOptions)
  if (args && callback) {
      return originalExecFile(file, args, safeOptions, callback)
  } else if (args) {
      return originalExecFile(file, args, safeOptions as any)
  } else if (callback) {
      return originalExecFile(file, safeOptions as any, callback)
  } else {
      return originalExecFile(file, safeOptions as any)
    }
  } catch (error: any) {
    if (error.code === 'SECURITY_BLOCK') {
      // Security block - don't execute
      if (callback) {
        callback(error, null, null)
        return
      }
      throw error
    }
    throw error
  }
}

// Patch spawn
const patchedSpawn = function (command: string, args?: string[], options?: SpawnOptions) {
  // Prevent recursion: if we're already logging, skip logging and call original directly
  if (isLogging) {
    // CRITICAL: Use originalSpawn directly, bypassing all logging
  if (args) {
    return originalSpawn(command, args, options)
  } else {
    return originalSpawn(command, options as any)
    }
  }
  
  // Set flag BEFORE calling logGlobalSubprocess to prevent recursion
  isLogging = true
  try {
    // SECURITY: Force shell:false unless command is allowlisted
    const baseCmd = command.split(/[\s|&;]/)[0].toLowerCase()
    const safeOptions = options
      ? {
          ...options,
          shell: options.shell && SECURITY_ALLOWLIST.has(baseCmd) ? options.shell : false,
        }
      : { shell: false }
    
    // Call logGlobalSubprocess - it will check isLogging internally and return early if needed
    // But we've already set isLogging = true, so any spawn calls from within logGlobalSubprocess
    // will hit the guard at the top of this function and use originalSpawn directly
    logGlobalSubprocess('spawn', command, args, safeOptions)
    
    // Call original AFTER logging - use originalSpawn directly (not patched)
    if (args) {
      return originalSpawn(command, args, safeOptions)
    } else {
      return originalSpawn(command, safeOptions as any)
    }
  } catch (error: any) {
    if (error.code === 'SECURITY_BLOCK') {
      // Security block - rethrow to prevent execution
      throw error
    }
    throw error
  } finally {
    // Always reset flag, even on error
    isLogging = false
  }
}

// Patch spawnSync
const patchedSpawnSync = function (command: string, args?: string[], options?: SpawnOptions) {
  // Prevent recursion: if we're already logging, skip logging and call original directly
  if (isLogging) {
    // CRITICAL: Use originalSpawnSync directly, bypassing all logging
  if (args) {
    return originalSpawnSync(command, args, options)
  } else {
    return originalSpawnSync(command, options as any)
    }
  }
  
  // Set flag BEFORE calling logGlobalSubprocess to prevent recursion
  isLogging = true
  try {
    // SECURITY: Force shell:false unless command is allowlisted
    const baseCmd = command.split(/[\s|&;]/)[0].toLowerCase()
    const safeOptions = options
      ? {
          ...options,
          shell: options.shell && SECURITY_ALLOWLIST.has(baseCmd) ? options.shell : false,
        }
      : { shell: false }
    
    // Call logGlobalSubprocess - it will check isLogging internally and return early if needed
    // But we've already set isLogging = true, so any spawn calls from within logGlobalSubprocess
    // will hit the guard at the top of this function and use originalSpawnSync directly
    logGlobalSubprocess('spawnSync', command, args, safeOptions)
    
    // Call original AFTER logging - use originalSpawnSync directly (not patched)
    if (args) {
      return originalSpawnSync(command, args, safeOptions)
    } else {
      return originalSpawnSync(command, safeOptions as any)
    }
  } catch (error: any) {
    if (error.code === 'SECURITY_BLOCK') {
      // Security block - rethrow to prevent execution
      throw error
    }
    throw error
  } finally {
    // Always reset flag, even on error
    isLogging = false
  }
}

// CRITICAL: Store originals globally BEFORE patching so other modules can access true originals
// This ensures subprocessDiag.ts and other modules can use unpatched exec/execFile
;(globalThis as any).__DIA_ORIG_CP = {
  exec: originalExec,
  execFile: originalExecFile,
  execSync: originalExecSync,
  spawn: originalSpawn,
  spawnSync: originalSpawnSync,
}

// Check if patching is disabled via environment variable
const DISABLE_SUBPROC_PATCH = process.env.DISABLE_SUBPROC_DIAG === 'true'

if (DISABLE_SUBPROC_PATCH) {
  console.log('[SUBPROC_DIAG] ⚠️  Subprocess diagnostic patch DISABLED via DISABLE_SUBPROC_DIAG=true')
} else {
  // Monkey-patch the child_process module
  // CRITICAL: ES modules are read-only, so we need to use Object.defineProperty
  // or use createRequire for CommonJS compatibility
  const require = createRequire(import.meta.url)
  const cp = require('child_process')

  // Patch all methods using Object.defineProperty to override read-only properties
  Object.defineProperty(cp, 'exec', { value: patchedExec, writable: true, configurable: true })
  Object.defineProperty(cp, 'execSync', { value: patchedExecSync, writable: true, configurable: true })
  Object.defineProperty(cp, 'execFile', { value: patchedExecFile, writable: true, configurable: true })
  Object.defineProperty(cp, 'spawn', { value: patchedSpawn, writable: true, configurable: true })
  Object.defineProperty(cp, 'spawnSync', { value: patchedSpawnSync, writable: true, configurable: true })

  // Also patch the promisified versions
  // CRITICAL: Use originalExecAsync (already promisified original) to avoid double-patching
  // If we use promisify(patchedExec), it will go through the patch again causing recursion
  Object.defineProperty(cp, 'execAsync', { value: originalExecAsync, writable: true, configurable: true })
  Object.defineProperty(cp, 'execFileAsync', { value: originalExecFileAsync, writable: true, configurable: true })

  const killSwitchStatus = KILL_SWITCH_ENABLED ? 'ENABLED' : 'DISABLED'
  const allowlistStr = Array.from(SECURITY_ALLOWLIST).join(', ')
  console.log(
    `[SUBPROC_DIAG] ✅ Global child_process monkey-patch installed (rate-limited, structured logging, security kill-switch: ${killSwitchStatus}, allowlist: ${allowlistStr})`,
  )
}

// Re-export patched versions for ES modules (always available, even if patching disabled)
export {
  patchedExec as exec,
  patchedExecSync as execSync,
  patchedExecFile as execFile,
  patchedSpawn as spawn,
  patchedSpawnSync as spawnSync,
}
