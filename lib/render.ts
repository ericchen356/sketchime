import { outlineToPath, sketchBounds, strokeOutline, TEXT_LINE_H } from './ink'
import type { Rect, Sketch } from './types'

/** Video output size. 16:9 at 720p is the safe intersection of what the video
 * models accept and what a browser can rasterise instantly. */
export const RENDER_W = 1280
export const RENDER_H = 720
export const RENDER_ASPECT = RENDER_W / RENDER_H
/** Breathing room around the ink, as a fraction of the box's longest side. */
const PAD_RATIO = 0.08
/** Fallback box when a frame is blank - a blank keyframe is legal (it means
 * "fade from nothing"), and it still has to rasterise to a white image. */
const FALLBACK_BOX: Rect = { x: -400, y: -225, w: 800, h: 450 }

/** Grow a box to exactly 16:9, keeping it centred. */
export function toAspect(box: Rect, aspect = RENDER_ASPECT): Rect {
  const current = box.w / box.h
  if (Math.abs(current - aspect) < 1e-9) return box

  if (current < aspect) {
    const w = box.h * aspect
    return { x: box.x - (w - box.w) / 2, y: box.y, w, h: box.h }
  }
  const h = box.w / aspect
  return { x: box.x, y: box.y - (h - box.h) / 2, w: box.w, h }
}

function pad(box: Rect): Rect {
  const p = Math.max(box.w, box.h) * PAD_RATIO
  return { x: box.x - p, y: box.y - p, w: box.w + p * 2, h: box.h + p * 2 }
}

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/**
 * THE shared framing for one clip. Both keyframes must be rasterised through
 * the same world box: render each to its own tight crop and the subject appears
 * to teleport between frame 1 and frame 120, because the model reads the crop
 * change as camera movement. So take the union of both sketches, pad it, and
 * square it up to 16:9 once - then both images share a coordinate system.
 */
export function clipBox(a: Sketch, b: Sketch): Rect {
  const merged = union(sketchBounds(a), sketchBounds(b))
  if (!merged || merged.w <= 0 || merged.h <= 0) return toAspect(FALLBACK_BOX)
  return toAspect(pad(merged))
}

/**
 * Rasterise a sketch through a given world box onto a white canvas. Runs in the
 * browser only - it needs a real 2D context.
 */
export function renderSketch(
  sketch: Sketch,
  box: Rect,
  width = RENDER_W,
  height = RENDER_H
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  // Paper, not transparency: a PNG with an alpha background reaches the video
  // model as black, which destroys a line drawing.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  // Uniform scale - the box is already the right aspect, so x and y agree.
  const scale = width / box.w
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-box.x, -box.y)

  for (const stroke of sketch.strokes) {
    ctx.fillStyle = stroke.color
    ctx.fill(outlineToPath(strokeOutline(stroke.points, true, stroke.width)))
  }

  for (const t of sketch.texts) {
    if (!t.text.trim()) continue
    ctx.fillStyle = t.color
    ctx.font = `600 17px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`
    ctx.textBaseline = 'alphabetic'
    // .text-item is positioned by its TOP with a 22px line box, so the baseline
    // sits most of the way down it. This mirrors the on-canvas placement.
    ctx.fillText(t.text, t.x, t.y + TEXT_LINE_H * 0.78)
  }

  ctx.restore()
  return canvas
}

/** Bare base64 (no data: prefix) - what the video API wants in its JSON body. */
export function canvasToBase64(canvas: HTMLCanvasElement): string {
  const url = canvas.toDataURL('image/png')
  const comma = url.indexOf(',')
  return comma === -1 ? '' : url.slice(comma + 1)
}

export interface RenderedPair {
  box: Rect
  /** Bare base64 PNG, for the API. */
  imageA: string
  imageB: string
  /** data: URLs, for showing the user exactly what was sent. */
  previewA: string
  previewB: string
}

/** Rasterise both keyframes of a clip through one shared box. */
export function renderClipFrames(a: Sketch, b: Sketch): RenderedPair {
  const box = clipBox(a, b)
  const ca = renderSketch(a, box)
  const cb = renderSketch(b, box)
  return {
    box,
    imageA: canvasToBase64(ca),
    imageB: canvasToBase64(cb),
    previewA: ca.toDataURL('image/png'),
    previewB: cb.toDataURL('image/png')
  }
}
