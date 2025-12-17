import { diagExecFile } from './subprocessDiag'
import { isValidPath } from '../../lib/utils/pathSanitizer'
import fsSync from 'fs'

// LibreTime database configuration
const LIBRETIME_DB_HOST = process.env.LIBRETIME_DB_HOST || 'libretime-postgres-1'
const LIBRETIME_DB_NAME = process.env.LIBRETIME_DB_NAME || 'libretime'
const LIBRETIME_DB_USER = process.env.LIBRETIME_DB_USER || 'libretime'
const LIBRETIME_DB_PASSWORD = process.env.LIBRETIME_DB_PASSWORD || 'libretime'

function isRunningInContainer(): boolean {
  // Prefer explicit signal for our authorized jobs container
  if (process.env.CONTAINER_TYPE === 'jobs') return true
  if (process.env.CONTAINER === 'true') return true
  // Fallback: Docker runtime marker
  try {
    return fsSync.existsSync('/.dockerenv')
  } catch {
    return false
  }
}

/**
 * Update file_exists status in LibreTime database
 * SECURITY: Uses execFile with array arguments to prevent shell injection
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
    // Security: filepath already validated by isValidPath() above
    const escapedPath = filepath.replace(/'/g, "''")
    const sqlQuery = `UPDATE cc_files SET file_exists = ${existsValue} WHERE filepath = '${escapedPath}';`

    const isInsideContainer = isRunningInContainer()

    console.log(`🔄 Updating LibreTime DB: file_exists=${existsValue} for ${filepath}`)

    // Security: Use execFile with array arguments to prevent shell injection
    // Pass SQL query via -c argument to avoid shell interpretation
    let stderr: string
    if (isInsideContainer) {
      // Inside container: use psql directly with TCP connection
      const execArgs = [
        '-h',
        LIBRETIME_DB_HOST,
        '-U',
        LIBRETIME_DB_USER,
        '-d',
        LIBRETIME_DB_NAME,
        '-c',
        sqlQuery,
      ]
      console.log(
        `[SUBPROC] libretimeDb.updateLibreTimeFileExists execFile: psql args=`,
        JSON.stringify(execArgs),
      )
      const { stderr: psqlStderr } = await diagExecFile(
        'psql',
        execArgs,
        {
          timeout: 10000,
          env: {
            ...process.env,
            PGPASSWORD: LIBRETIME_DB_PASSWORD,
          },
        },
        'libretimeDb.updateLibreTimeFileExists.psql',
      )
      stderr = psqlStderr || ''
    } else {
      // On host: use docker exec with execFile
      const execArgs = [
        'exec',
        '-i',
        'libretime-postgres-1',
        'psql',
        '-U',
        LIBRETIME_DB_USER,
        '-d',
        LIBRETIME_DB_NAME,
        '-c',
        sqlQuery,
      ]
      console.log(
        `[SUBPROC] libretimeDb.updateLibreTimeFileExists execFile: docker args=`,
        JSON.stringify(execArgs),
      )
      const { stderr: dockerStderr } = await diagExecFile(
        'docker',
        execArgs,
        {
          timeout: 10000,
        },
        'libretimeDb.updateLibreTimeFileExists.docker',
      )
      stderr = dockerStderr || ''
    }

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
 * SECURITY: Uses execFile with array arguments to prevent shell injection
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

    const isInsideContainer = isRunningInContainer()

    console.log(`🔄 Batch updating LibreTime DB: ${updates.length} files`)

    // Security: Use execFile with array arguments to prevent shell injection
    // Pass SQL query via -c argument to avoid shell interpretation
    let stderr: string
    if (isInsideContainer) {
      // Inside container: use psql directly with TCP connection
      const execArgs = [
        '-h',
        LIBRETIME_DB_HOST,
        '-U',
        LIBRETIME_DB_USER,
        '-d',
        LIBRETIME_DB_NAME,
        '-c',
        sqlCommand,
      ]
      console.log(
        `[SUBPROC] libretimeDb.updateLibreTimeFileExistsBatch execFile: psql args=`,
        JSON.stringify(execArgs),
      )
      const { stderr: psqlStderr } = await diagExecFile(
        'psql',
        execArgs,
        {
          timeout: 30000,
          env: {
            ...process.env,
            PGPASSWORD: LIBRETIME_DB_PASSWORD,
          },
        },
        'libretimeDb.updateLibreTimeFileExistsBatch.psql',
      )
      stderr = psqlStderr || ''
    } else {
      // On host: use docker exec with execFile
      const execArgs = [
        'exec',
        '-i',
        'libretime-postgres-1',
        'psql',
        '-U',
        LIBRETIME_DB_USER,
        '-d',
        LIBRETIME_DB_NAME,
        '-c',
        sqlCommand,
      ]
      console.log(
        `[SUBPROC] libretimeDb.updateLibreTimeFileExistsBatch execFile: docker args=`,
        JSON.stringify(execArgs),
      )
      const { stderr: dockerStderr } = await diagExecFile(
        'docker',
        execArgs,
        {
          timeout: 30000,
        },
        'libretimeDb.updateLibreTimeFileExistsBatch.docker',
      )
      stderr = dockerStderr || ''
    }

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
