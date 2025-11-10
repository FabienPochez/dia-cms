import { useEffect, useRef } from 'react'

/**
 * Run a callback periodically, but only when document is visible
 * @param callback - Function to run
 * @param intervalMs - Polling interval in milliseconds
 * @param enabled - Whether polling is enabled
 */
export function useVisibilityPolling(
  callback: () => void,
  intervalMs: number,
  enabled: boolean = true,
) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const callbackRef = useRef(callback)

  // Keep callback ref fresh
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return

    const runIfVisible = () => {
      if (document.visibilityState === 'visible') {
        callbackRef.current()
      }
    }

    // Start polling
    intervalRef.current = setInterval(runIfVisible, intervalMs)

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [intervalMs, enabled])
}
