// CRITICAL: Use preserved originals from globalThis to guarantee true native exec/execFile
// This ensures we never use patched versions, regardless of import order
import { promisify } from 'util'
import type { ExecFileOptions, ExecOptions } from 'node:child_process'

// Get preserved originals from globalThis (set by subprocessGlobalDiag.ts before patching)
// CRITICAL: Call lazily (not at module load) to ensure globalThis is set
const getOriginalExec = () => {
  const orig = (globalThis as any).__DIA_ORIG_CP
  if (!orig || !orig.exec) {
    throw new Error(
      'subprocessDiag: __DIA_ORIG_CP.exec not found. Ensure subprocessGlobalDiag.ts loads first.',
    )
  }
  return orig.exec
}

const getOriginalExecFile = () => {
  const orig = (globalThis as any).__DIA_ORIG_CP
  if (!orig || !orig.execFile) {
    throw new Error(
      'subprocessDiag: __DIA_ORIG_CP.execFile not found. Ensure subprocessGlobalDiag.ts loads first.',
    )
  }
  return orig.execFile
}

// execAsync: properly handle options parameter with manual promise wrapper
// Uses true original exec (not patched) to avoid recursion and argument misinterpretation
// CRITICAL: Use 2-arg signature when options is undefined to avoid edge cases
const execAsync = (command: string, options?: ExecOptions) => {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    // Get original exec lazily (ensures globalThis is set)
    const originalExec = getOriginalExec()
    // Use 2-arg signature (cmd, cb) when options is undefined, 3-arg (cmd, opts, cb) when provided
    if (options) {
      originalExec(command, options, (error, stdout, stderr) => {
        if (error) {
          reject(error)
        } else {
          resolve({ stdout, stderr })
        }
      })
    } else {
      originalExec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error)
        } else {
          resolve({ stdout, stderr })
        }
      })
    }
  })
}

// Use promisify on original (not patched) to avoid recursion
// Get original execFile lazily (ensures globalThis is set)
const execFileAsync = promisify(getOriginalExecFile())

type MaybeOptions = ExecOptions | ExecFileOptions | undefined

function maskSecrets(input: string): string {
  return input
    .replace(/Api-Key\\s+\\S+/gi, 'Api-Key ***')
    .replace(/Bearer\\s+\\S+/gi, 'Bearer ***')
    .replace(/PGPASSWORD=\\S+/gi, 'PGPASSWORD=***')
    .replace(/token=\\S+/gi, 'token=***')
}

function logSubprocess(context: string | undefined, command: string, args?: string[]) {
  const timestamp = new Date().toISOString()
  const stack = new Error().stack
    ?.split('\\n')
    .slice(2, 8)
    .map((line) => line.trim())
    .join(' | ')

  const cmd = args && args.length > 0 ? `${command} ${args.join(' ')}` : command
  console.log(
    '[SUBPROC_DIAG]',
    JSON.stringify({
      ts: timestamp,
      context: context || 'unknown',
      cmd: maskSecrets(cmd),
      stack,
    }),
  )
}

export async function diagExec(command: string, options?: MaybeOptions, context?: string) {
  logSubprocess(context, command)
  return execAsync(command, options as ExecOptions | undefined)
}

export async function diagExecFile(
  file: string,
  args: string[] = [],
  options?: MaybeOptions,
  context?: string,
) {
  logSubprocess(context, file, args)
  return execFileAsync(file, args, options)
}
