/**
 * Request Context Storage
 * 
 * Provides AsyncLocalStorage-based request context for subprocess monitoring.
 * Captures request metadata (method, path, IP, user) for security logging.
 */

import { AsyncLocalStorage } from 'async_hooks'

export interface RequestContext {
  method?: string
  path?: string
  query?: string
  cf_ip?: string
  xff?: string
  user_agent?: string
  request_id?: string
  user?: {
    id?: string
    email?: string
    role?: string
  }
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>()

/**
 * Get current request context (if available)
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore()
}

/**
 * Run a function with request context
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn)
}

/**
 * Extract request context from Next.js Request object
 */
export function extractRequestContext(request: {
  method?: string
  url?: string | URL
  headers?: Headers | Record<string, string | string[]>
}): RequestContext {
  const context: RequestContext = {}

  // Method
  if (request.method) {
    context.method = request.method
  }

  // Path and query
  if (request.url) {
    try {
      const url = typeof request.url === 'string' ? new URL(request.url) : request.url
      context.path = url.pathname
      context.query = url.search
    } catch (e) {
      // Invalid URL, skip
    }
  }

  // Headers
  const headers = request.headers
  if (headers) {
    const getHeader = (name: string): string | undefined => {
      if (headers instanceof Headers) {
        return headers.get(name) || undefined
      }
      const value = headers[name.toLowerCase()] || headers[name]
      return Array.isArray(value) ? value[0] : value
    }

    // Cloudflare IP (preferred)
    context.cf_ip = getHeader('cf-connecting-ip')
    
    // X-Forwarded-For (fallback)
    const xff = getHeader('x-forwarded-for')
    if (xff) {
      context.xff = xff.split(',')[0].trim() // First IP
    }

    // User-Agent (hash only for privacy)
    const ua = getHeader('user-agent')
    if (ua) {
      // Simple hash for privacy (not cryptographic, just for grouping)
      context.user_agent = `hash:${ua.length}:${ua.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '')}`
    }

    // Request ID (if present)
    context.request_id = getHeader('x-request-id') || getHeader('cf-ray')
  }

  return context
}

/**
 * Enrich request context with user information
 * Call this in route handlers after authentication
 */
export function enrichContextWithUser(user: {
  id?: string | number
  email?: string
  role?: string
}): void {
  const context = requestContextStorage.getStore()
  if (context) {
    context.user = {
      id: user.id?.toString(),
      email: user.email,
      role: user.role,
    }
  }
}

export { requestContextStorage }

