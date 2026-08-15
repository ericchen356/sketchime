import { getStroke } from 'perfect-freehand'
import type { InkPoint, Rect, Sketch, Stroke } from './types'

/** Tuned for handwriting-scale marks at typical screen sizes. */
export const STROKE_OPTIONS = {
  size: 6,
  thinning: 0.6,
  smoothing: 0.55,
  streamline: 0.45,
  easing: (t: number): number => Math.sin((t * Math.PI) / 2),
  simulatePressure: true
} as const

export function strokeOutline(points: InkPoint[], last = true, size?: number): number[][] {
  return getStroke(
    points.map((p) => [p.x, p.y, p.pressure]),
    { ...STROKE_OPTIONS, size: size ?? STROKE_OPTIONS.size, last }
  )
}

/** Outline polygon -> fillable path. The ink is FILLED, not stroked - that is
 * what gives it the pressure taper. */
export function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D()
  if (outline.length === 0) return path

  path.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) {
    path.lineTo(outline[i][0], outline[i][1])
  }
  path.closePath()
  return path
}

const EMPTY = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

/**
 * Bounding box over strokes AND text, in CSS px. Text has to count - a label
 * typed outside the rectangle should still widen the result.
 */
export function sketchBounds(sketch: Sketch): Rect | null {
  let { minX, minY, maxX, maxY } = EMPTY

  for (const stroke of sketch.strokes) {
    // Union the outline, not the raw points - it already accounts for taper.
    for (const [x, y] of strokeOutline(stroke.points, true, stroke.width)) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  for (const t of sketch.texts) {
    if (!t.text.trim()) continue
    // Approximate the text's box; exact metrics aren't worth a measure pass.
    const w = t.text.length * TEXT_CHAR_W
    const h = TEXT_LINE_H
    if (t.x < minX) minX = t.x
    if (t.y < minY) minY = t.y
    if (t.x + w > maxX) maxX = t.x + w
    if (t.y + h > maxY) maxY = t.y + h
  }

  if (!Number.isFinite(minX) || maxX <= minX) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Approximate text metrics, shared by bounds and eraser hit-testing so the two
 * never disagree about where a label is. */
export const TEXT_CHAR_W = 9
export const TEXT_LINE_H = 22

export function isEmpty(sketch: Sketch): boolean {
  return sketch.strokes.length === 0 && sketch.texts.every((t) => !t.text.trim())
}

export function sketchText(sketch: Sketch): string {
  return sketch.texts
    .map((t) => t.text.trim())
    .filter(Boolean)
    .join(' ')
}

export function newStroke(color: string, first: InkPoint): Stroke {
  return { id: crypto.randomUUID(), points: [first], color }
}

/** A fragment shorter than this is dropped rather than left as a speck. */
const MIN_FRAGMENT = 2

/**
 * Pixel erase, vector-style: drop the points inside the eraser and SPLIT the
 * stroke around the hole. Rasterising (canvas `destination-out`) would not
 * survive the next redraw - the canvas is repainted from the stroke list every
 * frame - so the hole has to exist in the model, not the pixels.
 *
 * Returns the input stroke by IDENTITY when nothing was touched, which is how
 * the caller cheaply detects "no change" and skips a re-render.
 */
export function splitStroke(stroke: Stroke, x: number, y: number, radius: number): Stroke[] {
  const rr = radius * radius
  const runs: InkPoint[][] = []
  let run: InkPoint[] = []
  let hit = false

  for (const p of stroke.points) {
    if ((p.x - x) ** 2 + (p.y - y) ** 2 <= rr) {
      hit = true
      if (run.length >= MIN_FRAGMENT) runs.push(run)
      run = []
    } else {
      run.push(p)
    }
  }
  if (run.length >= MIN_FRAGMENT) runs.push(run)

  if (!hit) return [stroke]
  // Fragments are new objects, so each needs its own id - React keys and any
  // future per-stroke state would collide otherwise.
  return runs.map((points) => ({ ...stroke, id: crypto.randomUUID(), points }))
}
