import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'sketchime',
  description: 'Draw two pictures. Get the movement in between.'
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /**
   * Browser zoom is deliberately NOT disabled. The drawing surface has its own
   * camera, but it protects itself with `touch-action: none` on the canvas
   * element, so pinching anywhere else is free to do the ordinary thing. The
   * old `maximumScale: 1, userScalable: false` bought nothing — iOS has ignored
   * it for years — while blocking the only way a low-vision user can read the
   * interface at all.
   */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f3ef' },
    { media: '(prefers-color-scheme: dark)', color: '#171614' }
  ]
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
