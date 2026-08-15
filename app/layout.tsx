import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'sketchime',
  description: 'An infinite sketching canvas.'
}

/** The canvas owns the whole viewport and handles its own zoom, so browser
 * pinch-zoom and the mobile URL-bar resize dance are both turned off. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
