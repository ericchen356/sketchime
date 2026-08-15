import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV !== 'production'

const nextConfig: NextConfig = {
  /**
   * Stop the browser caching dev assets.
   *
   * Turbopack names dev chunks from the file PATH, not the contents, so
   * `app_globals_71f961d1.css` stays byte-identical in URL across every edit and
   * every server restart. The browser sees a URL it already has and serves its
   * own stale copy - which looks exactly like "my CSS changes did nothing", and
   * cannot be cleared by restarting the server or deleting .next.
   *
   * Development only. Production builds use content-hashed filenames, where
   * long-lived caching is correct and this would throw away a real optimisation.
   */
  async headers() {
    if (!isDev) return []
    return [
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }]
      }
    ]
  }
}

export default nextConfig
