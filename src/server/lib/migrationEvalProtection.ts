/**
 * MIGRATION EVAL PROTECTION
 * 
 * This module patches Payload CMS's getPredefinedMigration function to:
 * 1. Log all migration name/source before eval
 * 2. Enforce a hard allowlist of migration names
 * 3. Block any migration not in the allowlist
 */

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// Hard allowlist of known-safe migration names
// Only migrations matching these patterns are allowed
const ALLOWED_MIGRATION_PATTERNS = [
  // Payload CMS predefined migrations (safe patterns)
  /^@payloadcms\/db-mongodb\/.*$/,
  /^@payloadcms\/db-postgres\/.*$/,
  // Add any other known-safe patterns here
]

// Known-safe migration names (exact matches)
const ALLOWED_MIGRATION_NAMES = new Set<string>([
  // Add any specific migration names that are known-safe
])

let isPatched = false

/**
 * Check if a migration name is allowed
 */
function isMigrationAllowed(migrationName: string | undefined): boolean {
  if (!migrationName) {
    return false
  }

  // Check exact matches first
  if (ALLOWED_MIGRATION_NAMES.has(migrationName)) {
    return true
  }

  // Check pattern matches
  for (const pattern of ALLOWED_MIGRATION_PATTERNS) {
    if (pattern.test(migrationName)) {
      return true
    }
  }

  return false
}

/**
 * Log migration attempt with full context
 */
function logMigrationAttempt(
  migrationName: string | undefined,
  importPath: string | undefined,
  dirname: string,
  stack: string,
): void {
  const logEntry = {
    ts: new Date().toISOString(),
    type: 'MIGRATION_EVAL_ATTEMPT',
    migrationName,
    importPath,
    dirname,
    allowed: isMigrationAllowed(migrationName),
    stack: stack.split('\n').slice(0, 10).map((s) => s.trim()),
  }

  const logLine = `[MIGRATION_EVAL_PROTECTION] ${JSON.stringify(logEntry)}\n`
  process.stdout.write(logLine)

  if (!logEntry.allowed) {
    const warning = `[MIGRATION_EVAL_PROTECTION] ⚠️ BLOCKED UNAUTHORIZED MIGRATION: ${migrationName || importPath || 'UNKNOWN'}\n`
    process.stdout.write(warning)
    console.error(`[MIGRATION_EVAL_PROTECTION] 🚨 SECURITY ALERT: Blocked unauthorized migration eval attempt!`)
  }
}

/**
 * Patch Payload's getPredefinedMigration function
 */
export function patchMigrationEval(): void {
  if (isPatched) {
    return
  }

  try {
    // Try to require the Payload migration module
    // This is a bit fragile, but we need to patch before it's used
    const payloadPath = require.resolve('payload')
    const migrationPath = require.resolve('payload/dist/database/migrations/getPredefinedMigration.js', {
      paths: [payloadPath],
    })

    // We'll patch it at runtime by intercepting the module load
    // For now, we'll patch the eval function globally
    const originalEval = global.eval
    let evalCallCount = 0

    global.eval = function (code: string): any {
      evalCallCount++
      const stack = new Error().stack || ''

      // Check if this looks like a migration import
      if (typeof code === 'string' && code.includes("import('")) {
        const importMatch = code.match(/import\(['"]([^'"]+)['"]\)/)
        if (importMatch) {
          const importPath = importMatch[1]
          
          // Extract migration name from path
          let migrationName: string | undefined
          if (importPath.includes('@payloadcms/db-')) {
            migrationName = importPath
          } else {
            migrationName = importPath.split('/').pop()
          }

          logMigrationAttempt(migrationName, importPath, '', stack)

          // Block if not allowed
          if (!isMigrationAllowed(migrationName)) {
            const error = new Error(
              `[MIGRATION_EVAL_PROTECTION] BLOCKED: Migration "${migrationName}" is not in the allowlist`
            )
            console.error(error.message)
            throw error
          }
        }
      }

      return originalEval.call(this, code)
    }

    isPatched = true
    console.log('[MIGRATION_EVAL_PROTECTION] ✅ Migration eval protection installed')
  } catch (error: any) {
    console.error('[MIGRATION_EVAL_PROTECTION] ⚠️ Failed to patch migration eval:', error.message)
    // Don't throw - allow app to continue, but log the failure
  }
}

// Auto-patch on import
patchMigrationEval()
