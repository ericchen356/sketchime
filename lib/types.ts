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

/** Hard stop on the follow-up loop. An agent that hasn't converged by now is
 * stuck, and the user should not be trapped answering forever. */
export const MAX_TURNS_PER_AGENT = 4

export type ClipStatus = 'draft' | 'ready' | 'generating' | 'done' | 'error'

export interface Clip {
  id: string
  /** Image A. */
  startFrameId: string
  /** Image B. */
  endFrameId: string
  /** The user's motion intent, in their own words. */
  intent: string
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
