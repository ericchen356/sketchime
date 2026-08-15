import type { Clip, Frame, Sketch, Storyboard } from './types'

/**
 * Local persistence for the storyboard.
 *
 * The original pipeline spec called for session-only memory. That is fine right
 * up until a reload throws away twenty minutes of drawing, so drawings are now
 * written to localStorage (NOT sessionStorage, which dies with the tab and would
 * miss the entire point).
 *
 * Only the authored work is saved. Anything derived, transient, or invalid
 * after a reload is deliberately dropped - see `strip`.
 */
const KEY = 'sketchime.storyboard'
/** Bump when the shape changes incompatibly; older payloads are then ignored
 * rather than crashing the app with half-understood data. */
const VERSION = 2
/** Writes are debounced by this much. Drawing produces a state update per
 * stroke, and serialising a large board on every one would stutter the canvas. */
export const SAVE_DEBOUNCE_MS = 700
/** Browsers typically allow ~5MB per origin. Warn before hitting the wall. */
const WARN_BYTES = 3_500_000

export interface Persisted {
  version: number
  savedAt: string
  storyboard: Storyboard
}

/** Wrap a storyboard for storage: strips transient fields, rounds coordinates. */
export function packStoryboard(sb: Storyboard): Persisted {
  return {
    version: VERSION,
    savedAt: new Date().toISOString(),
    storyboard: {
      ...sb,
      clips: sb.clips.map(strip),
      frames: Object.fromEntries(
        Object.entries(sb.frames).map(([id, f]) => [id, { ...f, sketch: packSketch(f.sketch) }])
      )
    }
  }
}

/**
 * Read a stored payload back, defensively. Anything malformed is dropped rather
 * than trusted: this data has sat in a browser across app versions, and a crash
 * on load would lock someone out of their own work with no way back.
 */
export function unpackStoryboard(parsed: unknown): Storyboard | null {
  const p = parsed as Persisted
  if (!p || p.version !== VERSION) return null

  const sb = p.storyboard
  if (!sb || typeof sb !== 'object' || !Array.isArray(sb.clips) || !sb.frames) return null

  const frames: Record<string, Frame> = {}
  for (const [id, f] of Object.entries(sb.frames)) {
    if (f && typeof f === 'object' && isSketch((f as Frame).sketch)) {
      frames[id] = { id, sketch: (f as Frame).sketch }
    }
  }

  // A clip pointing at a frame that failed validation would render as an empty
  // keyframe with no way to tell why, so drop it instead.
  const clips = sb.clips.filter(
    (c): c is Clip =>
      !!c && typeof c.id === 'string' && !!frames[c.startFrameId] && !!frames[c.endFrameId]
  )

  return {
    frames,
    clips: clips.map(strip),
    styleNote: typeof sb.styleNote === 'string' ? sb.styleNote : ''
  }
}

/** Coordinates are stored to 2dp. Sub-pixel precision is invisible and the
 * saving is large - point coords dominate a serialised sketch. */
const round = (n: number): number => Math.round(n * 100) / 100

function packSketch(s: Sketch): Sketch {
  return {
    strokes: s.strokes.map((st) => ({
      ...st,
      points: st.points.map((p) => ({ x: round(p.x), y: round(p.y), pressure: round(p.pressure) }))
    })),
    texts: s.texts
  }
}

/**
 * Remove everything that cannot survive a reload or should not outlive the
 * session.
 *
 * `videoUrl` is the important one: it is an object URL into this page's memory,
 * so after a reload it points at nothing. Restoring it would show a broken
 * player and, worse, a clip that claims to be rendered when its video is gone -
 * so the status is walked back too.
 */
function strip(clip: Clip): Clip {
  const { videoUrl: _videoUrl, operation: _operation, error: _error, ...rest } = clip
  return {
    ...rest,
    // 'generating' would resume as a spinner for a request nobody is waiting on.
    status: clip.status === 'done' || clip.status === 'generating' || clip.status === 'error'
      ? clip.prompt
        ? 'ready'
        : 'draft'
      : clip.status
  }
}

export interface SaveResult {
  ok: boolean
  bytes?: number
  /** Set when the write failed, or succeeded but is close to the quota. */
  warning?: string
}

export function saveStoryboard(sb: Storyboard): SaveResult {
  if (typeof window === 'undefined') return { ok: false }

  const payload = packStoryboard(sb)

  let json: string
  try {
    json = JSON.stringify(payload)
  } catch {
    return { ok: false, warning: 'Could not serialise the storyboard.' }
  }

  try {
    window.localStorage.setItem(KEY, json)
  } catch {
    // Almost always the quota. Say so plainly - silently failing to save is the
    // exact failure this whole module exists to prevent.
    return {
      ok: false,
      bytes: json.length,
      warning:
        'Out of local storage space — your work is NOT being saved. Delete a clip or clear saved work in Settings.'
    }
  }

  return {
    ok: true,
    bytes: json.length,
    warning:
      json.length > WARN_BYTES
        ? 'Saved work is close to the browser storage limit; further drawing may stop saving.'
        : undefined
  }
}

const isSketch = (v: unknown): v is Sketch =>
  !!v && typeof v === 'object' && Array.isArray((v as Sketch).strokes) && Array.isArray((v as Sketch).texts)

/**
 * Read back, defensively. Anything malformed is dropped rather than trusted:
 * this data has been sitting in a browser across app versions, and a crash on
 * load would lock the user out of their own work with no way back.
 */
export function loadStoryboard(): Storyboard | null {
  if (typeof window === 'undefined') return null

  let raw: string | null
  try {
    raw = window.localStorage.getItem(KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    return unpackStoryboard(JSON.parse(raw))
  } catch {
    return null
  }
}

export function clearStoryboard(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* nothing useful to do */
  }
}

export interface SavedInfo {
  savedAt: string
  bytes: number
  clips: number
}

/** Summary of what is on disk, for the Settings panel. */
export function savedInfo(): SavedInfo | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Persisted
    if (parsed?.version !== VERSION) return null
    return {
      savedAt: parsed.savedAt,
      bytes: raw.length,
      clips: parsed.storyboard?.clips?.length ?? 0
    }
  } catch {
    return null
  }
}
