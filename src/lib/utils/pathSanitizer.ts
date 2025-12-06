/**
 * Path Sanitization Utilities
 * Prevents command injection by validating and sanitizing file paths
 */

/**
 * Validates that a path contains only safe characters
 * Allows: alphanumeric, forward slash, dash, underscore, dot, space
 * Rejects: shell metacharacters, backslashes, null bytes, etc.
 */
export function isValidPath(path: string): boolean {
  // Reject empty paths
  if (!path || path.length === 0) {
    return false
  }

  // Reject paths with null bytes
  if (path.includes('\0')) {
    return false
  }

  // Reject paths with shell metacharacters
  const dangerousChars = /[;&|`$<>(){}[\]\\]/
  if (dangerousChars.test(path)) {
    return false
  }

  // Reject paths starting with dash (could be interpreted as command flag)
  if (path.startsWith('-')) {
    return false
  }

  // Reject paths with command substitution attempts
  if (path.includes('$(') || path.includes('`')) {
    return false
  }

  // Allow only safe characters: alphanumeric, /, -, _, ., space
  const safePattern = /^[a-zA-Z0-9/._\s-]+$/
  return safePattern.test(path)
}

/**
 * Sanitizes a path by removing dangerous characters
 * Returns null if path is too dangerous to sanitize
 */
export function sanitizePath(path: string): string | null {
  if (!path) {
    return null
  }

  // Remove null bytes
  let sanitized = path.replace(/\0/g, '')

  // Remove shell metacharacters
  sanitized = sanitized.replace(/[;&|`$<>(){}[\]\\]/g, '')

  // Remove command substitution attempts
  sanitized = sanitized.replace(/\$\(/g, '').replace(/`/g, '')

  // Remove leading dashes
  sanitized = sanitized.replace(/^-+/, '')

  // Trim whitespace
  sanitized = sanitized.trim()

  // If result is empty or still contains dangerous patterns, reject
  if (sanitized.length === 0 || !isValidPath(sanitized)) {
    return null
  }

  return sanitized
}

/**
 * Validates a relative path (no leading slash, no parent directory traversal)
 */
export function isValidRelativePath(path: string): boolean {
  if (!isValidPath(path)) {
    return false
  }

  // Reject absolute paths
  if (path.startsWith('/')) {
    return false
  }

  // Reject parent directory traversal attempts
  if (path.includes('../') || path.includes('..\\')) {
    return false
  }

  // Reject paths starting with parent directory
  if (path.startsWith('..')) {
    return false
  }

  return true
}

/**
 * Escapes a path for use in shell commands
 * Use this when you MUST pass a path to a shell command
 * Prefer using parameterized queries or environment variables instead
 */
export function escapeShellArg(path: string): string {
  // First validate
  if (!isValidPath(path)) {
    throw new Error(`Invalid path: ${path}`)
  }

  // Escape single quotes by replacing ' with '\''
  return `'${path.replace(/'/g, "'\\''")}'`
}

