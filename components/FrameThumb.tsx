'use client'

import { useEffect, useRef } from 'react'
import { clipBox, renderSketch } from '@/lib/render'
import { isEmpty } from '@/lib/ink'
import type { Rect, Sketch } from '@/lib/types'

interface Props {
  sketch: Sketch
  /** Render through this box instead of the sketch's own. Passing a clip's
   * shared box makes the two thumbnails line up exactly the way the exported
   * keyframes will, so the timeline previews the real framing. */
  box?: Rect
  label?: string
  width?: number
  height?: number
}

/**
 * A small rasterised preview of a frame. Draws straight to a canvas rather than
 * producing a data URL - a board with a dozen clips would otherwise hold two
 * dozen base64 strings in memory for no reason.
 */
export function FrameThumb({ sketch, box, label, width = 160, height = 90 }: Props): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const host = ref.current
    if (!host) return

    const dpr = window.devicePixelRatio || 1
    const w = Math.round(width * dpr)
    const h = Math.round(height * dpr)
    const rendered = renderSketch(sketch, box ?? clipBox(sketch, sketch), w, h)

    host.width = w
    host.height = h
    const ctx = host.getContext('2d')
    ctx?.drawImage(rendered, 0, 0)
  }, [sketch, box, width, height])

  return (
    <span className="thumb" style={{ width, height }}>
      <canvas ref={ref} style={{ width, height }} />
      {isEmpty(sketch) && <span className="thumb-empty">empty</span>}
      {label && <span className="thumb-label">{label}</span>}
    </span>
  )
}
