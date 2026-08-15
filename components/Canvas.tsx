'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SketchLayer } from './SketchLayer'
import { PALETTE, Rail } from './Rail'
import { Icon } from './Icon'
import {
  fitCamera,
  gridPattern,
  inkFrame,
  screenToWorld,
  worldTransform,
  zoomAt,
  type Camera,
  type Vec2,
  type Viewport
} from '@/lib/camera'
import {
  isEmpty,
  mergeSketches,
  sketchBounds,
  splitStroke,
  TEXT_CHAR_W,
  TEXT_LINE_H
} from '@/lib/ink'
import { emptySketch, type EraseMode, type Sketch, type Stroke, type TextItem, type Tool } from '@/lib/types'

/** Eraser footprint, in SCREEN px - it matches the ring cursor, so it is
 * divided by zoom at hit-test time to become a world radius. */
const ERASE_RADIUS = 16
/** Pixel erase wants a finer bite than whole-stroke erase, or it feels like a
 * blunt instrument. */
const PIXEL_ERASE_RADIUS = 9
const BRUSH_MIN = 2
const BRUSH_MAX = 40
const BRUSH_STEP = 2
const BRUSH_FLASH_MS = 900
/** Snapshot undo: whole-sketch copies, capped so a long session stays bounded. */
const HISTORY_CAP = 100
/** Trackpad pinch arrives as ctrl+wheel; this converts deltaY to a zoom factor. */
const ZOOM_SENSITIVITY = 0.0015

interface Props {
  /** The frame being edited. Canvas is fully controlled: it holds no sketch of
   * its own, so a storyboard frame shared by two clips stays a single source of
   * truth no matter which clip opened it. */
  sketch: Sketch
  onChange(next: Sketch): void
  /** The clip's other keyframe, drawn as an onion skin. */
  ghost?: Sketch | null
  /** What to call that other frame in the UI, e.g. "A · start". */
  ghostLabel?: string
  /** Chrome rendered across the top - which frame this is, and the way out. */
  header?: React.ReactNode
}

