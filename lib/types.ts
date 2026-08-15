export interface InkPoint {
  x: number
  y: number
  /** 0..1 from PointerEvent.pressure; 0.5 for devices that don't report it. */
  pressure: number
}

export interface Stroke {
  id: string
  points: InkPoint[]
  color: string
  /** Brush size at draw time, in px. Old strokes without one use the default. */
  width?: number
}

export interface TextItem {
  id: string
  x: number
  y: number
  text: string
  color: string
}

export interface Sketch {
  strokes: Stroke[]
  texts: TextItem[]
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Tool = 'pen' | 'eraser' | 'text' | 'pan'

/**
 * How the eraser bites.
 *  - 'stroke': one touched point takes the whole stroke out.
 *  - 'pixel':  only the touched points go, and the stroke SPLITS around the
 *              hole into independent fragments. Still vector - nothing is
 *              rasterised - so fragments stay crisp at any zoom and undo works
 *              the same way.
 */
export type EraseMode = 'stroke' | 'pixel'

/* ================================================================
 * Storyboard
 * ================================================================ */

/** Every clip lasts exactly this long - it is baked into the compiled prompt. */
export const CLIP_SECONDS = 5
export const CLIP_FPS = 24

/**
 * A drawn keyframe. Frames are stored in one pool and referenced by id, NOT
 * embedded in clips, because a boundary frame is genuinely shared: clip N's end
 * frame and clip N+1's start frame are the same drawing, so editing it must
 * move both. That sharing is the whole of the continuity-chaining rule.
 */
export interface Frame {
  id: string
  sketch: Sketch
}

export type BoardStepId = 'director' | 'cinematographer' | 'animator' | 'artDirector'

/** A, B and C are the tailored choices; D is always the custom write-in. */
export type OptionKey = 'A' | 'B' | 'C' | 'D'

export interface BoardOption {
  key: 'A' | 'B' | 'C'
  text: string
}

export interface BoardStep {
  id: BoardStepId
  /** 1-4. The board runs in strict sequential order. */
  order: number
  /** "The Director" */
  role: string
  /** "Transition Timing & Easing" */
  topic: string
  objective: string
  question: string
  options: BoardOption[]
  /**
   * Distinct facets of this member's remit. The agent is told to work through
   * them across its questions, which is what turns "one vague question" into a
   * genuine interrogation of the shot.
   */
  probes: string[]
  /**
   * Safe, neutral instruction used when an agent commits without producing a
   * directive. It must read as a DIRECTION, never as a question - anything put
   * here is inserted verbatim into the prompt sent to the video model.
   */
  defaultDirective: string
  /** Which line of the compiled prompt this step feeds. */
  compilesInto: 'easing' | 'camera' | 'physics' | 'environment'
}

export interface BoardAnswer {
  key: OptionKey
  /** The resolved wording: the chosen option's text, or the D write-in. */
  text: string
}

/**
 * One exchange with a board member. The agent looks at both keyframes, says
 * what it sees, and asks a question whose options are written FOR that drawing
 * - so the choices differ between a bouncing ball and a character turning.
 */
export interface BoardTurn {
  /** What the agent noticed in the frames. Shown to the user so it is visible
   * that the agent actually looked, rather than reciting a script. */
  observation: string
  question: string
  /** Exactly three, tailored to this drawing. D is structural and appended by
   * the UI, never by the agent. */
  options: BoardOption[]
  /** Undefined until the user responds. */
  answer?: BoardAnswer
}

/**
 * A board member's whole consultation for one clip. The agent keeps asking
 * follow-ups until it declares itself satisfied, at which point it writes the
 * `directive` - the resolved instruction the Stage 2 compiler consumes.
 */
export interface BoardThread {
  turns: BoardTurn[]
  satisfied: boolean
  directive?: string
  /** True when the thread came from the offline fallback rather than a live
   * agent, so the UI can say so honestly. */
  offline?: boolean
}

export type BoardThreads = Partial<Record<BoardStepId, BoardThread>>

/**
 * Each board member must ask at least this many questions before it is allowed
 * to commit. Without a floor the agents assume: they glance at the frames,
 * decide they understand the shot, and write a directive built on guesses the
 * user never confirmed. The point of the board is that nothing is assumed.
 */
export const MIN_TURNS_PER_AGENT = 3

/** Hard stop on the follow-up loop. An agent that hasn't converged by now is
 * stuck, and the user should not be trapped answering forever. */
export const MAX_TURNS_PER_AGENT = 5

/**
 * How the End Frame is used.
 *
 *  - 'guide': the end frame steers the action but is NOT handed to the video
 *    model as a terminal frame. Veo's `lastFrame` is a hard constraint - it must
 *    land on that exact image - so when its natural motion diverges from the
 *    target it reconciles by snapping, regressing or fading. Dropping the
 *    constraint removes the reconciliation, at the cost of not finishing on a
 *    known frame.
 *  - 'exact': `lastFrame` is supplied, giving true keyframe interpolation.
 *    Required wherever clips are chained, because clip N's last frame has to BE
 *    clip N+1's first frame or the cut becomes visible.
 */
export type EndFrameMode = 'guide' | 'exact'

export type ClipStatus = 'draft' | 'ready' | 'generating' | 'done' | 'error'

export interface Clip {
  id: string
  /** Image A. */
  startFrameId: string
  /** Image B. */
  endFrameId: string
  /** The user's motion intent, in their own words. */
  intent: string
  /** Explicit override. Left undefined, the mode is derived from whether this
   * clip's end frame is shared with the next clip (see effectiveEndMode). */
  endFrameMode?: EndFrameMode
  /**
   * Prose description of the end frame, written by a vision model. In 'guide'
   * mode the video model never receives Image B, so this is the only route by
   * which the intended destination reaches it at all.
   */
  endDescription?: string
  board: BoardThreads
  /** Stage 2 output. Recompiled whenever an input changes. */
  prompt?: string
  /** Gemini's pass over the prompt, kept separate so the original survives. */
  revisedPrompt?: string
  /** Which of the two the user wants sent to the video model. */
  useRevised?: boolean
  /** Long-running operation name, while generating. */
  operation?: string
  /** Object URL for the finished clip. Session-only, like everything else. */
  videoUrl?: string
  error?: string
  status: ClipStatus
}

export interface Storyboard {
  frames: Record<string, Frame>
  clips: Clip[]
  /** Free-text description of the drawing style, folded into every prompt so
   * the whole board renders consistently. */
  styleNote: string
}

export const emptySketch = (): Sketch => ({ strokes: [], texts: [] })
