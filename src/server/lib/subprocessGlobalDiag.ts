/**
 * Global Subprocess Diagnostic Monkey-Patch
 *
 * This module patches child_process methods globally to catch ANY subprocess
 * execution, even from unwrapped code paths. This is TEMPORARY for diagnostics.
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

const originalExecAsync = promisify(originalExec)
const originalExecFileAsync = promisify(originalExecFile)

type ExecOptions = import('child_process').ExecOptions
type ExecFileOptions = import('child_process').ExecFileOptions
type SpawnOptions = import('child_process').SpawnOptions

function maskSecrets(input: string): string {
  return input
    .replace(/Api-Key\s+\S+/gi, 'Api-Key ***')
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/PGPASSWORD=\S+/gi, 'PGPASSWORD=***')
    .replace(/token=\S+/gi, 'token=***')
    .replace(/password=\S+/gi, 'password=***')
}

// Track if we're already logging to prevent recursion
let isLogging = false

function logGlobalSubprocess(method: string, command: string, args?: string[], options?: any) {
  // Prevent recursion - if we're already logging, skip
  if (isLogging) return

  isLogging = true
  try {
    const timestamp = new Date().toISOString()
    const stack = new Error().stack
      ?.split('\n')
      .slice(2, 12) // More stack frames for better trace
      .map((line) => line.trim())
      .filter((line) => !line.includes('subprocessGlobalDiag')) // Exclude our own wrapper
      .join(' | ')

    const cmd = args && args.length > 0 ? `${command} ${args.join(' ')}` : command
    const maskedCmd = maskSecrets(cmd)

    // Use process.stdout.write directly to avoid console.log recursion
    const logMsg = `[SUBPROC_DIAG_GLOBAL] ${JSON.stringify({
      ts: timestamp,
      method,
      cmd: maskedCmd,
      stack,
      options: options ? JSON.stringify(options).substring(0, 200) : undefined,
    })}\n`
    process.stdout.write(logMsg)
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

// Monkey-patch the child_process module
// Handle ES modules - use createRequire for compatibility
import { createRequire } from 'module'
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

// Re-export patched versions for ES modules
export {
  patchedExec as exec,
  patchedExecSync as execSync,
  patchedExecFile as execFile,
  patchedSpawn as spawn,
  patchedSpawnSync as spawnSync,
}

console.log('[SUBPROC_DIAG_GLOBAL] Global child_process monkey-patch installed')
