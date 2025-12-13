/**
 * Next.js Middleware - Request Context Capture
 * 
 * Captures request metadata for subprocess monitoring.
 * Runs on all requests before route handlers.
 * 
 * Compatibility: Next.js App Router middleware (Node.js runtime).
 * Falls back gracefully if middleware is not supported or fails.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runWithContext, extractRequestContext } from './server/lib/requestContext'

export function middleware(request: NextRequest) {
  try {
    // Extract request context
    const context = extractRequestContext(request)

    // Run request with context stored in AsyncLocalStorage
    // Note: AsyncLocalStorage requires Node.js runtime (not Edge runtime)
    return runWithContext(context, () => {
      // Continue to route handler (context is now available)
      return NextResponse.next()
    })
  } catch (error) {
    // Graceful fallback: if context capture fails, continue without it
    // This ensures middleware doesn't break request handling
    // Subprocess logs will simply lack request context in this case
    return NextResponse.next()
  }
}

// Match all routes except static files and Next.js internals
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
}

