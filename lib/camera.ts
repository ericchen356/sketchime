/**
 * The one pan/zoom camera over the infinite plane. This module owns every
 * screen<->world conversion so no pointer site invents its own math. A single
 * missed conversion lands ink in the wrong place, so all of it funnels here.
 *
 * Two coordinate spaces:
 *  - screen: viewport pixels (clientX/clientY from a PointerEvent).
 *  - world:  the infinite plane. The camera frames a window onto it. Strokes,
 *            text and (later) elements are all stored in world coords.
 *
 * The `.world` DOM node carries `translate(Tx,Ty) scale(zoom)` (see
 * worldTransform) with `transform-origin: 0 0`; screenToWorld is the exact
 * hand-written inverse of that transform. If you change one, change the other.
 */

export interface Camera {
  /** World point pinned to the viewport centre. */
  x: number
  y: number
  zoom: number
}

export interface Viewport {
  w: number
  h: number
}

export interface Vec2 {
  x: number
  y: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/* ---------- screen <-> world ---------- */

/** Inverse of the `.world` transform: which world point sits under a pixel. */
export function screenToWorld(sx: number, sy: number, cam: Camera, vp: Viewport): Vec2 {
  return {
    x: (sx - vp.w / 2) / cam.zoom + cam.x,
    y: (sy - vp.h / 2) / cam.zoom + cam.y
  }
}

/** Where a world point lands on screen. */
export function worldToScreen(wx: number, wy: number, cam: Camera, vp: Viewport): Vec2 {
  return {
    x: (wx - cam.x) * cam.zoom + vp.w / 2,
    y: (wy - cam.y) * cam.zoom + vp.h / 2
  }
}

/* ---------- CSS transform for the world container ---------- */

/** The `translate() scale()` string that realises a camera. transform-origin
 * must be `0 0` for this to match screenToWorld. */
export function worldTransform(cam: Camera, vp: Viewport): string {
  const tx = vp.w / 2 - cam.x * cam.zoom
  const ty = vp.h / 2 - cam.y * cam.zoom
  return `translate(${tx}px, ${ty}px) scale(${cam.zoom})`
}

/* ---------- zoom ---------- */

/**
 * Zoom by `factor` while keeping the world point under (sx, sy) pinned to that
 * same pixel - the behaviour every canvas app has for ctrl+wheel / pinch.
 * Solve worldToScreen(anchor, next) == (sx, sy) for the new camera centre.
 */
export function zoomAt(
  cam: Camera,
  vp: Viewport,
  sx: number,
  sy: number,
  factor: number
): Camera {
  const zoom = clampZoom(cam.zoom * factor)
  // Clamped to a no-op: don't drift the centre for a zoom that didn't happen.
  if (zoom === cam.zoom) return cam

  const anchor = screenToWorld(sx, sy, cam, vp)
  return {
    x: anchor.x - (sx - vp.w / 2) / zoom,
    y: anchor.y - (sy - vp.h / 2) / zoom,
    zoom
  }
}

/* ---------- background grid ---------- */

/** Grid spacing in WORLD units at the base step. */
const BASE_GRID = 26
/** Screen-space spacing the grid is kept within. Outside this the step jumps by
 * a factor of 4, so the dots never crowd into mush or drift so far apart they
 * stop reading as a grid. The window must be wider than that factor or the
 * ladder below would oscillate. */
const MIN_SPACING = 18
const MAX_SPACING = 88
const STEP_FACTOR = 4

/**
 * The dot grid has to move with the camera or the plane reads as frozen while
 * you pan. A CSS background can do the whole thing: `background-size` carries
 * the zoom and `background-position` carries the pan, with the pattern anchored
 * to where the WORLD ORIGIN currently sits on screen. The browser tiles from
 * there, so the dots stay locked to world coordinates.
 *
 * Returns screen-space values, ready to drop into inline styles.
 */
export function gridPattern(cam: Camera, vp: Viewport): { size: number; x: number; y: number } {
  // Step up or down the ladder until the on-screen spacing is comfortable.
  let world = BASE_GRID
  let screen = world * cam.zoom
  for (let i = 0; i < 12 && screen < MIN_SPACING; i++) {
    world *= STEP_FACTOR
    screen = world * cam.zoom
  }
  for (let i = 0; i < 12 && screen > MAX_SPACING; i++) {
    world /= STEP_FACTOR
    screen = world * cam.zoom
  }

  const origin = worldToScreen(0, 0, cam, vp)
  return { size: screen, x: origin.x, y: origin.y }
}

/** Padding left around the content when fitting, in screen px. */
const FIT_PADDING = 96
/** Fitting never magnifies past this - a lone dot filling the screen at 8x is
 * disorienting, not helpful. */
const FIT_MAX_ZOOM = 2

/**
 * Frame a world-space box: centre the camera on it and pick the zoom that fits
 * it in the viewport with a margin. This is the "normalise the view" move - it
 * answers "where is my drawing?" regardless of how far the camera has wandered.
 * Returns null when there is nothing to frame or the viewport isn't measured.
 */
export function fitCamera(
  box: { x: number; y: number; w: number; h: number } | null,
  vp: Viewport
): Camera | null {
  if (!box || vp.w === 0 || vp.h === 0) return null

  // A perfectly straight line has zero extent on one axis; floor it so the
  // ratio below stays finite.
  const w = Math.max(box.w, 1)
  const h = Math.max(box.h, 1)
  const zoom = Math.min(
    FIT_MAX_ZOOM,
    clampZoom(Math.min((vp.w - FIT_PADDING * 2) / w, (vp.h - FIT_PADDING * 2) / h))
  )

  return { x: box.x + box.w / 2, y: box.y + box.h / 2, zoom }
}

/* ---------- ink canvas frame ---------- */

/** Extra slack around the viewport, each side, for the ink canvas - so a small
 * pan doesn't reveal its edge before the next redraw. */
const INK_MARGIN = 0.3

/**
 * The sketch surface is conceptually infinite, but a canvas is not: an infinite
 * backing store is impossible. So the ink canvas is a viewport-sized world rect
 * that FOLLOWS the camera - small enough to allocate, re-drawn with this frame's
 * top-left as its origin every time the camera moves. Returns the world-space
 * top-left `(x,y)` and size `(w,h)`; that top-left is what SketchLayer takes as
 * `drawOrigin`.
 */
export function inkFrame(cam: Camera, vp: Viewport): { x: number; y: number; w: number; h: number } {
  const w = Math.round((vp.w / cam.zoom) * (1 + INK_MARGIN * 2))
  const h = Math.round((vp.h / cam.zoom) * (1 + INK_MARGIN * 2))
  return { x: Math.round(cam.x - w / 2), y: Math.round(cam.y - h / 2), w, h }
}
