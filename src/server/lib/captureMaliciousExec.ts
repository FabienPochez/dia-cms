/**
 * CAPTURE MALICIOUS execSync CALLS
 * 
 * This module captures the FULL execution context when malicious execSync is detected,
 * including the call stack, variable values, and source of the malicious string.
 */

import { execSync as originalExecSync } from 'child_process'

let captureEnabled = true
let captureCount = 0
const MAX_CAPTURES = 10

interface CaptureContext {
  timestamp: string
  command: string
  stack: string
  callSite: string
  variables: Record<string, any>
  memoryDump?: string
}

const captures: CaptureContext[] = []

/**
 * Enhanced execSync wrapper that captures malicious patterns
 */
export function patchedExecSync(command: string, options?: any): Buffer {
  const maliciousPatterns = [
    '176.117.107.158',
    'wget',
    'curl',
    'r.sh',
    'mkdir /tmp',
    'chmod 777',
  ]

  const isMalicious = maliciousPatterns.some((pattern) =>
    command.includes(pattern),
  )

  if (isMalicious && captureEnabled && captureCount < MAX_CAPTURES) {
    captureCount++

    try {
      // Get full stack trace
      const stack = new Error().stack || ''
      const stackLines = stack.split('\n').slice(2, 20)

      // Try to extract call site
      const callSite = stackLines[0]?.trim() || 'unknown'

      // Capture context
      const context: CaptureContext = {
        timestamp: new Date().toISOString(),
        command,
        stack: stackLines.join('\n'),
        callSite,
        variables: {
          commandLength: command.length,
          commandPreview: command.substring(0, 200),
          options: options ? JSON.stringify(options).substring(0, 200) : undefined,
        },
      }

      captures.push(context)

      // Log detailed capture
      const logEntry = {
        type: 'MALICIOUS_EXECSYNC_CAPTURE',
        captureNumber: captureCount,
        ...context,
      }

      const logLine = `[MALICIOUS_CAPTURE] ${JSON.stringify(logEntry, null, 2)}\n`
      process.stdout.write(logLine)
      console.error(`[MALICIOUS_CAPTURE] 🚨 CAPTURED MALICIOUS execSync #${captureCount}`)
      console.error(`[MALICIOUS_CAPTURE] Command: ${command.substring(0, 200)}`)
      console.error(`[MALICIOUS_CAPTURE] Call site: ${callSite}`)

      // Try to dump more context
      try {
        // Capture V8 heap if possible
        if (global.gc) {
          global.gc()
        }
      } catch (e) {
        // Ignore
      }
    } catch (error: any) {
      console.error(`[MALICIOUS_CAPTURE] Failed to capture context: ${error.message}`)
    }
  }

  // Still log via global diagnostic
  return originalExecSync(command, options)
}

/**
 * Get all captures
 */
export function getCaptures(): CaptureContext[] {
  return [...captures]
}

/**
 * Clear captures
 */
export function clearCaptures(): void {
  captures.length = 0
  captureCount = 0
}
