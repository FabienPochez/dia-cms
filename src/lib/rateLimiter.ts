/**
 * Simple in-memory rate limiter for password operations
 * Tracks attempts by IP + identifier (user ID or email) to prevent brute force attacks
 * 
 * Note: This is fine for single-instance/dev. For production scale or serverless,
 * migrate to Redis to share rate-limit state across instances.
 */

interface AttemptRecord {
  count: number
  firstAttempt: number
  lastAttempt: number
}

class RateLimiter {
  private attempts: Map<string, AttemptRecord> = new Map()
  private readonly maxAttempts: number
  private readonly windowMs: number
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(maxAttempts: number = 5, windowMs: number = 60000) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
    this.startCleanup()
  }

  /**
   * Generate unique key from IP and user ID
   */
  private getKey(ip: string, userId: string): string {
    return `${ip}:${userId}`
  }

  /**
   * Check if request should be rate limited
   * @returns true if rate limit exceeded, false if allowed
   */
  check(ip: string, userId: string): boolean {
    const key = this.getKey(ip, userId)
    const now = Date.now()
    const record = this.attempts.get(key)

    // No previous attempts
    if (!record) {
      this.attempts.set(key, {
        count: 1,
        firstAttempt: now,
        lastAttempt: now,
      })
      return false
    }

    // Check if window has expired
    if (now - record.firstAttempt > this.windowMs) {
      // Reset the window
      this.attempts.set(key, {
        count: 1,
        firstAttempt: now,
        lastAttempt: now,
      })
      return false
    }

    // Within the window - check if limit exceeded
    if (record.count >= this.maxAttempts) {
      record.lastAttempt = now
      return true // Rate limited
    }

    // Increment and allow
    record.count++
    record.lastAttempt = now
    return false
  }

  /**
   * Get remaining attempts for a user
   */
  getRemainingAttempts(ip: string, userId: string): number {
    const key = this.getKey(ip, userId)
    const record = this.attempts.get(key)

    if (!record) {
      return this.maxAttempts
    }

    const now = Date.now()
    if (now - record.firstAttempt > this.windowMs) {
      return this.maxAttempts
    }

    return Math.max(0, this.maxAttempts - record.count)
  }

  /**
   * Get time until rate limit resets (in seconds)
   */
  getResetTime(ip: string, userId: string): number {
    const key = this.getKey(ip, userId)
    const record = this.attempts.get(key)

    if (!record) {
      return 0
    }

    const now = Date.now()
    const timeRemaining = this.windowMs - (now - record.firstAttempt)
    return Math.max(0, Math.ceil(timeRemaining / 1000))
  }

  /**
   * Manually reset attempts for a user (useful for successful password changes)
   */
  reset(ip: string, userId: string): void {
    const key = this.getKey(ip, userId)
    this.attempts.delete(key)
  }

  /**
   * Clean up expired entries every minute
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, record] of this.attempts.entries()) {
        if (now - record.lastAttempt > this.windowMs) {
          this.attempts.delete(key)
        }
      }
    }, 60000) // Clean up every 60 seconds

    // Prevent the interval from keeping the process alive
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref()
    }
  }

  /**
   * Stop cleanup interval (useful for testing or shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }
}

// Export singleton instance for password change operations (uses IP + user ID)
export const passwordChangeRateLimiter = new RateLimiter(5, 60000) // 5 attempts per minute

// Export singleton instance for forgot password operations (uses IP + email)
export const forgotPasswordRateLimiter = new RateLimiter(5, 60000) // 5 attempts per minute




