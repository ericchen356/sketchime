import { emptySketch, type Clip, type EndFrameMode, type Frame, type Sketch, type Storyboard } from './types'

export const newId = (): string => crypto.randomUUID()

export function emptyStoryboard(): Storyboard {
  return { frames: {}, clips: [], styleNote: '' }
}

function makeFrame(sketch: Sketch = emptySketch()): Frame {
  return { id: newId(), sketch }
}

function makeClip(startFrameId: string, endFrameId: string): Clip {
  return {
    id: newId(),
    startFrameId,
    endFrameId,
    intent: '',
    board: {},
    status: 'draft'
  }
}

/**
 * Append a clip. This is the "Next Clip Chaining" rule: the new clip's Image A
 * is not a copy of the previous clip's Image B, it IS that frame - same id, one
 * object. Editing the boundary in the canvas therefore moves both clips at
 * once, which is what keeps the cut invisible.
 */
export function addClip(sb: Storyboard): Storyboard {
  const last = sb.clips[sb.clips.length - 1]
  const frames = { ...sb.frames }

  let startId: string
  if (last) {
    startId = last.endFrameId
  } else {
    const first = makeFrame()
    frames[first.id] = first
    startId = first.id
  }

  const end = makeFrame()
  frames[end.id] = end

  return { ...sb, frames, clips: [...sb.clips, makeClip(startId, end.id)] }
}

/** Drop unreferenced frames. Called after any structural edit so a long session
 * doesn't accumulate orphans. */
export function collectFrames(sb: Storyboard): Storyboard {
  const live = new Set<string>()
  for (const c of sb.clips) {
    live.add(c.startFrameId)
    live.add(c.endFrameId)
  }
  const frames: Record<string, Frame> = {}
  for (const id of live) {
    const f = sb.frames[id]
    if (f) frames[id] = f
  }
  return { ...sb, frames }
}

export function removeClip(sb: Storyboard, clipId: string): Storyboard {
  return collectFrames({ ...sb, clips: sb.clips.filter((c) => c.id !== clipId) })
}

/** Move a clip within the timeline. Boundary sharing is deliberately NOT
 * rewritten here - see `seams` for why. */
export function moveClip(sb: Storyboard, from: number, to: number): Storyboard {
  if (from === to || from < 0 || to < 0 || from >= sb.clips.length || to >= sb.clips.length) {
    return sb
  }
  const clips = [...sb.clips]
  const [moved] = clips.splice(from, 1)
  clips.splice(to, 0, moved)
  return { ...sb, clips }
}

export function updateClip(sb: Storyboard, clipId: string, patch: Partial<Clip>): Storyboard {
  return { ...sb, clips: sb.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) }
}

export function setFrameSketch(sb: Storyboard, frameId: string, sketch: Sketch): Storyboard {
  const frame = sb.frames[frameId]
  if (!frame) return sb
  return { ...sb, frames: { ...sb.frames, [frameId]: { ...frame, sketch } } }
}

export function getSketch(sb: Storyboard, frameId: string | undefined): Sketch {
  return (frameId && sb.frames[frameId]?.sketch) || emptySketch()
}

/**
 * The joins between consecutive clips. A seam is `linked` when the two clips
 * literally share a frame id.
 *
 * Reordering is where this gets interesting: dragging clip 3 to the front does
 * NOT re-chain anything, because re-chaining would mean overwriting one of the
 * two boundary drawings, silently destroying work the user did. Instead the
 * link simply breaks and the timeline shows a broken seam the user can repair
 * deliberately with `linkSeam`.
 */
export interface Seam {
  /** Seam sits between clips[index] and clips[index + 1]. */
  index: number
  linked: boolean
}

export function seams(sb: Storyboard): Seam[] {
  const out: Seam[] = []
  for (let i = 0; i < sb.clips.length - 1; i++) {
    out.push({ index: i, linked: sb.clips[i].endFrameId === sb.clips[i + 1].startFrameId })
  }
  return out
}