export function Canvas({
  sketch,
  onChange,
  ghost,
  ghostLabel,
  header
}: Props): React.JSX.Element {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  const [viewport, setViewport] = useState<Viewport>({ w: 0, h: 0 })
  const [tool, setTool] = useState<Tool>('pen')
  const [eraseMode, setEraseMode] = useState<EraseMode>('stroke')
  const [color, setColor] = useState<string>(PALETTE[0].value)
  const [brushSize, setBrushSize] = useState(6)
  const [sizeFlash, setSizeFlash] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [showGhost, setShowGhost] = useState(true)

  // Live mirrors for the pointer/wheel/key handlers, which are bound once and
  // must read the freshest values rather than the ones closed over at bind time.
  const cameraRef = useRef(camera)
  const viewportRef = useRef(viewport)
  const sketchRef = useRef(sketch)
  const eraseModeRef = useRef(eraseMode)
  const toolRef = useRef(tool)
  cameraRef.current = camera
  viewportRef.current = viewport
  sketchRef.current = sketch
  eraseModeRef.current = eraseMode
  toolRef.current = tool

  /**
   * Controlled-component shim. Every edit below was written against React's
   * functional-updater form; this keeps that shape while routing the result to
   * the owner. Bailing out on an unchanged reference matters - the eraser calls
   * this on every pointer sample and most samples hit nothing.
   */
  const setSketch = useCallback(
    (fn: (prev: Sketch) => Sketch) => {
      const next = fn(sketchRef.current)
      if (next === sketchRef.current) return
      // Advance the mirror IMMEDIATELY, before the owner has re-rendered. One
      // pointermove can deliver a dozen coalesced erase samples in a single
      // tick; without this each would read the same pre-move sketch and only
      // the last would survive, so a fast drag would erase almost nothing.
      sketchRef.current = next
      onChange(next)
    },
    [onChange]
  )

  const past = useRef<Sketch[]>([])
  const pendingErase = useRef<Sketch | null>(null)
  const drawing = useRef(false)
  /** Drag-pan anchor, in screen px; null when not panning. */
  const panning = useRef<{ x: number; y: number } | null>(null)
  const editInput = useRef<HTMLInputElement | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ---------- viewport ---------- */

  useEffect(() => {
    const measure = (): void => setViewport({ w: window.innerWidth, h: window.innerHeight })
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  /** THE pointer conversion: screen pixel -> world coord. Every pointer site
   * routes through it, and SketchLayer takes it as `toLocal`. */
  const toWorld = useCallback((clientX: number, clientY: number): Vec2 => {
    return screenToWorld(clientX, clientY, cameraRef.current, viewportRef.current)
  }, [])

  /* ---------- history ---------- */

  // The stack is a ref (pointer handlers must not re-bind on every stroke), so
  // its depth has to be mirrored into state for the undo button to enable.
  const pushHistory = useCallback((snap: Sketch) => {
    past.current.push(snap)
    if (past.current.length > HISTORY_CAP) past.current.shift()
    setCanUndo(true)
  }, [])

  /** Rewind one action - a stroke, a placed text, an erase drag, or a clear. */
  const undo = useCallback(() => {
    const snap = past.current.pop()
    if (snap) setSketch(() => snap)
    setCanUndo(past.current.length > 0)
  }, [setSketch])

  /* ---------- ink ---------- */

  const handleStrokeEnd = useCallback(
    (stroke: Stroke) => {
      drawing.current = false
      pushHistory(sketchRef.current)
      setSketch((prev) => ({ ...prev, strokes: [...prev.strokes, stroke] }))
    },
    [pushHistory, setSketch]
  )

  const placeText = useCallback(
    (x: number, y: number) => {
      const item: TextItem = { id: crypto.randomUUID(), x, y, text: '', color }
      pushHistory(sketchRef.current)
      setSketch((prev) => ({ ...prev, texts: [...prev.texts, item] }))
      setEditing(item.id)
    },
    [color, pushHistory, setSketch]
  )

  const updateText = useCallback((id: string, text: string) => {
    setSketch((prev) => ({
      ...prev,
      texts: prev.texts.map((t) => (t.id === id ? { ...t, text } : t))
    }))
  }, [setSketch])

  /** Blur commits. An empty box is dropped rather than left as an invisible
   * click target. */
  const commitText = useCallback((id: string) => {
    setEditing(null)
    setSketch((prev) => ({
      ...prev,
      texts: prev.texts.filter((t) => t.id !== id || t.text.trim())
    }))
  }, [setSketch])

  /** An eraser drag starts: remember the sketch so the whole drag undoes as one. */
  const eraseStart = useCallback(() => {
    pendingErase.current = sketchRef.current
  }, [])

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const pixel = eraseModeRef.current === 'pixel'
      // Screen-constant footprint: the ring cursor is a fixed size whatever the
      // zoom, so the world radius has to grow as we zoom out.
      const r = (pixel ? PIXEL_ERASE_RADIUS : ERASE_RADIUS) / cameraRef.current.zoom

      setSketch((prev) => {
        let strokes: Stroke[]
        if (pixel) {
          // Split each stroke around the hole. splitStroke returns the input by
          // identity when untouched, so this stays cheap on a miss.
          strokes = []
          for (const s of prev.strokes) {
            const parts = splitStroke(s, x, y, r)
            if (parts.length === 1 && parts[0] === s) strokes.push(s)
            else strokes.push(...parts)
          }
        } else {
          const rr = r * r
          // Whole-stroke erase: one touched point takes the entire stroke out.
          strokes = prev.strokes.filter(
            (s) => !s.points.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= rr)
          )
        }

        // Typed labels are DOM nodes, so there is no partial bite to take -
        // both modes remove a whole label. Same approximate box as sketchBounds
        // uses, inflated by the eraser radius.
        const texts = prev.texts.filter((t) => {
          const w = Math.max(t.text.length * TEXT_CHAR_W, 40)
          return !(x >= t.x - r && x <= t.x + w + r && y >= t.y - r && y <= t.y + TEXT_LINE_H + r)
        })

        const same =
          texts.length === prev.texts.length &&
          strokes.length === prev.strokes.length &&
          strokes.every((s, i) => s === prev.strokes[i])
        if (same) return prev

        // First removal of the drag banks the snapshot; nulling it makes the
        // push idempotent under StrictMode's double-invoked updaters.
        if (pendingErase.current) {
          pushHistory(pendingErase.current)
          pendingErase.current = null
        }
        return { strokes, texts }
      })
    },
    [pushHistory, setSketch]
  )

  /**
   * Duplicate the other keyframe's ink into this one. The usual way to build an
   * end frame is "same drawing, one thing moved", so starting from an exact
   * copy beats redrawing it and hoping the linework matches.
   *
   * Additive rather than destructive: it stacks on whatever is already here, so
   * nothing is ever lost, and one undo takes the whole copy back out. Strokes
   * are cloned with fresh ids and copied point arrays so the two frames can
   * never alias each other.
   */
  const copyGhost = useCallback(() => {
    const src = ghost
    if (!src || (src.strokes.length === 0 && src.texts.length === 0)) return

    pushHistory(sketchRef.current)
    setSketch((prev) => mergeSketches(prev, src))
  }, [ghost, pushHistory, setSketch])

  /** Clear the canvas. Undoable - a full wipe is exactly the action you most
   * want back after a misclick. */
  const clearSketch = useCallback(() => {
    if (isEmpty(sketchRef.current)) return
    pushHistory(sketchRef.current)
    setEditing(null)
    setSketch(emptySketch)
  }, [pushHistory, setSketch])

  const bumpBrush = useCallback((delta: number) => {
    setBrushSize((s) => Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, s + delta)))
    setSizeFlash(true)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setSizeFlash(false), BRUSH_FLASH_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!editing) return
    // Focus on the next frame, after the placing click has fully settled -
    // focusing synchronously races the browser's own focus handling.
    const id = requestAnimationFrame(() => editInput.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [editing])

  /* ---------- camera ---------- */

  /**
   * Normalise the view: centre on everything drawn and zoom to fit. With an
   * empty canvas there is nothing to frame, so fall back to the origin at 1:1.
   */
  const fitToContent = useCallback(() => {
    const next = fitCamera(sketchBounds(sketchRef.current), viewportRef.current)
    setCamera(next ?? { x: 0, y: 0, zoom: 1 })
  }, [])

  /**
   * Frame the existing drawing when the surface first opens.
   *
   * The camera starts at the world origin, and a frame drawn anywhere else
   * opens on blank paper with the work off-screen — indistinguishable from
   * having lost it. Runs once per mount, gated on the first real viewport
   * measurement, so switching between the two keyframes of a clip (which keeps
   * this component mounted) leaves the camera exactly where the user put it.
   */
  const didFit = useRef(false)
  useEffect(() => {
    if (didFit.current || viewport.w === 0) return
    didFit.current = true
    if (!isEmpty(sketchRef.current)) fitToContent()
  }, [viewport.w, fitToContent])

  // Free 2D pan replaces native scroll; ctrl/meta+wheel (and trackpad pinch,
  // which arrives as ctrl+wheel) zooms about the cursor. rAF-throttled so a
  // high-rate trackpad can't outpace the compositor.
  useEffect(() => {
    let raf = 0
    let ax = 0
    let ay = 0
    let zoomDelta = 0
    let zx = 0
    let zy = 0

    const flush = (): void => {
      raf = 0
      const cam = cameraRef.current
      const vp = viewportRef.current
      if (zoomDelta !== 0) {
        setCamera(zoomAt(cam, vp, zx, zy, Math.exp(-zoomDelta * ZOOM_SENSITIVITY)))
      } else {
        setCamera({ ...cam, x: cam.x + ax / cam.zoom, y: cam.y + ay / cam.zoom })
      }
      ax = 0
      ay = 0
      zoomDelta = 0
    }

    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomDelta += e.deltaY
        zx = e.clientX
        zy = e.clientY
      } else {
        ax += e.deltaX
        ay += e.deltaY
      }
      if (!raf) raf = requestAnimationFrame(flush)
    }

    // Not passive: the ctrl+wheel branch must preventDefault or the browser
    // page-zooms instead.
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', onWheel)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // Drag-pan: the pan tool turns the canvas pointer-inert so drags land on the
  // backdrop, and middle-drag pans from anywhere. Content should follow the
  // cursor, so the camera moves opposite to the drag (÷ zoom to turn a screen
  // delta into a world delta).
  const beginPan = (e: React.PointerEvent): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    panning.current = { x: e.clientX, y: e.clientY }
  }
  const movePan = (e: React.PointerEvent): void => {
    const p = panning.current
    if (!p) return
    const cam = cameraRef.current
    const dx = (e.clientX - p.x) / cam.zoom
    const dy = (e.clientY - p.y) / cam.zoom
    panning.current = { x: e.clientX, y: e.clientY }
    setCamera((c) => ({ ...c, x: c.x - dx, y: c.y - dy }))
  }
  const endPan = (e: React.PointerEvent): void => {
    panning.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }
  /** Middle-button pan, from anywhere including over the canvas. */
  const onStudioPointerDown = (e: React.PointerEvent): void => {
    if (e.button === 1) {
      e.preventDefault()
      beginPan(e)
    }
  }

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (ctrl && key === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setPaletteOpen(false)
        return
      }
      if (ctrl) return

      // Tool letters. `e` on an already-active eraser flips its mode, so the
      // two erasers share one key rather than eating a second one.
      if (key === 'd') setTool('pen')
      if (key === 'e') {
        if (toolRef.current === 'eraser') {
          setEraseMode((m) => (m === 'stroke' ? 'pixel' : 'stroke'))
        } else {
          setTool('eraser')
        }
      }
      if (key === 't') setTool('text')
      if (key === 'm') setTool('pan')
      if (key === 'c') setPaletteOpen((p) => !p)
      // Onion skin on/off, so the other keyframe can be checked and dismissed
      // without leaving the drawing hand.
      if (key === 'g') setShowGhost((v) => !v)
      // Shift+D duplicates the other keyframe here. Shifted so it can't be hit
      // while reaching for `d` (the pen).
      if (key === 'd' && e.shiftKey) copyGhost()
      // Ink colours: 1-9 then 0 for the tenth.
      if (/^[0-9]$/.test(e.key) && e.key !== '0') {
        const swatch = PALETTE[Number(e.key) - 1]
        if (swatch) setColor(swatch.value)
      }
      // Brush size.
      if (key === 'w') bumpBrush(BRUSH_STEP)
      if (key === 's') bumpBrush(-BRUSH_STEP)
      // View. `0` fits rather than resetting to the origin - "show me my
      // drawing" is the thing you actually want after wandering off.
      if (e.key === '0') fitToContent()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, bumpBrush, fitToContent, copyGhost])

  /* ---------- render ---------- */

  const frame = inkFrame(camera, viewport)
  const empty = isEmpty(sketch)
  // The dot grid is painted on this fixed element, so it has to be driven from
  // the camera by hand - otherwise it sits still while the world moves under it.
  const grid = gridPattern(camera, viewport)
  const ghostStrokes = ghost?.strokes.length ?? 0
  const ghostTexts = ghost?.texts.filter((t) => t.text.trim()).length ?? 0

  return (
    <div
      className="studio"
      data-tool={tool}
      data-erase={eraseMode}
      style={{
        backgroundSize: `${grid.size}px ${grid.size}px`,
        backgroundPosition: `${grid.x}px ${grid.y}px`
      }}
      onPointerDown={onStudioPointerDown}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      {/* Empty-plane drag target, beneath the world. Only reachable when the
          canvas is pointer-inert (pan tool). */}
      <div className="backdrop" onPointerDown={beginPan} />

      {/* The single transformed container. transform-origin MUST be 0 0 to
          match the screenToWorld math (see lib/camera). */}
      <div
        className="world"
        style={{ transform: worldTransform(camera, viewport), transformOrigin: '0 0' }}
      >
        {/* Camera-following ink wrapper, positioned and sized from inkFrame. */}
        <div
          className="ink-frame"
          style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
        >
          <SketchLayer
            sketch={sketch}
            color={color}
            tool={tool}
            brushSize={brushSize}
            ghost={showGhost ? ghost : null}
            resizeKey={`${frame.w}x${frame.h}`}
            drawOrigin={{ x: frame.x, y: frame.y }}
            toLocal={toWorld}
            onStrokeStart={() => {
              drawing.current = true
            }}
            onStrokeEnd={handleStrokeEnd}
            onPlaceText={placeText}
            onEraseStart={eraseStart}
            onErase={eraseAt}
          />
        </div>

        {/* Text items live in the DOM, not the canvas, so they stay editable.
            Zero-size and anchored at the world origin, so children read world
            coords 1:1. */}
        <div className="text-layer">
          {sketch.texts.map((t) =>
            editing === t.id ? (
              <input
                key={t.id}
                ref={editInput}
                className="text-item text-item-editing"
                style={{ left: t.x, top: t.y, color: t.color }}
                value={t.text}
                placeholder="type…"
                onChange={(e) => updateText(t.id, e.target.value)}
                onBlur={() => commitText(t.id)}
              />
            ) : (
              <span
                key={t.id}
                className="text-item"
                style={{ left: t.x, top: t.y, color: t.color }}
                onDoubleClick={() => setEditing(t.id)}
              >
                {t.text}
              </span>
            )
          )}
        </div>
      </div>

      {header}

      {ghost && (
        <div className="frame-tools">
          <button
            className={`tool-pill ${showGhost ? 'tool-pill-on' : ''}`}
            onClick={() => setShowGhost((v) => !v)}
            title={`Show ${ghostLabel ?? 'the other frame'} faintly underneath, so you can line this one up against it (g)`}
            aria-pressed={showGhost}
          >
            <Icon name="onion" size={15} />
            Show {ghostLabel ?? 'the other frame'}
          </button>
          <button
            className="tool-pill"
            onClick={copyGhost}
            disabled={ghostStrokes === 0 && ghostTexts === 0}
            title={`Copy everything from ${ghostLabel ?? 'the other frame'} onto this one, then move what changes (shift+D). Undo takes it back out.`}
          >
            <Icon name="copy" size={15} />
            Copy it in
            {ghostStrokes > 0 && <span className="tool-count">{ghostStrokes}</span>}
          </button>
        </div>
      )}

      <Rail
        tool={tool}
        eraseMode={eraseMode}
        color={color}
        brushSize={brushSize}
        zoom={camera.zoom}
        paletteOpen={paletteOpen}
        canUndo={canUndo}
        isEmpty={empty}
        onTool={setTool}
        onEraseMode={setEraseMode}
        onColor={setColor}
        onBrushSize={setBrushSize}
        onTogglePalette={() => setPaletteOpen((p) => !p)}
        onClosePalette={() => setPaletteOpen(false)}
        onUndo={undo}
        onClear={clearSketch}
        onFit={fitToContent}
        brushMin={BRUSH_MIN}
        brushMax={BRUSH_MAX}
      />

      {sizeFlash && <div className="brush-flash">brush {brushSize}</div>}
    </div>
  )
}
