import { exec } from 'child_process'
import { promisify } from 'util'
import { isValidPath, escapeShellArg } from '../../lib/utils/pathSanitizer'

const execAsync = promisify(exec)

// LibreTime database configuration
const LIBRETIME_DB_HOST = process.env.LIBRETIME_DB_HOST || 'libretime-postgres-1'
const LIBRETIME_DB_NAME = process.env.LIBRETIME_DB_NAME || 'libretime'
const LIBRETIME_DB_USER = process.env.LIBRETIME_DB_USER || 'libretime'
const LIBRETIME_DB_PASSWORD = process.env.LIBRETIME_DB_PASSWORD || 'libretime'

/**
 * Update file_exists status in LibreTime database
 */
export async function updateLibreTimeFileExists(
  filepath: string,
  exists: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Security: Validate filepath to prevent command injection
    if (!isValidPath(filepath)) {
      const errorMsg = `Invalid filepath: contains dangerous characters`
      console.error(`❌ ${errorMsg}`)
      return { success: false, error: errorMsg }
    }

    const existsValue = exists ? 'true' : 'false'

    // Escape single quotes in filepath for SQL (double single quotes)
    const escapedPath = filepath.replace(/'/g, "''")

    // Try docker exec first (from host), fallback to psql (from container)
    let command: string
    const isInsideContainer =
      process.env.HOSTNAME?.includes('payload') || process.env.CONTAINER === 'true'

    // Security: Use escaped path in SQL query (already validated above)
    // The escapedPath is safe for SQL (single quotes escaped), and filepath was validated
    if (isInsideContainer) {
      // Inside container: use psql directly with TCP connection
      // Note: escapedPath is safe - validated and SQL-escaped
      command = `PGPASSWORD='${LIBRETIME_DB_PASSWORD}' psql -h ${LIBRETIME_DB_HOST} -U ${LIBRETIME_DB_USER} -d ${LIBRETIME_DB_NAME} -c "UPDATE cc_files SET file_exists = ${existsValue} WHERE filepath = '${escapedPath}';"`
    } else {
      // On host: use docker exec
      // Note: escapedPath is safe - validated and SQL-escaped
      command = `docker exec -i libretime-postgres-1 psql -U ${LIBRETIME_DB_USER} -d ${LIBRETIME_DB_NAME} -c "UPDATE cc_files SET file_exists = ${existsValue} WHERE filepath = '${escapedPath}';"`
    }

    console.log(`🔄 Updating LibreTime DB: file_exists=${existsValue} for ${filepath}`)

    const { stderr } = await execAsync(command, {
      timeout: 10000, // 10 second timeout
    })

    if (stderr && !stderr.includes('UPDATE')) {
      console.warn(`⚠️ LibreTime DB warning: ${stderr.trim()}`)
    }

    console.log(`✅ LibreTime DB updated: ${filepath} -> file_exists=${existsValue}`)
    return { success: true }
  } catch (error: unknown) {
    const errorMsg = `Failed to update LibreTime DB for ${filepath}: ${(error as Error).message}`
    console.error(`❌ ${errorMsg}`)
    return { success: false, error: errorMsg }
  }
}

/**
 * Update multiple files' file_exists status in LibreTime database
 */
export async function updateLibreTimeFileExistsBatch(
  updates: Array<{ filepath: string; exists: boolean }>,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (updates.length === 0) {
      return { success: true }
    }

    // Security: Validate all filepaths before processing
    for (const { filepath } of updates) {
      if (!isValidPath(filepath)) {
        const errorMsg = `Invalid filepath in batch update: contains dangerous characters`
        console.error(`❌ ${errorMsg}`)
        return { success: false, error: errorMsg }
      }
    }

    // Build a single SQL command for all updates
    const updateClauses = updates
      .map(({ filepath, exists }) => {
        // Security: filepath already validated above
        const escapedPath = filepath.replace(/'/g, "''")
        const existsValue = exists ? 'true' : 'false'
        return `WHEN '${escapedPath}' THEN ${existsValue}`
      })
      .join(' ')

    const filepaths = updates
      .map(({ filepath }) => {
        // Security: filepath already validated above
        const escapedPath = filepath.replace(/'/g, "''")
        return `'${escapedPath}'`
      })
      .join(',')

    const sqlCommand = `UPDATE cc_files SET file_exists = CASE filepath ${updateClauses} ELSE file_exists END WHERE filepath IN (${filepaths});`

    // Try docker exec first (from host), fallback to psql (from container)
    let command: string
    const isInsideContainer =
      process.env.HOSTNAME?.includes('payload') || process.env.CONTAINER === 'true'

    if (isInsideContainer) {
      // Inside container: use psql directly with TCP connection
      command = `PGPASSWORD='${LIBRETIME_DB_PASSWORD}' psql -h ${LIBRETIME_DB_HOST} -U ${LIBRETIME_DB_USER} -d ${LIBRETIME_DB_NAME} -c "${sqlCommand}"`
    } else {
      // On host: use docker exec
      command = `docker exec -i libretime-postgres-1 psql -U ${LIBRETIME_DB_USER} -d ${LIBRETIME_DB_NAME} -c "${sqlCommand}"`
    }

    console.log(`🔄 Batch updating LibreTime DB: ${updates.length} files`)

    const { stderr } = await execAsync(command, {
      timeout: 30000, // 30 second timeout for batch operations
    })

    if (stderr && !stderr.includes('UPDATE')) {
      console.warn(`⚠️ LibreTime DB warning: ${stderr.trim()}`)
    }

    console.log(`✅ LibreTime DB batch update completed: ${updates.length} files`)
    return { success: true }
  } catch (error: unknown) {
    const errorMsg = `Failed to batch update LibreTime DB: ${(error as Error).message}`
    console.error(`❌ ${errorMsg}`)
    return { success: false, error: errorMsg }
  }
}