/**
 * Repair a broken seam: the following clip adopts this clip's end frame.
 * DESTRUCTIVE - whatever was drawn on the follower's own start frame is dropped
 * if nothing else references it, so the UI must confirm before calling.
 */
export function linkSeam(sb: Storyboard, index: number): Storyboard {
  const a = sb.clips[index]
  const b = sb.clips[index + 1]
  if (!a || !b) return sb
  return collectFrames(updateClip(sb, b.id, { startFrameId: a.endFrameId }))
}

/**
 * Break a shared boundary into two independent frames - the spec's "unless
 * explicitly edited by the user" escape hatch. The follower gets a COPY, so
 * both clips keep the drawing and can now diverge.
 */
export function unlinkSeam(sb: Storyboard, index: number): Storyboard {
  const a = sb.clips[index]
  const b = sb.clips[index + 1]
  if (!a || !b || a.endFrameId !== b.startFrameId) return sb

  const source = sb.frames[a.endFrameId]
  if (!source) return sb

  // Deep enough: strokes and texts are replaced wholesale on edit, never mutated
  // in place, so copying the arrays is sufficient to decouple the two frames.
  const copy: Frame = {
    id: newId(),
    sketch: { strokes: [...source.sketch.strokes], texts: [...source.sketch.texts] }
  }
  return updateClip(
    { ...sb, frames: { ...sb.frames, [copy.id]: copy } },
    b.id,
    { startFrameId: copy.id }
  )
}

/**
 * Whether this clip's end frame must be hit exactly.
 *
 * The two goals genuinely conflict. Pinning the end frame (Veo's `lastFrame`)
 * forces the model to reconcile its natural motion with a fixed target, which
 * is what produces the settle / regression / fade at the end of a clip. Not
 * pinning it removes that artefact - but then the clip does not finish on a
 * known image, and a FOLLOWING clip that starts from that image would begin
 * with a visible jump.
 *
 * So the decision is made per seam rather than globally: a clip whose end frame
 * is shared with the next clip is pinned, because continuity is the whole point
 * of chaining. The last clip, and any clip whose seam has been cut, is free to
 * end mid-motion. An explicit `endFrameMode` on the clip overrides this.
 */
export function effectiveEndMode(sb: Storyboard, clipId: string): EndFrameMode {
  const i = sb.clips.findIndex((c) => c.id === clipId)
  if (i === -1) return 'guide'

  const clip = sb.clips[i]
  if (clip.endFrameMode) return clip.endFrameMode

  const next = sb.clips[i + 1]
  return next && next.startFrameId === clip.endFrameId ? 'exact' : 'guide'
}

/** Why the mode came out the way it did, for the UI to explain itself. */
export function endModeReason(sb: Storyboard, clipId: string): string {
  const i = sb.clips.findIndex((c) => c.id === clipId)
  const clip = sb.clips[i]
  if (!clip) return ''
  if (clip.endFrameMode) return 'set manually for this clip'

  const next = sb.clips[i + 1]
  return next && next.startFrameId === clip.endFrameId
    ? `chained into clip ${i + 2}, so the end frame must match exactly`
    : 'not chained, so the clip can end mid-motion'
}

/** Which clips would be affected by editing this frame. Drives the "shared
 * frame" warning in the canvas header. */
export function clipsUsingFrame(sb: Storyboard, frameId: string): Clip[] {
  return sb.clips.filter((c) => c.startFrameId === frameId || c.endFrameId === frameId)
}

/**
 * Editing any input invalidates a previously generated clip - the video no
 * longer depicts what the prompt now says. Downgrade rather than delete, so the
 * user still sees the old result until they regenerate.
 */
export function invalidate(clip: Clip): Partial<Clip> {
  if (clip.status === 'generating') return {}
  return { status: clip.videoUrl ? 'done' : clip.prompt ? 'ready' : 'draft', error: undefined }
}
